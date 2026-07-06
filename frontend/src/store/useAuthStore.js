import { create } from 'zustand';
import { music } from '../api/music';
import { CookieReader } from '../plugins/CookieReader';

const STORAGE_KEY = 'sonus_auth';

// QQ 音乐登录态持久化
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
    // ===== QQ 音乐字段（保持原有行为不变） =====
    isLoggedIn: !!(persisted && persisted.cookie && persisted.uin),
    cookie: persisted?.cookie || '',
    uin: persisted?.uin || '',
    key: persisted?.key || '',
    nickname: persisted?.nickname || 'QQ音乐用户',
    userInfo: null,
    loadingInfo: false,

    // 登录成功写入（由 Login 页调用）
    setAuth: ({ cookie, uin, key, nickname, avatar }) => {
      const next = {
        isLoggedIn: true,
        cookie,
        uin: String(uin || ''),
        key: key || '',
        nickname: nickname || 'QQ音乐用户',
        userInfo: avatar ? { avatar } : null,
      };
      set(next);
      savePersisted(next);
      get().fetchUserInfo();
    },

    fetchUserInfo: async () => {
      const { cookie, uin, isLoggedIn, userInfo } = get();
      if (!isLoggedIn || !cookie || !uin) return;
      set({ loadingInfo: true });
      try {
        const info = await music.userInfo(cookie, uin);
        console.log('[fetchUserInfo] result:', info);
        // 保留 WebView 已提取的头像
        if (userInfo?.avatar && !info?.avatar) info.avatar = userInfo.avatar;
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
