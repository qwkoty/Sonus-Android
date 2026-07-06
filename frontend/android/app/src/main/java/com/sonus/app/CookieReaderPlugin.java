package com.sonus.app;

import android.content.Intent;
import android.webkit.CookieManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * CookieReader — Capacitor 原生插件
 * - getCookiesForUrl: 从 Android CookieManager 读取任意域 Cookie
 * - clearCookiesForUrl: 清除指定域登录 Cookie
 * - openLoginWebView: 打开 QQ 音乐登录 WebView Activity
 * - httpGet: 原生 HTTP GET（自动注入 CookieManager Cookie，无 CORS 限制）
 */
@CapacitorPlugin(name = "CookieReader")
public class CookieReaderPlugin extends Plugin {

    private static final int LOGIN_REQUEST_CODE = 1001;
    private static final int NETEASE_LOGIN_REQUEST_CODE = 1002;
    private PluginCall pendingLoginCall = null;
    private PluginCall pendingNeteaseLoginCall = null;

    @PluginMethod()
    public void getCookiesForUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null) { call.reject("Must provide url"); return; }

        try {
            CookieManager cookieManager = CookieManager.getInstance();
            cookieManager.flush();
            String cookieString = cookieManager.getCookie(url);

            JSObject ret = new JSObject();
            ret.put("cookie", cookieString != null ? cookieString : "");

            if (cookieString != null) {
                String uin = "";
                String qqmusicKey = "";
                String loginType = "";

                for (String pair : cookieString.split(";")) {
                    String[] kv = pair.trim().split("=", 2);
                    if (kv.length == 2) {
                        String key = kv[0];
                        String value = kv[1];
                        if (key.equals("uin")) uin = value.replaceFirst("^o0*", "");
                        else if (key.equals("wxuin") && uin.isEmpty()) uin = value.replaceFirst("^o0*", "");

                        if (key.equals("qm_keyst") || key.equals("qqmusic_key") || key.equals("music_key")) {
                            if (qqmusicKey.isEmpty() || key.equals("qm_keyst")) qqmusicKey = value;
                        } else if (key.equals("wxskey") && qqmusicKey.isEmpty()) qqmusicKey = value;
                        else if (key.equals("p_skey") && qqmusicKey.isEmpty()) qqmusicKey = value;
                        else if (key.equals("skey") && qqmusicKey.isEmpty()) qqmusicKey = value;

                        if (key.equals("login_type")) loginType = value;
                    }
                }
                ret.put("uin", uin);
                ret.put("qqmusic_key", qqmusicKey);
                ret.put("login_type", loginType);
                ret.put("loggedIn", !uin.isEmpty() && !qqmusicKey.isEmpty());
            } else {
                ret.put("uin", "");
                ret.put("qqmusic_key", "");
                ret.put("login_type", "");
                ret.put("loggedIn", false);
            }
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to read cookies: " + e.getMessage());
        }
    }

    @PluginMethod()
    public void clearCookiesForUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null) { call.reject("Must provide url"); return; }
        CookieManager cm = CookieManager.getInstance();
        cm.setCookie(url, "uin=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT");
        cm.setCookie(url, "wxuin=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT");
        cm.setCookie(url, "qqmusic_key=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT");
        cm.setCookie(url, "qm_keyst=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT");
        cm.setCookie(url, "p_skey=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT");
        cm.setCookie(url, "skey=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT");
        cm.setCookie(url, "login_type=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT");
        cm.flush();
        call.resolve();
    }

    /**
     * 原生 HTTP GET 请求。
     * 自动从 CookieManager 读取 cookieDomain 对应域的 Cookie 注入请求头。
     * 响应的 Set-Cookie 会自动写入 CookieManager，支持网易云等扫码登录。
     * Android 原生层发请求，不受 WebView CORS 限制。
     */
    @PluginMethod()
    public void httpGet(PluginCall call) {
        String urlStr = call.getString("url");
        String cookieDomain = call.getString("cookieDomain", "https://y.qq.com");
        String explicitCookies = call.getString("cookies", "");

        if (urlStr == null || urlStr.isEmpty()) {
            call.reject("Must provide url");
            return;
        }

        try {
            URL url = new URL(urlStr);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setRequestProperty("User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
            // Referer 跟随 cookieDomain，不再硬编码 QQ
            String referer = cookieDomain;
            if (!referer.endsWith("/")) referer += "/";
            conn.setRequestProperty("Referer", referer);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(15000);
            conn.setInstanceFollowRedirects(true);

            // 注入 Cookie：优先使用调用方传入的 cookies 字符串，否则从 CookieManager 读取
            String cookiesToInject = null;
            if (explicitCookies != null && !explicitCookies.isEmpty()) {
                cookiesToInject = explicitCookies;
            } else {
                CookieManager cm = CookieManager.getInstance();
                cm.flush();
                cookiesToInject = cm.getCookie(cookieDomain);
            }
            if (cookiesToInject != null && !cookiesToInject.isEmpty()) {
                conn.setRequestProperty("Cookie", cookiesToInject);
            }

            int status = conn.getResponseCode();

            // 捕获响应 Set-Cookie 并写入 CookieManager（支持网易云扫码登录）
            // 同时把 name=value 部分拼接成 cookie 字符串返回给前端，避免前端二次读 CookieManager 失败
            StringBuilder sbSetCookies = new StringBuilder();
            try {
                java.util.Map<String, java.util.List<String>> headerFields = conn.getHeaderFields();
                // getHeaderFields 返回大小写不敏感的 Map，尝试多种 key
                java.util.List<String> setCookies = headerFields.get("Set-Cookie");
                if (setCookies == null || setCookies.isEmpty()) {
                    setCookies = headerFields.get("set-cookie");
                }
                if (setCookies != null && !setCookies.isEmpty()) {
                    CookieManager cm = CookieManager.getInstance();
                    String cookieBase = cookieDomain;
                    if (!cookieBase.endsWith("/")) cookieBase += "/";
                    for (String setCookie : setCookies) {
                        // 写入 CookieManager
                        try { cm.setCookie(cookieBase, setCookie); } catch (Exception ignored) {}
                        // 提取 name=value 部分（第一个分号前），拼接成 cookie 字符串
                        String nv = setCookie.split(";")[0].trim();
                        if (!nv.isEmpty()) {
                            if (sbSetCookies.length() > 0) sbSetCookies.append("; ");
                            sbSetCookies.append(nv);
                        }
                    }
                    cm.flush();
                }
            } catch (Exception e) {}

            JSObject ret = new JSObject();
            ret.put("status", status);
            ret.put("setCookies", sbSetCookies.toString());
            ret.put("finalUrl", conn.getURL().toString());

            if (status >= 200 && status < 300) {
                BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream(), "UTF-8"));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) sb.append(line);
                reader.close();
                ret.put("body", sb.toString());
                ret.put("ok", true);
            } else {
                ret.put("body", "");
                ret.put("ok", false);
            }
            conn.disconnect();
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("HTTP GET failed: " + e.getMessage());
        }
    }

    /**
     * 将 y.qq.com 的登录 Cookie 同步到 QQ 音乐音频流域名，
     * 让 WebView 的 Audio 元素在请求播放链接时也能带上登录态。
     */
    @PluginMethod()
    public void syncStreamCookies(PluginCall call) {
        try {
            String url = call.getString("url", "https://y.qq.com");
            CookieManager cm = CookieManager.getInstance();
            cm.flush();
            String cookieString = cm.getCookie(url);
            if (cookieString == null || cookieString.isEmpty()) {
                call.resolve();
                return;
            }

            String[] streamDomains = {
                "https://dl.stream.qqmusic.qq.com",
                "https://isure.stream.qqmusic.qq.com",
                "https://stream.qqmusic.qq.com",
                "https://aqqmusic.tc.qq.com",
                "https://isure6.stream.qqmusic.qq.com"
            };

            for (String pair : cookieString.split(";")) {
                String[] kv = pair.trim().split("=", 2);
                if (kv.length != 2) continue;
                String key = kv[0].trim();
                String value = kv[1].trim();
                if (key.isEmpty() || value.isEmpty()) continue;
                // 只同步登录态相关 Cookie
                if (key.equals("uin") || key.equals("wxuin") ||
                    key.equals("qm_keyst") || key.equals("qqmusic_key") ||
                    key.equals("wxskey") || key.equals("p_skey") || key.equals("skey") ||
                    key.equals("login_type")) {
                    String cookieValue = key + "=" + value + "; Domain=.qqmusic.qq.com; Path=/";
                    for (String domain : streamDomains) {
                        cm.setCookie(domain, cookieValue);
                    }
                }
            }
            cm.flush();
            call.resolve();
        } catch (Exception e) {
            call.reject("Sync stream cookies failed: " + e.getMessage());
        }
    }

    @PluginMethod()
    public void openLoginWebView(PluginCall call) {
        try {
            pendingLoginCall = call;
            Intent intent = new Intent(getContext(), LoginWebViewActivity.class);
            getActivity().startActivityForResult(intent, LOGIN_REQUEST_CODE);
        } catch (Exception e) {
            pendingLoginCall = null;
            call.reject("Failed to open login webview: " + e.getMessage());
        }
    }

    /**
     * 打开网易云音乐登录 WebView Activity。
     * 登录成功后 CookieManager 会持有 music.163.com 的 MUSIC_U 等登录 Cookie。
     */
    @PluginMethod()
    public void openNeteaseLoginWebView(PluginCall call) {
        try {
            pendingNeteaseLoginCall = call;
            Intent intent = new Intent(getContext(), NeteaseLoginWebViewActivity.class);
            getActivity().startActivityForResult(intent, NETEASE_LOGIN_REQUEST_CODE);
        } catch (Exception e) {
            pendingNeteaseLoginCall = null;
            call.reject("Failed to open netease login webview: " + e.getMessage());
        }
    }

    /**
     * 返回本地音频代理服务器端口。
     * 前端拿到端口后，把 QQ 音乐 CDN 播放链接包装成
     * http://localhost:PORT/?url=<encoded stream url>
     * 通过代理播放，避免 WebView Audio 直接请求被 403/CORS 拦截。
     */
    @PluginMethod()
    public void getProxyPort(PluginCall call) {
        int port = MainActivity.getAudioProxyPort();
        JSObject ret = new JSObject();
        ret.put("port", port);
        ret.put("available", port > 0);
        call.resolve(ret);
    }

    public void notifyLoginResult(boolean loggedIn, String nickname, String avatar) {
        if (pendingLoginCall == null) return;
        if (loggedIn) {
            CookieManager cm = CookieManager.getInstance();
            cm.flush();
            String cookie = cm.getCookie("https://y.qq.com");
            JSObject ret = new JSObject();
            ret.put("loggedIn", true);
            ret.put("cookie", cookie != null ? cookie : "");
            ret.put("nickname", nickname != null ? nickname : "");
            ret.put("avatar", avatar != null ? avatar : "");
            pendingLoginCall.resolve(ret);
        } else {
            pendingLoginCall.reject("User cancelled login");
        }
        pendingLoginCall = null;
    }

    /**
     * 网易云登录 WebView 回调：由 MainActivity.onActivityResult(requestCode=1002) 调用。
     * 登录成功时读取 music.163.com 的 Cookie 一并返回给前端。
     */
    public void notifyNeteaseLoginResult(boolean loggedIn) {
        if (pendingNeteaseLoginCall == null) return;
        if (loggedIn) {
            // 读取 music.163.com 的完整 Cookie 返回给前端
            CookieManager cm = CookieManager.getInstance();
            cm.flush();
            String cookie = cm.getCookie("https://music.163.com");
            JSObject ret = new JSObject();
            ret.put("loggedIn", true);
            ret.put("cookie", cookie != null ? cookie : "");
            pendingNeteaseLoginCall.resolve(ret);
        } else {
            pendingNeteaseLoginCall.reject("User cancelled netease login");
        }
        pendingNeteaseLoginCall = null;
    }
}
