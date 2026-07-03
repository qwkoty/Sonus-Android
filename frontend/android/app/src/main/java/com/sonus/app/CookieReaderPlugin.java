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
    private PluginCall pendingLoginCall = null;

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
     * Android 原生层发请求，不受 WebView CORS 限制。
     */
    @PluginMethod()
    public void httpGet(PluginCall call) {
        String urlStr = call.getString("url");
        String cookieDomain = call.getString("cookieDomain", "https://y.qq.com");

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
            conn.setRequestProperty("Referer", "https://y.qq.com/");
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(15000);
            conn.setInstanceFollowRedirects(true);

            // 从 CookieManager 读取 Cookie 并注入
            CookieManager cm = CookieManager.getInstance();
            cm.flush();
            String cookies = cm.getCookie(cookieDomain);
            if (cookies != null && !cookies.isEmpty()) {
                conn.setRequestProperty("Cookie", cookies);
            }

            int status = conn.getResponseCode();
            JSObject ret = new JSObject();
            ret.put("status", status);

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

    public void notifyLoginResult(boolean loggedIn) {
        if (pendingLoginCall == null) return;
        JSObject ret = new JSObject();
        ret.put("loggedIn", loggedIn);
        if (loggedIn) pendingLoginCall.resolve(ret);
        else pendingLoginCall.reject("User cancelled login");
        pendingLoginCall = null;
    }
}
