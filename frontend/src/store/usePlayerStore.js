import { create } from 'zustand';
import { music } from '../api/music';
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

export const usePlayerStore = create((set, get) => {
  const audio = getAudio();

  audio.addEventListener('timeupdate', () => {
    const time = audio.currentTime || 0;
    const { lyrics } = get();
    set({ currentTime: time, currentLyric: getCurrentLyric(lyrics, time) });
  });

  audio.addEventListener('loadedmetadata', () => {
    set({ duration: audio.duration || 0 });
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
    liked: new Set(),
    isLoadingUrl: false,
    error: null,
    lyrics: [],
    currentLyric: '',
    audio,

    setPlaylist: (list) => set({ playlist: list }),

    playTrack: async (track) => {
      initAudioSystem();
      const { audio } = get();
      set({ currentTrack: track, isPlaying: false, currentTime: 0, duration: 0, isLoadingUrl: true, lyrics: [], currentLyric: '', error: null });

      const { playlist } = get();
      if (!playlist.some((t) => t.id === track.id)) {
        set({ playlist: [...playlist, track] });
      }

      let url = track.url || '';
      if (!url && track.platform && track.rawId) {
        url = music.stream(track.rawId, track.platform);
      }

      // 加载歌词
      if (track.platform && track.rawId) {
        try {
          const lyricRes = await music.lyric(track.rawId, track.platform);
          const parsed = parseLyric(lyricRes?.data?.lyric || '');
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
    preloadUrls: async () => {},

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
      const { audio } = get();
      if (audio && audio.duration) {
        audio.currentTime = Math.max(0, Math.min(time, audio.duration));
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

    toggleLike: (id) => set((s) => {
      const next = new Set(s.liked);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { liked: next };
    }),
  };
});
