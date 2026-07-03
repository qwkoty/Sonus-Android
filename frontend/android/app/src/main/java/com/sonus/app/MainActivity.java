package com.sonus.app;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final int LOGIN_REQUEST_CODE = 1001;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 注册自定义插件
        registerPlugin(CookieReaderPlugin.class);
        super.onCreate(savedInstanceState);
    }

    /**
     * 由前端 JS 桥接调用，打开 QQ 音乐登录 WebView
     */
    public void openQQLoginWebView() {
        Intent intent = new Intent(this, LoginWebViewActivity.class);
        startActivityForResult(intent, LOGIN_REQUEST_CODE);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == LOGIN_REQUEST_CODE) {
            // 登录窗口关闭后，通知前端检查 Cookie
            boolean loggedIn = resultCode == RESULT_OK;
            // 通过 JS eval 通知前端
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().eval(
                    "window.dispatchEvent(new CustomEvent('qq-login-webview-closed', {detail: {loggedIn: " + loggedIn + "}}));",
                    null
                );
            }
        }
    }
}
