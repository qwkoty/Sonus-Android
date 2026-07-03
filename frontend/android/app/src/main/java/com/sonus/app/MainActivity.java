package com.sonus.app;

import android.content.Intent;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginHandle;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CookieReaderPlugin.class);
        super.onCreate(savedInstanceState);

        // 允许 WebView 在无用户手势的情况下播放媒体（关键：Audio 元素自动播放）
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            WebSettings settings = webView.getSettings();
            settings.setMediaPlaybackRequiresUserGesture(false);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == 1001) {
            PluginHandle handle = getBridge().getPlugin("CookieReader");
            if (handle != null) {
                Plugin plugin = handle.getInstance();
                if (plugin instanceof CookieReaderPlugin) {
                    boolean loggedIn = resultCode == RESULT_OK;
                    ((CookieReaderPlugin) plugin).notifyLoginResult(loggedIn);
                }
            }
        }
    }
}
