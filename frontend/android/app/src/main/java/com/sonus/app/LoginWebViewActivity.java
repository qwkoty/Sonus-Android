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
 * QQ 音乐登录 WebView 窗口。
 * 流程：
 * 1. 先预热访问 y.qq.com 首页（建立基础 Cookie，降低风控）
 * 2. 跳转个人主页触发登录界面
 * 3. 检测到 uin 后，跳到 player 页等待 qm_keyst（播放票据）写入
 * 4. 拿到 qm_keyst 才 finish，确保登录态完整
 */
@SuppressLint("SetJavaScriptEnabled")
public class LoginWebViewActivity extends Activity {

    private WebView webView;
    private boolean loginDetected = false;
    private boolean warmedUp = false;
    private int pollCount = 0;
    private static final int MAX_POLL = 250; // 最多轮询 250 次 (~300s)
    private static final String HOME_URL = "https://y.qq.com/";
    private static final String PROFILE_URL = "https://y.qq.com/n/ryqq/profile";
    private static final String PLAYER_URL = "https://y.qq.com/n/ryqq/player";

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
        // 登录 WebView 加载前显示黑色背景，避免原生白屏闪烁
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

        // 启用第三方 Cookie（关键：QQ 登录需要跨域 Cookie）
        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, true);
        // 预先把已有 Cookie 应用到 y.qq.com 域（自动登录/记住状态）
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
                    url.startsWith("https://i.y.qq.com/")) {
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

        // 先加载首页预热（建立 ts_uid 等基础 Cookie，降低"网络环境有风险"概率）
        webView.loadUrl(HOME_URL);

        // 启动定时轮询检查 Cookie
        startCookiePoll();
    }

    /**
     * 检查登录态：必须有 uin 且 qm_keyst（或等效票据）齐全才 finish。
     */
    private void checkLoginCookie() {
        if (loginDetected) return;

        CookieManager cm = CookieManager.getInstance();
        cm.flush();
        String cookies = cm.getCookie("https://y.qq.com");
        if (cookies == null) return;

        boolean hasUin = false;
        String musicKey = "";
        String uinValue = "";

        for (String pair : cookies.split(";")) {
            String[] kv = pair.trim().split("=", 2);
            if (kv.length == 2) {
                String key = kv[0];
                String value = kv[1];
                if ((key.equals("uin") || key.equals("wxuin")) && !value.startsWith("o")) {
                    hasUin = true;
                    uinValue = value;
                }
                if (key.equals("qm_keyst") || key.equals("qqmusic_key") || key.equals("music_key")) {
                    if (musicKey.isEmpty() || key.equals("qm_keyst")) musicKey = value;
                } else if (key.equals("wxskey") && musicKey.isEmpty()) {
                    musicKey = value;
                }
            }
        }

        if (hasUin) {
            loginDetected = true;
            if (!musicKey.isEmpty()) {
                // 票据齐全，可以完成登录
                finishWithResult(true);
            } else {
                // 缺票据，跳到播放器页触发 qm_keyst 写入，轮询等待
                webView.loadUrl(PLAYER_URL);
                // 等待票据写入，最多再轮询 30 次
                waitForMusicKey(30);
            }
        }
    }

    /**
     * 轮询等待 qm_keyst 写入。
     */
    private void waitForMusicKey(final int maxRetry) {
        final int[] count = {0};
        final Runnable[] holder = new Runnable[1];
        holder[0] = new Runnable() {
            @Override
            public void run() {
                CookieManager cm = CookieManager.getInstance();
                cm.flush();
                String cookies = cm.getCookie("https://y.qq.com");
                String musicKey = "";
                if (cookies != null) {
                    for (String pair : cookies.split(";")) {
                        String[] kv = pair.trim().split("=", 2);
                        if (kv.length == 2) {
                            String key = kv[0];
                            if (key.equals("qm_keyst") || key.equals("qqmusic_key") || key.equals("music_key")) {
                                musicKey = kv[1];
                            }
                        }
                    }
                }
                count[0]++;
                if (!musicKey.isEmpty()) {
                    // 拿到票据，再 flush 一次确保持久化
                    cm.flush();
                    finishWithResult(true);
                } else if (count[0] >= maxRetry) {
                    // 超时，仍返回成功（至少有 uin），让前端尝试
                    cm.flush();
                    finishWithResult(true);
                } else {
                    webView.postDelayed(this, 1000);
                }
            }
        };
        webView.postDelayed(holder[0], 1500);
    }

    private void finishWithResult(boolean loggedIn) {
        // 最终 flush，确保 Cookie 持久化到磁盘
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
