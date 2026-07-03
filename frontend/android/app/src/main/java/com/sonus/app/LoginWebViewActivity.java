package com.sonus.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.view.View;
import android.view.KeyEvent;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * QQ 音乐登录 WebView 窗口。
 * 加载 y.qq.com，用户在其中完成扫码/密码登录。
 * WebViewClient.onPageFinished 检测 Cookie 中出现 uin → 自动关闭窗口。
 */
@SuppressLint("SetJavaScriptEnabled")
public class LoginWebViewActivity extends Activity {

    private WebView webView;
    private boolean loginDetected = false;
    private int pollCount = 0;
    private static final int MAX_POLL = 200; // 最多轮询 200 次 (~240s)

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
        // 设置桌面端 UA，避免 QQ 音乐显示移动端限制
        settings.setUserAgentString(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        );

        // 启用第三方 Cookie（关键：QQ 登录需要跨域 Cookie）
        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                // 每次页面加载开始时检查 Cookie
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
                // 只允许 y.qq.com 和 ptlogin2.qq.com 的 URL 在 WebView 内跳转
                if (url.startsWith("https://y.qq.com/") ||
                    url.startsWith("https://xui.ptlogin2.qq.com/") ||
                    url.startsWith("https://ssl.ptlogin2.qq.com/") ||
                    url.startsWith("https://ptlogin2.qq.com/")) {
                    return false; // 在 WebView 内加载
                }
                // 其他外部 URL 在系统浏览器打开
                try {
                    Intent intent = new Intent(Intent.ACTION_VIEW, request.getUrl());
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(intent);
                } catch (Exception e) {}
                return true;
            }
        });

        // 加载 QQ 音乐个人主页（未登录时自动显示登录界面）
        webView.loadUrl("https://y.qq.com/n/ryqq/profile");

        // 启动定时轮询检查 Cookie
        startCookiePoll();
    }

    private void checkLoginCookie() {
        if (loginDetected) return;

        CookieManager cm = CookieManager.getInstance();
        cm.flush();
        String cookies = cm.getCookie("https://y.qq.com");
        if (cookies == null) return;

        // 检测 uin 出现且不以 o 开头（o 开头是加密后的，不是真正的登录态）
        for (String pair : cookies.split(";")) {
            String[] kv = pair.trim().split("=", 2);
            if (kv.length == 2) {
                String key = kv[0];
                String value = kv[1];
                if ((key.equals("uin") || key.equals("wxuin")) && !value.startsWith("o")) {
                    // 检测到登录！
                    loginDetected = true;

                    // warmup: 跳到播放器页等待 qm_keyst / qqmusic_key
                    String musicKey = "";
                    for (String p : cookies.split(";")) {
                        String[] kv2 = p.trim().split("=", 2);
                        if (kv2.length == 2 && (kv2[0].equals("qm_keyst") || kv2[0].equals("qqmusic_key") || kv2[0].equals("music_key") || kv2[0].equals("wxskey"))) {
                            musicKey = kv2[1];
                        }
                    }
                    if (!musicKey.isEmpty()) {
                        // 已有播放票据，直接关闭
                        finishWithResult(true);
                    } else {
                        // 没有 playKey，先 warmup 到播放器页
                        webView.loadUrl("https://y.qq.com/n/ryqq/player");
                        // 等 3 秒后再检查
                        webView.postDelayed(() -> {
                            cm.flush();
                            finishWithResult(true);
                        }, 3000);
                    }
                    return;
                }
            }
        }
    }

    private void finishWithResult(boolean loggedIn) {
        // 通过 Intent 回传结果给 MainActivity
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
        webView.postDelayed(pollRunnable, 1200);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        // 允许返回键在 WebView 内后退
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
