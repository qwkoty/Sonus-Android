import { create } from 'zustand';
import { music } from '../api/music';

const demoPlaylist = [
  { id: 1, title: 'Midnight City', artist: 'M83', cover: 'https://picsum.photos/seed/midnight/400/400', url: '' },
  { id: 2, title: 'Nightcall', artist: 'Kavinsky', cover: 'https://picsum.photos/seed/nightcall/400/400', url: '' },
  { id: 3, title: 'Instant Crush', artist: 'Daft Punk', cover: 'https://picsum.photos/seed/instant/400/400', url: '' },
  { id: 4, title: 'The Less I Know', artist: 'Tame Impala', cover: 'https://picsum.photos/seed/less/400/400', url: '' },
  { id: 5, title: 'Space Song', artist: 'Beach House', cover: 'https://picsum.photos/seed/space/400/400', url: '' },
];

export const usePlayerStore = create((set, get) => ({
  currentTrack: demoPlaylist[0],
  isPlaying: false,
  currentTime: 0,
  duration: 237,
  volume: 0.8,
  playlist: demoPlaylist,
  playMode: 'list',
  fullscreen: false,
  liked: new Set(),
  isLoadingUrl: false,

  setPlaylist: (list) => set({ playlist: list }),

  playTrack: async (track) => {
    set({ currentTrack: track, isPlaying: true, currentTime: 0, isLoadingUrl: false });

    // 聚合音源需要动态获取播放链接
    if (track.platform && track.rawId && !track.url) {
      set({ isLoadingUrl: true });
      try {
        const res = await music.url(track.rawId, track.platform);
        const url = res?.data?.url || '';
        set((s) => ({
          currentTrack: { ...s.currentTrack, url },
          isLoadingUrl: false,
        }));
      } catch (err) {
        console.error('获取播放链接失败', err);
        set({ isLoadingUrl: false });
      }
    }
  },

  togglePlay: () => set((s) => ({ isPlaying: !s.isPlaying })),

  pause: () => set({ isPlaying: false }),

  next: () => {
    const { playlist, currentTrack, playMode } = get();
    if (!playlist.length) return;
    let idx = playlist.findIndex((t) => t.id === currentTrack?.id);
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
    idx = (idx - 1 + playlist.length) % playlist.length;
    get().playTrack(playlist[idx]);
  },

  seek: (time) => set({ currentTime: time }),
  setDuration: (d) => set({ duration: d }),
  setVolume: (v) => set({ volume: v }),

  toggleMode: () => set((s) => {
    const modes = ['list', 'random', 'single'];
    const i = modes.indexOf(s.playMode);
    return { playMode: modes[(i + 1) % modes.length] };
  }),

  toggleFullscreen: () => set((s) => ({ fullscreen: !s.fullscreen })),

  toggleLike: (id) => set((s) => {
    const next = new Set(s.liked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return { liked: next };
  }),

  tick: () => set((s) => {
    if (!s.isPlaying) return {};
    const next = s.currentTime + 1;
    if (next >= s.duration) {
      if (s.playMode === 'single') return { currentTime: 0 };
      get().next();
      return {};
    }
    return { currentTime: next };
  }),
}));
