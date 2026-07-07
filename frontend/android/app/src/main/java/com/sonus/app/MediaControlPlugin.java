package com.sonus.app;

import android.content.Intent;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * MediaControlPlugin — Capacitor 桥接到 Android 前台媒体播放服务。
 * 前端通过本插件初始化 MediaSession、更新播放状态和歌曲信息，并接收通知栏按钮事件。
 */
@CapacitorPlugin(name = "MediaControl")
public class MediaControlPlugin extends Plugin {

    @Override
    public void load() {
        super.load();
        MusicPlaybackService.setPlugin(this);
    }

    @PluginMethod
    public void initMediaSession(PluginCall call) {
        Intent intent = new Intent(getContext(), MusicPlaybackService.class);
        intent.setAction(MusicPlaybackService.ACTION_INIT);
        putTrackInfo(intent, call);
        startService(intent);
        call.resolve();
    }

    @PluginMethod
    public void updatePlaybackState(PluginCall call) {
        Intent intent = new Intent(getContext(), MusicPlaybackService.class);
        intent.setAction(MusicPlaybackService.ACTION_UPDATE_PLAYBACK_STATE);
        intent.putExtra("isPlaying", call.getBoolean("isPlaying", false));
        double position = call.getDouble("position", 0.0);
        double duration = call.getDouble("duration", 0.0);
        intent.putExtra("position", (long) (position * 1000));
        intent.putExtra("duration", (long) (duration * 1000));
        startService(intent);
        call.resolve();
    }

    @PluginMethod
    public void updateMetadata(PluginCall call) {
        Intent intent = new Intent(getContext(), MusicPlaybackService.class);
        intent.setAction(MusicPlaybackService.ACTION_UPDATE_METADATA);
        putTrackInfo(intent, call);
        startService(intent);
        call.resolve();
    }

    @PluginMethod
    public void release(PluginCall call) {
        Intent intent = new Intent(getContext(), MusicPlaybackService.class);
        intent.setAction(MusicPlaybackService.ACTION_RELEASE);
        startService(intent);
        call.resolve();
    }

    private void putTrackInfo(Intent intent, PluginCall call) {
        intent.putExtra("title", call.getString("title", ""));
        intent.putExtra("artist", call.getString("artist", ""));
        intent.putExtra("album", call.getString("album", ""));
        intent.putExtra("coverUrl", call.getString("coverUrl", ""));
    }

    private void startService(Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }
    }

    public void notifyAction(String action) {
        JSObject data = new JSObject();
        data.put("action", action);
        notifyListeners("mediaControlEvent", data, true);
    }
}
