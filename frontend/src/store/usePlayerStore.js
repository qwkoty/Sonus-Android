import { create } from 'zustand';
import { music } from '../api/music';
import { netease } from '../api/netease';
import { useAuthStore } from './useAuthStore';
import { getAudio, initAudioSystem } from '../audio/engine';

function parseLyric(lrcText) {
  if (!lrcText) return [];
  const lines = lrcText.split('\n');
  const result = [];
  const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;
  for (const line of lines) {
    const match = line.match(timeRegex);
    if (match) {
      const min = parseInt(match[1]);
      const sec = parseInt(match[2]);
      const ms = parseInt(match[3].padEnd(3, '0'));
      const time = min * 60 + sec + ms / 1000;
      const text = line.replace(timeRegex, '').trim();
      if (text) result.push({ time, text });
    }
  }
  return result.sort((a, b) => a.time - b.time);
}

function getCurrentLyric(lyrics, time) {
  if (!lyrics || !lyrics.length) return '';
  let current = '';
  for (const line of lyrics) {
    if (line.time <= time) current = line.text;
    else break;
  }
  return current;
}

function authCreds() {
  const { cookie, uin, key } = useAuthStore.getState();
  return { cookie: cookie || '', uin: uin || '0', key: key || '' };
}

export const usePlayerStore = create((set, get) => {
  const audio = getAudio();

  audio.addEventListener('timeupdate', () => {
    const time = audio.currentTime || 0;
    const { lyrics, duration } = get();
    if ((!duration || !isFinite(duration)) && audio.seekable && audio.seekable.length > 0) {
      const d = audio.seekable.end(audio.seekable.length - 1);
      if (isFinite(d) && d > 0) set({ duration: d });
    }
    set({ currentTime: time, currentLyric: getCurrentLyric(lyrics, time) });
  });

  // 歌词高亮需要比 timeupdate 更平滑的时间，用 RAF 单独更新 lyricTime
  let lyricRaf = 0;
  const updateLyricTime = () => {
    const { isPlaying } = get();
    if (isPlaying && audio) {
      set({ lyricTime: audio.currentTime || 0 });
    }
    lyricRaf = requestAnimationFrame(updateLyricTime);
  };
  lyricRaf = requestAnimationFrame(updateLyricTime);

  audio.addEventListener('loadedmetadata', () => {
    let d = audio.duration;
    if (!isFinite(d) || !d) {
      const { currentTrack } = get();
      d = currentTrack?.duration || 0;
    }
    set({ duration: d });
  });

  audio.addEventListener('progress', () => {
    if (audio.seekable && audio.seekable.length > 0) {
      const d = audio.seekable.end(audio.seekable.length - 1);
      if (isFinite(d) && d > 0) {
        const { duration } = get();
        if (!duration || !isFinite(duration) || Math.abs(duration - d) > 1) {
          set({ duration: d });
        }
      }
    }
  });

  audio.addEventListener('ended', () => {
    const { playMode, playlist } = get();
    if (playMode === 'single' || playlist.length <= 1) {
      audio.currentTime = 0;
      audio.play().catch(() => {});
      set({ isPlaying: true });
    } else {
      get().next();
    }
  });

  audio.addEventListener('error', () => {
    const err = audio.error;
    console.error('Audio error', err?.code, err?.message, audio.src);
    set({ isPlaying: false, isLoadingUrl: false, error: `音源加载失败 (${err?.code || '?'})，自动切换下一首` });
    setTimeout(() => {
      const { playMode, currentTrack } = get();
      if (currentTrack && playMode !== 'single') get().next();
    }, 3000);
  });

  return {
    currentTrack: null,
    isPlaying: false,
    currentTime: 0,
    lyricTime: 0,
    duration: 0,
    volume: 0.8,
    playlist: [],
    playMode: 'list',
    isLoadingUrl: false,
    error: null,
    lyrics: [],
    currentLyric: '',
    audio,

    setPlaylist: (list) => set({ playlist: list }),

    playTrackFromList: (track, list) => {
      if (list && list.length) set({ playlist: list });
      get().playTrack(track);
    },

    playTrack: async (track) => {
      initAudioSystem();
      const { audio } = get();
      set({
        currentTrack: track,
        isPlaying: false,
        currentTime: 0,
        lyricTime: 0,
        duration: track?.duration || 0,
        isLoadingUrl: true,
        lyrics: [],
        currentLyric: '',
        error: null,
      });

      const { playlist } = get();
      if (!playlist.some((t) => t.id === track.id)) {
        set({ playlist: [...playlist, track] });
      }

      const { cookie, uin, key } = authCreds();
      // 网易云登录态（独立于 QQ）
      const { neteaseCookie } = useAuthStore.getState();
      const isNcm = track.platform === 'ncm';

      let url = track.url || '';
      if (!url && track.rawId) {
        try {
          if (isNcm) {
            // 网易云：通过 ncm.songUrl 获取，URL 已包装为本地代理
            url = await netease.songUrl(track.rawId, neteaseCookie || '');
            if (!url) {
              console.warn('[playTrack] ncm songUrl 返回空 (可能 VIP/版权)', track.rawId);
            }
          } else {
            // QQ 音乐：原有流程
            url = await music.stream(track.rawId, cookie, uin, key, track.mediaMid || '');
            if (!url) {
              console.warn('[playTrack] qq stream 返回空 (可能 VIP/版权)', track.rawId);
            }
          }
        } catch (e) {
          console.error('获取播放链接失败', e);
        }
      } else if (!track.rawId) {
        console.warn('[playTrack] track.rawId 为空，无法获取播放链接', track);
      }

      if (track.rawId) {
        try {
          // 平台感知获取歌词
          const lyricText = isNcm
            ? await netease.lyric(track.rawId, neteaseCookie || '')
            : await music.lyric(track.rawId);
          const parsed = parseLyric(lyricText || '');
          set({ lyrics: parsed });
        } catch (e) {}
      }

      if (url) {
        console.log('[playTrack] set src', url);
        audio.src = url;
        audio.volume = get().volume;
        audio.load();
        try {
          await audio.play();
          console.log('[playTrack] play started');
          set({ isPlaying: true, isLoadingUrl: false, currentTrack: { ...track, url } });
        } catch (err) {
          console.error('[playTrack] play() failed', err);
          set({ isPlaying: false, isLoadingUrl: false, error: '播放失败，可能是版权限制或网络问题' });
        }
      } else {
        console.warn('[playTrack] no url');
        set({ isLoadingUrl: false, error: '暂无音源，换一首试试' });
      }
    },

    clearError: () => set({ error: null }),
    setError: (msg) => set({ error: msg }),

    togglePlay: () => {
      initAudioSystem();
      const { audio, isPlaying, currentTrack } = get();
      if (!currentTrack) return;
      if (isPlaying) {
        audio.pause();
        set({ isPlaying: false });
      } else {
        const hasSrc = audio.src && audio.src !== '' && !audio.src.endsWith('/');
        if (hasSrc) {
          audio.play().then(() => set({ isPlaying: true })).catch(() => set({ isPlaying: false }));
        } else {
          get().playTrack(currentTrack);
        }
      }
    },

    pause: () => {
      get().audio.pause();
      set({ isPlaying: false });
    },

    next: () => {
      const { playlist, currentTrack, playMode, audio } = get();
      if (!playlist.length) return;
      if (playlist.length === 1) {
        if (audio) { audio.currentTime = 0; audio.play().catch(() => {}); set({ isPlaying: true }); }
        return;
      }
      let idx = playlist.findIndex((t) => t.id === currentTrack?.id);
      if (idx === -1) idx = 0;
      if (playMode === 'random') {
        let nextIdx = Math.floor(Math.random() * playlist.length);
        while (nextIdx === idx && playlist.length > 1) nextIdx = Math.floor(Math.random() * playlist.length);
        get().playTrack(playlist[nextIdx]);
        return;
      }
      idx = (idx + 1) % playlist.length;
      get().playTrack(playlist[idx]);
    },

    prev: () => {
      const { playlist, currentTrack, audio } = get();
      if (!playlist.length) return;
      if (playlist.length === 1) {
        if (audio) { audio.currentTime = 0; audio.play().catch(() => {}); set({ isPlaying: true }); }
        return;
      }
      let idx = playlist.findIndex((t) => t.id === currentTrack?.id);
      if (idx === -1) idx = 0;
      idx = (idx - 1 + playlist.length) % playlist.length;
      get().playTrack(playlist[idx]);
    },

    seek: (time) => {
      const { audio, duration } = get();
      if (!audio) return;
      const maxTime = (isFinite(audio.duration) && audio.duration > 0) ? audio.duration : (duration || 0);
      if (maxTime > 0) {
        audio.currentTime = Math.max(0, Math.min(time, maxTime));
        set({ currentTime: audio.currentTime });
      }
    },

    setVolume: (v) => {
      const vol = Math.max(0, Math.min(1, v));
      if (get().audio) get().audio.volume = vol;
      set({ volume: vol });
    },

    toggleMode: () => set((s) => {
      const modes = ['list', 'random', 'single'];
      const i = modes.indexOf(s.playMode);
      return { playMode: modes[(i + 1) % modes.length] };
    }),
  };
});
