import { create } from 'zustand';
import { music } from '../api/music';
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

// 从 auth store 取登录态（用于解锁 VIP 音源）
function authCreds() {
  const { cookie, uin } = useAuthStore.getState();
  return { cookie: cookie || '', uin: uin || '0' };
}

export const usePlayerStore = create((set, get) => {
  const audio = getAudio();

  audio.addEventListener('timeupdate', () => {
    const time = audio.currentTime || 0;
    const { lyrics, duration } = get();
    // 流式音频 duration 可能为 Infinity，尝试从 seekable 修复
    if ((!duration || !isFinite(duration)) && audio.seekable && audio.seekable.length > 0) {
      const d = audio.seekable.end(audio.seekable.length - 1);
      if (isFinite(d) && d > 0) set({ duration: d });
    }
    set({ currentTime: time, currentLyric: getCurrentLyric(lyrics, time) });
  });

  audio.addEventListener('loadedmetadata', () => {
    let d = audio.duration;
    // 流代理下 duration 常为 Infinity，回退到 track 元数据
    if (!isFinite(d) || !d) {
      const { currentTrack } = get();
      d = currentTrack?.duration || 0;
    }
    set({ duration: d });
  });

  audio.addEventListener('progress', () => {
    // duration 为 Infinity 时，从 seekable 末尾取真实时长
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
    console.error('Audio error', audio.error);
    set({ isPlaying: false, isLoadingUrl: false, error: '音源加载失败，自动切换下一首' });
    setTimeout(() => {
      const { playMode, currentTrack } = get();
      if (currentTrack && playMode !== 'single') get().next();
    }, 3000);
  });

  return {
    currentTrack: null,
    isPlaying: false,
    currentTime: 0,
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

    // 替换播放队列并播放指定曲目（用于歌单/搜索点击）
    playTrackFromList: (track, list) => {
      if (list && list.length) set({ playlist: list });
      get().playTrack(track);
    },

    playTrack: async (track) => {
      initAudioSystem();
      const { audio } = get();
      // 立即用 track.duration 兜底，避免流式加载期间 duration=0 进度条不可用
      set({ currentTrack: track, isPlaying: false, currentTime: 0, duration: track?.duration || 0, isLoadingUrl: true, lyrics: [], currentLyric: '', error: null });

      const { playlist } = get();
      if (!playlist.some((t) => t.id === track.id)) {
        set({ playlist: [...playlist, track] });
      }

      // 取登录态，解锁 VIP
      const { cookie, uin } = authCreds();

      let url = track.url || '';
      if (!url && track.rawId) {
        // APK 模式优先用 Blob URL（绕过 CORS），浏览器模式用后端代理
        if (music.streamBlob) {
          const blobUrl = await music.streamBlob(track.rawId, cookie, uin);
          if (blobUrl) url = blobUrl;
        }
        if (!url) {
          const streamResult = music.stream(track.rawId, cookie, uin);
          url = (typeof streamResult?.then === 'function') ? await streamResult : streamResult;
        }
      }

      // 加载歌词
      if (track.rawId) {
        try {
          const lyricRes = await music.lyric(track.rawId);
          const parsed = parseLyric(lyricRes?.lyric || '');
          set({ lyrics: parsed });
        } catch (e) {}
      }

      if (url) {
        audio.src = url;
        audio.volume = get().volume;
        audio.load();
        try {
          await audio.play();
          set({ isPlaying: true, isLoadingUrl: false, currentTrack: { ...track, url } });
        } catch (err) {
          console.error('播放失败', err);
          set({ isPlaying: false, isLoadingUrl: false, error: '播放失败，可能是版权限制或网络问题' });
        }
      } else {
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
      // audio.duration 可能是 Infinity，用 store 里的 duration（已用 track 元数据兜底）作为上限
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
