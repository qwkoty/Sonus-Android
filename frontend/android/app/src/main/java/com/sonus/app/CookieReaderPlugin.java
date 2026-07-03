package com.sonus.app;

import android.content.Intent;
import android.webkit.CookieManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * CookieReader — Capacitor 原生插件
 * - getCookiesForUrl: 从 Android CookieManager 读取任意域的 Cookie
 * - clearCookiesForUrl: 清除指定域的登录 Cookie
 * - openLoginWebView: 打开 QQ 音乐登录 WebView Activity
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
     * 打开 QQ 音乐登录 WebView（异步等待用户登录完成后回调）
     */
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
     * 由 MainActivity 在 onActivityResult 中调用，通知前端登录结果
     */
    public void notifyLoginResult(boolean loggedIn) {
        if (pendingLoginCall == null) return;
        JSObject ret = new JSObject();
        ret.put("loggedIn", loggedIn);
        if (loggedIn) pendingLoginCall.resolve(ret);
        else pendingLoginCall.reject("User cancelled login");
        pendingLoginCall = null;
    }
}
