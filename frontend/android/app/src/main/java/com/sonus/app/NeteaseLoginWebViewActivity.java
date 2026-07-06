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
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * 网易云音乐登录 WebView 窗口。
 * 流程：
 * 1. 加载 music.163.com 登录页（支持扫码/手机号登录）
 * 2. 轮询检测 MUSIC_U cookie（网易云登录态主票据）
 * 3. 拿到 MUSIC_U 后 finish，Cookie 已写入 CookieManager
 *
 * 与 QQ 音乐 LoginWebViewActivity 同样的思路，但针对网易云域和 cookie。
 */
@SuppressLint("SetJavaScriptEnabled")
public class NeteaseLoginWebViewActivity extends Activity {

    private WebView webView;
    private boolean loginDetected = false;
    private int pollCount = 0;
    private static final int MAX_POLL = 250; // 最多轮询 250 次 (~300s)
    private static final String NCM_BASE = "https://music.163.com";
    private static final String LOGIN_URL = "https://music.163.com/#/login";

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
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        // 桌面端 UA，与后续 API 请求 UA 保持一致
        settings.setUserAgentString(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        );

        // 启用第三方 Cookie（网易云登录需要跨域 Cookie）
        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, true);
        cookieManager.flush();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                checkLoginCookie();
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                checkLoginCookie();
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                // 只允许 music.163.com 域内跳转，其他外部链接交给系统
                if (url.startsWith("https://music.163.com/") ||
                    url.startsWith("http://music.163.com/") ||
                    url.startsWith("https://music.163.com")) {
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

        // 加载网易云登录页
        webView.loadUrl(LOGIN_URL);

        // 启动定时轮询检查 Cookie
        startCookiePoll();
    }

    /**
     * 检查登录态：检测 MUSIC_U cookie 是否存在且非空。
     */
    private void checkLoginCookie() {
        if (loginDetected) return;

        CookieManager cm = CookieManager.getInstance();
        cm.flush();
        String cookies = cm.getCookie(NCM_BASE);
        if (cookies == null) return;

        for (String pair : cookies.split(";")) {
            String[] kv = pair.trim().split("=", 2);
            if (kv.length == 2) {
                String key = kv[0].trim();
                String value = kv[1].trim();
                // MUSIC_U 是网易云登录态主票据，存在即登录成功
                if (key.equals("MUSIC_U") && !value.isEmpty()) {
                    loginDetected = true;
                    finishWithResult(true);
                    return;
                }
                // 兜底：__csrf 出现且 ntes_uid 存在也算登录（部分场景）
                if (key.equals("ntes_uid") && !value.isEmpty() && cookies.contains("MUSIC_U")) {
                    loginDetected = true;
                    finishWithResult(true);
                    return;
                }
            }
        }
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
                webView.postDelayed(this, 1200);
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
