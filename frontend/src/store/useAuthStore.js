import { create } from 'zustand';
import { music } from '../api/music';
import { getActiveSource } from '../sources/registry';

const STORAGE_KEY = 'sonus_auth';

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (obj && obj.cookie && obj.uin) return { ...obj, sourceId: obj.sourceId || 'qq' };
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
        sourceId: state.sourceId || 'qq',
      }));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {}
}

export const useAuthStore = create((set, get) => {
  const persisted = loadPersisted();

  return {
    isLoggedIn: !!(persisted && persisted.cookie && persisted.uin),
    cookie: persisted?.cookie || '',
    uin: persisted?.uin || '',
    key: persisted?.key || '',
    nickname: persisted?.nickname || 'QQ音乐用户',
    sourceId: persisted?.sourceId || 'qq',
    userInfo: null,
    loadingInfo: false,

    // 登录成功写入（由 Login 页调用）
    setAuth: ({ cookie, uin, key, nickname }) => {
      const next = {
        isLoggedIn: true,
        cookie,
        uin: String(uin || ''),
        key: key || '',
        sourceId: getActiveSource().id,
        nickname: nickname || 'QQ音乐用户',
        userInfo: null,
      };
      set(next);
      savePersisted(next);
      get().fetchUserInfo();
    },

    fetchUserInfo: async () => {
      const { cookie, uin, isLoggedIn } = get();
      if (!isLoggedIn || !cookie || !uin) return;
      set({ loadingInfo: true });
      try {
        const info = await music.userInfo(cookie, uin);
        console.log('[fetchUserInfo] result:', info);
        set({ userInfo: info, nickname: info?.nickname || get().nickname, loadingInfo: false });
      } catch (e) {
        console.error('[fetchUserInfo] failed:', e);
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
