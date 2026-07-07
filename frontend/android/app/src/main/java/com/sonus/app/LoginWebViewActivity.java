package com.sonus.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.KeyEvent;
import android.webkit.CookieManager;
import android.webkit.JsResult;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginHandle;

/**
 * QQ 音乐登录 WebView 窗口。
 * 流程：
 * 1. 先预热访问 y.qq.com 首页（建立基础 Cookie，降低风控）
 * 2. 跳转个人主页触发登录界面（扫码 / 账号密码均可）
 * 3. 不打断登录流程，持续轮询 Cookie
 * 4. 同时拿到 uin + qm_keyst 才 finish，确保登录态完整
 */
@SuppressLint("SetJavaScriptEnabled")
public class LoginWebViewActivity extends Activity {

    private WebView webView;
    private boolean loginDetected = false;
    private boolean warmedUp = false;
    private int pollCount = 0;
    private static final int MAX_POLL = 300; // 最多轮询 300 次 (~360s)
    private static final String HOME_URL = "https://y.qq.com/";
    private static final String PROFILE_URL = "https://y.qq.com/n/ryqq/profile";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 全屏沉浸式
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE |
            View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION |
            View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
            View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
            View.SYSTEM_UI_FLAG_FULLSCREEN |
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        );

        webView = new WebView(this);
        webView.setBackgroundColor(Color.BLACK);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccess(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setDatabaseEnabled(true);
        // 桌面端 UA
        settings.setUserAgentString(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        );

        // 启用第三方 Cookie（关键：QQ 登录需要跨域 Cookie）
        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, true);
        cookieManager.flush();

        // WebChromeClient：QQ 登录页面会调用 alert/confirm/prompt，
        // 没有 WebChromeClient 这些 JS 对话框会被静默拦截 → "登录已取消" / "网络安全"
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                result.confirm();
                return true;
            }
            @Override
            public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                result.confirm();
                return true;
            }
            @Override
            public boolean onJsPrompt(WebView view, String url, String message, String defaultValue, android.webkit.JsPromptResult result) {
                result.confirm();
                return true;
            }
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                checkLoginCookie();
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                // 注入 JS：隐藏 WebView 特征，降低"网络环境有风险"概率
                injectStealthScript(view);
                // 首页预热完成后跳到个人主页
                if (!warmedUp && (url.startsWith(HOME_URL) || url.contains("y.qq.com/"))) {
                    warmedUp = true;
                    webView.postDelayed(() -> {
                        CookieManager.getInstance().flush();
                        webView.loadUrl(PROFILE_URL);
                    }, 800);
                }
                checkLoginCookie();
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (url.startsWith("https://y.qq.com/") ||
                    url.startsWith("https://xui.ptlogin2.qq.com/") ||
                    url.startsWith("https://ssl.ptlogin2.qq.com/") ||
                    url.startsWith("https://ptlogin2.qq.com/") ||
                    url.startsWith("https://i.y.qq.com/") ||
                    url.startsWith("https://connect.qq.com/") ||
                    url.startsWith("https://graph.qq.com/")) {
                    return false;
                }
                try {
                    Intent intent = new Intent(Intent.ACTION_VIEW, request.getUrl());
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(intent);
                } catch (Exception e) {}
                return true;
            }
        });

        // 先加载首页预热
        webView.loadUrl(HOME_URL);

        // 启动定时轮询检查 Cookie
        startCookiePoll();
    }

    /**
     * 注入 JS 隐藏 WebView 特征：
     * - 删除 navigator.webdriver
     * - 伪装 chrome 对象
     * - 伪装 plugins
     */
    private void injectStealthScript(WebView view) {
        view.evaluateJavascript(
            "(function(){" +
            "  try {" +
            "    Object.defineProperty(navigator, 'webdriver', {get: function(){return false;}, configurable: true});" +
            "    if(!window.chrome){window.chrome={runtime:{}};}" +
            "    Object.defineProperty(navigator, 'plugins', {get: function(){return [1,2,3,4,5];}, configurable: true});" +
            "    Object.defineProperty(navigator, 'languages', {get: function(){return ['zh-CN','zh','en'];}, configurable: true});" +
            "  } catch(e) {}" +
            "})();",
            null
        );
    }

    /**
     * 检查登录态：必须同时有 uin（不带 o 前缀）且 qm_keyst（或等效票据）齐全才 finish。
     * 不再在只有 uin 时跳转 PLAYER_URL，避免打断扫码/账号密码登录流程。
     */
    private void checkLoginCookie() {
        if (loginDetected) return;

        CookieManager cm = CookieManager.getInstance();
        cm.flush();
        String cookies = cm.getCookie("https://y.qq.com");
        if (cookies == null) return;

        boolean hasUin = false;
        String musicKey = "";

        for (String pair : cookies.split(";")) {
            String[] kv = pair.trim().split("=", 2);
            if (kv.length == 2) {
                String key = kv[0];
                String value = kv[1];
                if ((key.equals("uin") || key.equals("wxuin")) && !value.startsWith("o")) {
                    hasUin = true;
                }
                if (key.equals("qm_keyst") || key.equals("qqmusic_key") || key.equals("music_key")) {
                    if (musicKey.isEmpty() || key.equals("qm_keyst")) musicKey = value;
                } else if (key.equals("wxskey") && musicKey.isEmpty()) {
                    musicKey = value;
                } else if (key.equals("p_skey") && musicKey.isEmpty()) {
                    musicKey = value;
                }
            }
        }

        // 必须同时有 uin + 票据才算登录成功
        if (hasUin && !musicKey.isEmpty()) {
            loginDetected = true;
            // 确保最新 Cookie 写入磁盘
            cm.flush();
            finishWithResult(true);
        }
        // 只有 uin 没有票据时不跳转，继续等待（不打断登录流程）
    }

    private void finishWithResult(boolean loggedIn) {
        CookieManager.getInstance().flush();
        Intent resultIntent = new Intent();
        resultIntent.putExtra("loggedIn", loggedIn);
        setResult(loggedIn ? RESULT_OK : RESULT_CANCELED, resultIntent);
        finish();
    }

    private Runnable pollRunnable;
    private void startCookiePoll() {
        pollRunnable = new Runnable() {
            @Override
            public void run() {
                if (loginDetected || pollCount >= MAX_POLL) {
                    if (!loginDetected) {
                        finishWithResult(false);
                    }
                    return;
                }
                pollCount++;
                checkLoginCookie();
                webView.postDelayed(this, 1000);
            }
        };
        webView.postDelayed(pollRunnable, 1500);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView.canGoBack()) {
            webView.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}
