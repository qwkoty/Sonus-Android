import { create } from 'zustand';
import { music } from '../api/music';

const STORAGE_KEY = 'sonus_auth';

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (obj && obj.cookie && obj.uin) return obj;
  } catch {}
  return null;
}

function savePersisted(state) {
  try {
    if (state.isLoggedIn) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        isLoggedIn: true,
        cookie: state.cookie,
        uin: state.uin,
        key: state.key,
        nickname: state.nickname,
      }));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {}
}

export const useAuthStore = create((set, get) => {
  const persisted = loadPersisted();

  return {
    // 登录态
    isLoggedIn: !!(persisted && persisted.cookie && persisted.uin),
    cookie: persisted?.cookie || '',
    uin: persisted?.uin || '',
    key: persisted?.key || '',
    nickname: persisted?.nickname || 'QQ音乐用户',
    userInfo: null,
    loadingInfo: false,

    // 登录成功后写入
    setAuth: ({ cookie, uin, key, nickname }) => {
      const next = {
        isLoggedIn: true,
        cookie,
        uin: String(uin || ''),
        key: key || '',
        nickname: nickname || 'QQ音乐用户',
        userInfo: null,
      };
      set(next);
      savePersisted(next);
      // 拉取用户详细信息
      get().fetchUserInfo();
    },

    fetchUserInfo: async () => {
      const { cookie, uin, isLoggedIn } = get();
      if (!isLoggedIn || !cookie || !uin) return;
      set({ loadingInfo: true });
      try {
        const info = await music.userInfo(cookie, uin);
        set({ userInfo: info, nickname: info?.nickname || get().nickname, loadingInfo: false });
      } catch (e) {
        set({ loadingInfo: false });
      }
    },

    logout: () => {
      const next = {
        isLoggedIn: false,
        cookie: '',
        uin: '',
        key: '',
        nickname: 'QQ音乐用户',
        userInfo: null,
        loadingInfo: false,
      };
      set(next);
      savePersisted(next);
    },
  };
});
