package com.sonus.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import androidx.media.app.NotificationCompat.MediaStyle;

import java.io.InputStream;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 前台媒体播放服务。
 * 不实际播放音频，只通过 MediaSession + 通知保持后台存活并提供状态栏控制。
 */
public class MusicPlaybackService extends Service {

    public static final String ACTION_INIT = "com.sonus.app.action.INIT";
    public static final String ACTION_UPDATE_PLAYBACK_STATE = "com.sonus.app.action.UPDATE_PLAYBACK_STATE";
    public static final String ACTION_UPDATE_METADATA = "com.sonus.app.action.UPDATE_METADATA";
    public static final String ACTION_RELEASE = "com.sonus.app.action.RELEASE";

    public static final String ACTION_PLAY_PAUSE = "com.sonus.app.action.PLAY_PAUSE";
    public static final String ACTION_PREV = "com.sonus.app.action.PREV";
    public static final String ACTION_NEXT = "com.sonus.app.action.NEXT";

    private static final String CHANNEL_ID = "sonus_media_playback";
    private static final int NOTIFICATION_ID = 1001;

    private MediaSessionCompat mediaSession;
    private MediaActionReceiver receiver;
    private ExecutorService executor;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private boolean isPlaying = false;
    private long positionMs = 0;
    private long durationMs = 0;
    private String title = "";
    private String artist = "";
    private String album = "";
    private String coverUrl = "";

    private static MediaControlPlugin plugin;

    public static void setPlugin(MediaControlPlugin p) {
        plugin = p;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        executor = Executors.newSingleThreadExecutor();
        createNotificationChannel();
        initMediaSession();
        receiver = new MediaActionReceiver();
        IntentFilter filter = new IntentFilter();
        filter.addAction(ACTION_PLAY_PAUSE);
        filter.addAction(ACTION_PREV);
        filter.addAction(ACTION_NEXT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(receiver, filter);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            return START_STICKY;
        }
        String action = intent.getAction();
        if (action == null) {
            return START_STICKY;
        }
        switch (action) {
            case ACTION_INIT:
                readTrackInfo(intent);
                startForegroundWithNotification(null);
                updateMediaSession();
                loadCoverAndUpdate();
                break;
            case ACTION_UPDATE_PLAYBACK_STATE:
                isPlaying = intent.getBooleanExtra("isPlaying", false);
                positionMs = intent.getLongExtra("position", 0);
                durationMs = intent.getLongExtra("duration", 0);
                updateMediaSession();
                updateNotification(null);
                break;
            case ACTION_UPDATE_METADATA:
                readTrackInfo(intent);
                updateMediaSession();
                loadCoverAndUpdate();
                break;
            case ACTION_RELEASE:
                stopForeground(true);
                stopSelf();
                break;
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        try {
            unregisterReceiver(receiver);
        } catch (Exception ignored) {
        }
        if (executor != null) {
            executor.shutdownNow();
        }
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
            mediaSession = null;
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void initMediaSession() {
        mediaSession = new MediaSessionCompat(this, "SonusMediaSession");
        mediaSession.setFlags(
            MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS |
            MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
        );
        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                notifyAction("togglePlay");
            }

            @Override
            public void onPause() {
                notifyAction("togglePlay");
            }

            @Override
            public void onSkipToNext() {
                notifyAction("next");
            }

            @Override
            public void onSkipToPrevious() {
                notifyAction("prev");
            }
        });
        mediaSession.setActive(true);
    }

    private void readTrackInfo(Intent intent) {
        title = intent.getStringExtra("title");
        if (title == null) title = "";
        artist = intent.getStringExtra("artist");
        if (artist == null) artist = "";
        album = intent.getStringExtra("album");
        if (album == null) album = "";
        coverUrl = intent.getStringExtra("coverUrl");
        if (coverUrl == null) coverUrl = "";
    }

    private void updateMediaSession() {
        if (mediaSession == null) return;
        MediaMetadataCompat.Builder metaBuilder = new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, album)
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, Math.max(0, durationMs));
        mediaSession.setMetadata(metaBuilder.build());

        long actions = PlaybackStateCompat.ACTION_PLAY |
            PlaybackStateCompat.ACTION_PAUSE |
            PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS |
            PlaybackStateCompat.ACTION_SKIP_TO_NEXT;
        PlaybackStateCompat.Builder stateBuilder = new PlaybackStateCompat.Builder()
            .setState(
                isPlaying ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED,
                Math.max(0, positionMs),
                1.0f
            )
            .setActions(actions);
        mediaSession.setPlaybackState(stateBuilder.build());
    }

    private void startForegroundWithNotification(Bitmap cover) {
        Notification notification = buildNotification(cover);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
            );
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void updateNotification(Bitmap cover) {
        Notification notification = buildNotification(cover);
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(NOTIFICATION_ID, notification);
        }
        // 同时刷新前台服务通知，保证在锁屏/通知栏的显示一致
        startForegroundWithNotification(cover);
    }

    private Notification buildNotification(Bitmap cover) {
        PendingIntent playPauseIntent = PendingIntent.getBroadcast(
            this, 0, new Intent(ACTION_PLAY_PAUSE),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        PendingIntent prevIntent = PendingIntent.getBroadcast(
            this, 1, new Intent(ACTION_PREV),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        PendingIntent nextIntent = PendingIntent.getBroadcast(
            this, 2, new Intent(ACTION_NEXT),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        int playPauseIcon = isPlaying
            ? android.R.drawable.ic_media_pause
            : android.R.drawable.ic_media_play;
        String playPauseTitle = isPlaying ? "暂停" : "播放";

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(title.isEmpty() ? getString(R.string.app_name) : title)
            .setContentText(artist.isEmpty() ? album : artist + (album.isEmpty() ? "" : " - " + album))
            .setLargeIcon(cover)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .addAction(android.R.drawable.ic_media_previous, "上一首", prevIntent)
            .addAction(playPauseIcon, playPauseTitle, playPauseIntent)
            .addAction(android.R.drawable.ic_media_next, "下一首", nextIntent)
            .setStyle(
                new MediaStyle()
                    .setMediaSession(mediaSession.getSessionToken())
                    .setShowActionsInCompactView(0, 1, 2)
            );
        return builder.build();
    }

    private void loadCoverAndUpdate() {
        if (coverUrl == null || coverUrl.isEmpty()) {
            updateNotification(null);
            return;
        }
        executor.execute(() -> {
            Bitmap bitmap = loadBitmap(coverUrl);
            mainHandler.post(() -> updateNotification(bitmap));
        });
    }

    private Bitmap loadBitmap(String urlStr) {
        try {
            URL url = new URL(urlStr);
            try (InputStream is = url.openStream()) {
                return BitmapFactory.decodeStream(is);
            }
        } catch (Exception e) {
            android.util.Log.w("SonusMedia", "Failed to load cover: " + e.getMessage());
            return null;
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "媒体播放",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("显示后台音乐播放控制和进度");
            channel.setShowBadge(false);
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.createNotificationChannel(channel);
            }
        }
    }

    private static void notifyAction(String action) {
        if (plugin != null) {
            plugin.notifyAction(action);
        }
    }

    private class MediaActionReceiver extends BroadcastReceiver {
        @Override
        public void onReceive(Context context, Intent intent) {
            String action = intent.getAction();
            if (ACTION_PLAY_PAUSE.equals(action)) {
                notifyAction("togglePlay");
            } else if (ACTION_PREV.equals(action)) {
                notifyAction("prev");
            } else if (ACTION_NEXT.equals(action)) {
                notifyAction("next");
            }
        }
    }
}
