package com.sonus.app;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginHandle;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CookieReaderPlugin.class);
        super.onCreate(savedInstanceState);
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
