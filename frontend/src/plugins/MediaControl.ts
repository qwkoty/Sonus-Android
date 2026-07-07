// MediaControl — Capacitor 原生媒体控制插件桥接
import { registerPlugin, PluginListenerHandle } from '@capacitor/core';

export interface TrackInfo {
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
}

export interface PlaybackState {
  isPlaying: boolean;
  position: number;
  duration: number;
}

export interface MediaControlPlugin {
  initMediaSession(options: TrackInfo): Promise<void>;
  updatePlaybackState(options: PlaybackState): Promise<void>;
  updateMetadata(options: TrackInfo): Promise<void>;
  release(): Promise<void>;
  addListener(
    eventName: 'mediaControlEvent',
    listener: (data: { action: 'togglePlay' | 'next' | 'prev' }) => void
  ): Promise<PluginListenerHandle>;
}

const Native = registerPlugin<MediaControlPlugin>('MediaControl');
const IS_CAP = () => {
  if (typeof window === 'undefined') return false;
  const w = window as any;
  return !!w.Capacitor?.isNativePlatform?.();
};

export const MediaControl = {
  isAvailable: IS_CAP,
  initMediaSession: async (track: TrackInfo): Promise<void> => {
    if (!IS_CAP()) return;
    return Native.initMediaSession({
      title: track.title || '',
      artist: track.artist || '',
      album: track.album || '',
      coverUrl: track.coverUrl || '',
    });
  },
  updatePlaybackState: async (state: PlaybackState): Promise<void> => {
    if (!IS_CAP()) return;
    return Native.updatePlaybackState({
      isPlaying: !!state.isPlaying,
      position: state.position || 0,
      duration: state.duration || 0,
    });
  },
  updateMetadata: async (track: TrackInfo): Promise<void> => {
    if (!IS_CAP()) return;
    return Native.updateMetadata({
      title: track.title || '',
      artist: track.artist || '',
      album: track.album || '',
      coverUrl: track.coverUrl || '',
    });
  },
  release: async (): Promise<void> => {
    if (!IS_CAP()) return;
    return Native.release();
  },
  onMediaControlEvent: (
    callback: (action: 'togglePlay' | 'next' | 'prev') => void
  ): (() => void) => {
    if (!IS_CAP()) return () => {};
    let handle: PluginListenerHandle | null = null;
    Native.addListener('mediaControlEvent', (data) => {
      callback(data.action);
    }).then((h) => {
      handle = h;
    });
    return () => {
      if (handle) {
        handle.remove();
      }
    };
  },
};

export default MediaControl;
