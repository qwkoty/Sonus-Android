import { create } from 'zustand';
import { music } from '../api/music';
import { getAudio, initAudioSystem, readFrequencyData } from '../audio/engine';

// 初始播放列表为空，用户搜索播放后自动加入
const demoPlaylist = [];

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

// 读取登录态 cookie（网易云 MUSIC_U / QQ 的 uin+key）
function loadNeteaseCookie() {
  try { return localStorage.getItem('sonus_netease_cookie') || ''; } catch { return ''; }
}
function saveNeteaseCookie(c) { localStorage.setItem('sonus_netease_cookie', c); }
function loadNeteaseUser() {
  try { return JSON.parse(localStorage.getItem('sonus_netease_user') || 'null'); } catch { return null; }
}
function saveNeteaseUser(u) { localStorage.setItem('sonus_netease_user', JSON.stringify(u)); }

function loadQQCookie() {
  try { return JSON.parse(localStorage.getItem('sonus_qq_cookie') || 'null'); } catch { return null; }
}
function saveQQCookie(c) { localStorage.setItem('sonus_qq_cookie', JSON.stringify(c)); }
function loadQQUser() {
  try { return JSON.parse(localStorage.getItem('sonus_qq_user') || 'null'); } catch { return null; }
}
function saveQQUser(u) { localStorage.setItem('sonus_qq_user', JSON.stringify(u)); }

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
    if (playMode === 'single') {
      audio.currentTime = 0;
      audio.play().catch(() => {});
      set({ isPlaying: true });
    } else if (playlist.length <= 1) {
      // 列表只有一首时自动循环播放
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
    // 3 秒后自动切换下一首（非单曲循环时）
    setTimeout(() => {
      const { playMode, currentTrack } = get();
      if (currentTrack && playMode !== 'single') {
        get().next();
      }
    }, 3000);
  });

  return {
    currentTrack: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 0.8,
    playlist: demoPlaylist,
    playMode: 'list',
    liked: new Set(),
    isLoadingUrl: false,
    error: null,
    playlists: loadPlaylists(),
    qqAuth: loadQQAuth(),
    platform: loadPlatform(),
    lyrics: [],
    currentLyric: '',
    // 登录态
    neteaseCookie: loadNeteaseCookie(),
    neteaseUser: loadNeteaseUser(),
    qqCookie: loadQQCookie(),
    qqUser: loadQQUser(),

    audio,

    setPlaylist: (list) => set({ playlist: list }),

    playTrack: async (track) => {
      initAudioSystem();
      const { audio } = get();
      set({ currentTrack: track, isPlaying: false, currentTime: 0, duration: 0, isLoadingUrl: true, lyrics: [], currentLyric: '', error: null });

      // 自动加入播放列表（若未存在），保证列表非空、可循环/切歌
      const { playlist } = get();
      if (!playlist.some((t) => t.id === track.id)) {
        set({ playlist: [...playlist, track] });
      }

      let url = track.url || '';

      // 对于有 rawId 的非 demo 歌曲，使用同源流代理解决 CORS（登录后带 cookie 解锁 VIP）
      if (!url && track.platform && track.rawId && track.platform !== 'demo') {
        if (track.platform === 'netease') {
          const { neteaseCookie } = get();
          url = music.stream(track.rawId, track.platform, neteaseCookie || '');
        } else if (track.platform === 'qq') {
          const { qqCookie } = get();
          // QQ cookie 存为对象 { uin, key, raw }
          const cookieStr = qqCookie?.raw || '';
          url = music.stream(track.rawId, track.platform, cookieStr);
        } else {
          url = music.stream(track.rawId, track.platform);
        }
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
          set({ isPlaying: false, isLoadingUrl: false, error: '播放失败，可能是版权限制或网络问题' });
        }
      } else {
        set({ isLoadingUrl: false, error: '暂无音源，换一首试试' });
      }
    },

    clearError: () => set({ error: null }),
    setError: (msg) => set({ error: msg }),

    // 预加载：流代理模式下无需提前获取 URL
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
      const { playlist, currentTrack, playMode, audio } = get();
      if (!playlist.length) return;
      // 只有一首时重播当前，不切歌
      if (playlist.length === 1) {
        if (audio) { audio.currentTime = 0; audio.play().catch(() => {}); set({ isPlaying: true }); }
        return;
      }
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
      const { playlist, currentTrack, audio } = get();
      if (!playlist.length) return;
      // 只有一首时重播当前
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
    // 一键导入云歌单到本地（含完整歌曲）
    importPlaylist: (name, tracks, cover = '') => {
      const newPlaylist = { id: Date.now().toString(), name, tracks, cover, createdAt: Date.now() };
      set((s) => { const next = [...s.playlists, newPlaylist]; savePlaylists(next); return { playlists: next }; });
      return newPlaylist.id;
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

    // ---- 登录态管理 ----
    setNeteaseAuth: (cookie, user) => {
      saveNeteaseCookie(cookie);
      saveNeteaseUser(user);
      set({ neteaseCookie: cookie, neteaseUser: user });
    },
    clearNeteaseAuth: () => {
      saveNeteaseCookie('');
      saveNeteaseUser(null);
      set({ neteaseCookie: '', neteaseUser: null });
    },
    setQQAuth: (cookieObj, user) => {
      // cookieObj: { uin, key, raw }
      saveQQCookie(cookieObj);
      saveQQUser(user);
      set({ qqCookie: cookieObj, qqUser: user });
    },
    clearQQAuth: () => {
      saveQQCookie(null);
      saveQQUser(null);
      set({ qqCookie: null, qqUser: null });
    },
  };
});
