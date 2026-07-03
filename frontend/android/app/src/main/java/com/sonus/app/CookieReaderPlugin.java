package com.sonus.app;

import android.webkit.CookieManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 从 Android CookieManager 读取任意域的 Cookie。
 * 用于 WebView 登录 QQ 音乐后提取登录态。
 */
@CapacitorPlugin(name = "CookieReader")
public class CookieReaderPlugin extends Plugin {

    @PluginMethod()
    public void getCookiesForUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("Must provide url");
            return;
        }

        try {
            CookieManager cookieManager = CookieManager.getInstance();
            // 确保 Cookie 已从 RAM 写入持久存储
            cookieManager.flush();

            // getCookie() 返回该 URL 匹配的所有 Cookie（包括子域）
            String cookieString = cookieManager.getCookie(url);

            JSObject ret = new JSObject();
            ret.put("cookie", cookieString != null ? cookieString : "");

            // 解析关键字段
            if (cookieString != null) {
                String uin = "";
                String qqmusicKey = "";
                String loginType = "";

                for (String pair : cookieString.split(";")) {
                    String[] kv = pair.trim().split("=", 2);
                    if (kv.length == 2) {
                        String key = kv[0];
                        String value = kv[1];

                        // uin / wxuin
                        if (key.equals("uin")) {
                            uin = value.replaceFirst("^o0*", "");
                        } else if (key.equals("wxuin") && uin.isEmpty()) {
                            uin = value.replaceFirst("^o0*", "");
                        }

                        // 播放票据（优先级: qm_keyst > qqmusic_key > music_key > p_skey > skey）
                        if (key.equals("qm_keyst") || key.equals("qqmusic_key") || key.equals("music_key")) {
                            if (qqmusicKey.isEmpty() || key.equals("qm_keyst")) {
                                qqmusicKey = value;
                            }
                        } else if (key.equals("wxskey") && qqmusicKey.isEmpty()) {
                            qqmusicKey = value;
                        } else if (key.equals("p_skey") && qqmusicKey.isEmpty()) {
                            qqmusicKey = value;
                        } else if (key.equals("skey") && qqmusicKey.isEmpty()) {
                            qqmusicKey = value;
                        }

                        // login_type: 1=QQ登录, 2=微信登录
                        if (key.equals("login_type")) {
                            loginType = value;
                        }
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

    /**
     * 清除指定域的登录 Cookie（退出登录）
     */
    @PluginMethod()
    public void clearCookiesForUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("Must provide url");
            return;
        }
        CookieManager cm = CookieManager.getInstance();
        // 删除关键登录 Cookie
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
}
