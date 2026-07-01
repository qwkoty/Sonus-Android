import { create } from 'zustand';
import { music } from '../api/music';
import { getAudio, initAudioSystem, readFrequencyData } from '../audio/engine';

const demoPlaylist = [
  { id: 1, title: 'Midnight City', artist: 'M83', cover: 'https://picsum.photos/seed/midnight/400/400', url: '', platform: 'demo' },
  { id: 2, title: 'Nightcall', artist: 'Kavinsky', cover: 'https://picsum.photos/seed/nightcall/400/400', url: '', platform: 'demo' },
  { id: 3, title: 'Instant Crush', artist: 'Daft Punk', cover: 'https://picsum.photos/seed/instant/400/400', url: '', platform: 'demo' },
  { id: 4, title: 'The Less I Know', artist: 'Tame Impala', cover: 'https://picsum.photos/seed/less/400/400', url: '', platform: 'demo' },
  { id: 5, title: 'Space Song', artist: 'Beach House', cover: 'https://picsum.photos/seed/space/400/400', url: '', platform: 'demo' },
];

function loadPlaylists() {
  try { return JSON.parse(localStorage.getItem('sonus_playlists') || '[]'); } catch { return []; }
}
function savePlaylists(list) { localStorage.setItem('sonus_playlists', JSON.stringify(list)); }

function loadQQAuth() {
  try { return JSON.parse(localStorage.getItem('sonus_qq_auth') || 'null'); } catch { return null; }
}
function saveQQAuth(auth) { localStorage.setItem('sonus_qq_auth', JSON.stringify(auth)); }

function loadPlatform() {
  try { return localStorage.getItem('sonus_platform') || 'none'; } catch { return 'none'; }
}
function savePlatform(p) { localStorage.setItem('sonus_platform', p); }

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
    const { playMode } = get();
    if (playMode === 'single') {
      audio.currentTime = 0;
      audio.play().catch(() => {});
      set({ isPlaying: true });
    } else {
      get().next();
    }
  });

  audio.addEventListener('error', () => {
    console.error('Audio error', audio.error);
    set({ isPlaying: false });
  });

  return {
    currentTrack: demoPlaylist[0],
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 0.8,
    playlist: demoPlaylist,
    playMode: 'list',
    liked: new Set(),
    isLoadingUrl: false,
    playlists: loadPlaylists(),
    qqAuth: loadQQAuth(),
    platform: loadPlatform(),
    lyrics: [],
    currentLyric: '',

    audio,

    setPlaylist: (list) => set({ playlist: list }),

    playTrack: async (track) => {
      initAudioSystem();
      const { audio } = get();
      set({ currentTrack: track, isPlaying: false, currentTime: 0, duration: 0, isLoadingUrl: true, lyrics: [], currentLyric: '' });

      let url = track.url || '';

      if (!url && track.platform && track.rawId) {
        try {
          const res = await music.url(track.rawId, track.platform);
          url = res?.data?.url || '';
        } catch (err) {
          console.error('获取播放链接失败', err);
        }
      }

      if (!url && track.platform === 'demo') {
        url = 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3';
      }

      // 加载歌词
      if (track.platform && track.rawId && track.platform !== 'demo') {
        try {
          const lyricRes = await music.lyric(track.rawId, track.platform);
          const parsed = parseLyric(lyricRes?.data?.lyric || '');
          set({ lyrics: parsed });
        } catch (e) {
          // ignore
        }
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
          set({ isPlaying: false, isLoadingUrl: false });
        }
      } else {
        set({ isLoadingUrl: false });
      }
    },

    // 预加载搜索结果的URL
    preloadUrls: async (tracks) => {
      const toFetch = tracks.filter((t) => t.platform && t.rawId && !t.url).slice(0, 5);
      await Promise.all(
        toFetch.map(async (t) => {
          try {
            const res = await music.url(t.rawId, t.platform);
            const url = res?.data?.url || '';
            if (url) t.url = url;
          } catch (e) {
            // ignore
          }
        })
      );
    },

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
          audio.play().then(() => set({ isPlaying: true })).catch((err) => {
            console.error('播放失败', err);
            set({ isPlaying: false });
          });
        } else {
          get().playTrack(currentTrack);
        }
      }
    },

    pause: () => {
      const { audio } = get();
      audio.pause();
      set({ isPlaying: false });
    },

    next: () => {
      const { playlist, currentTrack, playMode } = get();
      if (!playlist.length) return;
      let idx = playlist.findIndex((t) => t.id === currentTrack?.id);
      if (idx === -1) idx = 0;

      if (playMode === 'random') {
        let nextIdx = Math.floor(Math.random() * playlist.length);
        while (nextIdx === idx && playlist.length > 1) {
          nextIdx = Math.floor(Math.random() * playlist.length);
        }
        get().playTrack(playlist[nextIdx]);
        return;
      }
      idx = (idx + 1) % playlist.length;
      get().playTrack(playlist[idx]);
    },

    prev: () => {
      const { playlist, currentTrack } = get();
      if (!playlist.length) return;
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
      const { audio } = get();
      const vol = Math.max(0, Math.min(1, v));
      if (audio) audio.volume = vol;
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

    // 歌单系统
    createPlaylist: (name) => {
      const newPlaylist = { id: Date.now().toString(), name, tracks: [], createdAt: Date.now() };
      set((s) => { const next = [...s.playlists, newPlaylist]; savePlaylists(next); return { playlists: next }; });
    },
    deletePlaylist: (id) => set((s) => { const next = s.playlists.filter((p) => p.id !== id); savePlaylists(next); return { playlists: next }; }),
    addToPlaylist: (playlistId, track) => {
      set((s) => {
        const next = s.playlists.map((p) => {
          if (p.id !== playlistId) return p;
          if (p.tracks.some((t) => t.id === track.id)) return p;
          return { ...p, tracks: [...p.tracks, track] };
        });
        savePlaylists(next);
        return { playlists: next };
      });
    },
    removeFromPlaylist: (playlistId, trackId) => {
      set((s) => {
        const next = s.playlists.map((p) => {
          if (p.id !== playlistId) return p;
          return { ...p, tracks: p.tracks.filter((t) => t.id !== trackId) };
        });
        savePlaylists(next);
        return { playlists: next };
      });
    },
    playPlaylist: (playlistId) => {
      const { playlists } = get();
      const pl = playlists.find((p) => p.id === playlistId);
      if (pl && pl.tracks.length) {
        set({ playlist: pl.tracks });
        get().playTrack(pl.tracks[0]);
      }
    },

    // 平台选择
    setPlatform: (p) => {
      savePlatform(p);
      set({ platform: p });
    },


  };
});
