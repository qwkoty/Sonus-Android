package com.sonus.app;

import android.webkit.CookieManager;
import fi.iki.elonen.NanoHTTPD;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * 本地音频代理服务器
 * 解决 WebView Audio 元素跨域请求 QQ 音乐 CDN 被拒绝（403/CORS）的问题。
 * Audio 请求 http://localhost:PORT/?url=https://ws.stream.qqmusic.qq.com/...
 * 代理服务器带 Referer + Cookie 请求 QQ 音乐 CDN，转发流式响应。
 */
public class AudioProxyServer extends NanoHTTPD {

    private static final String REFERER = "https://y.qq.com/";
    private static final String USER_AGENT =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

    public AudioProxyServer(int port) {
        super(port);
    }

    @Override
    public Response serve(IHTTPSession session) {
        String uri = session.getUri();
        // 解析目标 URL
        String targetUrl = getParam(session, "url");
        if (targetUrl == null || targetUrl.isEmpty()) {
            return newFixedLengthResponse(Response.Status.BAD_REQUEST, "text/plain", "Missing url param");
        }

        try {
            URL url = new URL(targetUrl);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setRequestProperty("User-Agent", USER_AGENT);
            conn.setRequestProperty("Referer", REFERER);

            // 注入 QQ 音乐登录 Cookie
            String cookies = CookieManager.getInstance().getCookie("https://y.qq.com");
            if (cookies != null && !cookies.isEmpty()) {
                conn.setRequestProperty("Cookie", cookies);
            }

            // 支持 Range 请求（Audio 元素 seek 时会发 Range）
            String range = session.getHeaders().get("range");
            if (range != null && !range.isEmpty()) {
                conn.setRequestProperty("Range", range);
            }

            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);
            conn.setInstanceFollowRedirects(true);

            int status = conn.getResponseCode();
            if (status < 200 || status >= 400) {
                conn.disconnect();
                return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "Upstream error: " + status);
            }

            // 转发响应头
            String contentType = conn.getContentType();
            if (contentType == null || contentType.isEmpty()) contentType = "audio/mpeg";
            int contentLength = conn.getContentLength();
            String contentRange = conn.getHeaderField("Content-Range");

            // 流式转发
            InputStream is = conn.getInputStream();
            Response response;
            if (contentLength > 0) {
                response = newFixedLengthResponse(Response.Status.lookup(status), contentType, is, contentLength);
            } else {
                response = newChunkedResponse(Response.Status.lookup(status), contentType, is);
            }

            // 设置支持 Range 的头
            response.addHeader("Accept-Ranges", "bytes");
            if (contentRange != null) {
                response.addHeader("Content-Range", contentRange);
            }
            // 允许跨域（虽然 localhost 同源，保险起见）
            response.addHeader("Access-Control-Allow-Origin", "*");

            return response;
        } catch (Exception e) {
            return newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "text/plain", "Proxy error: " + e.getMessage());
        }
    }

    private String getParam(IHTTPSession session, String key) {
        // 优先使用 NanoHTTPD 解析好的参数（自动从 query string 解析）
        try {
            java.util.List<String> vals = session.getParameters().get(key);
            if (vals != null && !vals.isEmpty() && vals.get(0) != null && !vals.get(0).isEmpty()) {
                return vals.get(0);
            }
        } catch (Exception ignored) {}
        // 兜底：手动解析 query string
        String qs = session.getQueryParameterString();
        if (qs != null) {
            for (String pair : qs.split("&")) {
                String[] kv = pair.split("=", 2);
                if (kv.length == 2 && kv[0].equals(key)) {
                    try {
                        return java.net.URLDecoder.decode(kv[1], "UTF-8");
                    } catch (Exception e) {
                        return kv[1];
                    }
                }
            }
        }
        return null;
    }
}
