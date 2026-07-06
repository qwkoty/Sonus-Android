import { create } from 'zustand';
import { music } from '../api/music';
import { netease } from '../api/netease';
import { CookieReader } from '../plugins/CookieReader';

const STORAGE_KEY = 'sonus_auth';
const NETEASE_STORAGE_KEY = 'sonus_netease_auth';

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

// 网易云音乐登录态持久化
function loadNeteasePersisted() {
  try {
    const raw = localStorage.getItem(NETEASE_STORAGE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (obj && obj.cookie && obj.uid) return obj;
  } catch {}
  return null;
}

function saveNeteasePersisted(state) {
  try {
    if (state.neteaseLoggedIn) {
      localStorage.setItem(NETEASE_STORAGE_KEY, JSON.stringify({
        neteaseLoggedIn: true,
        neteaseCookie: state.neteaseCookie,
        neteaseUid: state.neteaseUid,
        neteaseNickname: state.neteaseNickname,
      }));
    } else {
      localStorage.removeItem(NETEASE_STORAGE_KEY);
    }
  } catch {}
}

export const useAuthStore = create((set, get) => {
  const persisted = loadPersisted();
  const ncmPersisted = loadNeteasePersisted();

  return {
    // ===== QQ 音乐字段（保持原有行为不变） =====
    isLoggedIn: !!(persisted && persisted.cookie && persisted.uin),
    cookie: persisted?.cookie || '',
    uin: persisted?.uin || '',
    key: persisted?.key || '',
    nickname: persisted?.nickname || 'QQ音乐用户',
    userInfo: null,
    loadingInfo: false,

    // ===== 网易云音乐字段 =====
    neteaseLoggedIn: !!(ncmPersisted && ncmPersisted.cookie && ncmPersisted.uid),
    neteaseCookie: ncmPersisted?.cookie || '',
    neteaseUid: ncmPersisted?.uid || '',
    neteaseNickname: ncmPersisted?.nickname || '网易云用户',
    neteaseUserInfo: null,
    loadingNeteaseInfo: false,

    // ===== QQ 音乐登录方法（原有，保持不变） =====
    // 登录成功写入（由 Login 页调用）
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

    // ===== 网易云音乐登录方法 =====
    // 写入网易云登录态，并拉取用户信息
    setNeteaseAuth: ({ cookie, uid, nickname }) => {
      const next = {
        neteaseLoggedIn: true,
        neteaseCookie: cookie,
        neteaseUid: String(uid || ''),
        neteaseNickname: nickname || '网易云用户',
        neteaseUserInfo: null,
      };
      set(next);
      saveNeteasePersisted(next);
      get().fetchNeteaseUserInfo();
    },

    // 拉取网易云用户信息
    fetchNeteaseUserInfo: async () => {
      const { neteaseCookie, neteaseLoggedIn } = get();
      if (!neteaseLoggedIn || !neteaseCookie) return;
      set({ loadingNeteaseInfo: true });
      try {
        const info = await netease.accountInfo(neteaseCookie);
        console.log('[fetchNeteaseUserInfo] result:', info);
        const patch = { neteaseUserInfo: info, loadingNeteaseInfo: false };
        if (info?.uid) patch.neteaseUid = info.uid;
        if (info?.nickname) patch.neteaseNickname = info.nickname;
        set(patch);
        // 同步到持久化（uid/nickname 可能在拉取后被更新）
        saveNeteasePersisted({ ...get() });
      } catch (e) {
        console.error('[fetchNeteaseUserInfo] failed:', e);
        set({ loadingNeteaseInfo: false });
      }
    },

    // 网易云登出：清空登录态 + 清除原生 Cookie
    neteaseLogout: () => {
      const next = {
        neteaseLoggedIn: false,
        neteaseCookie: '',
        neteaseUid: '',
        neteaseNickname: '网易云用户',
        neteaseUserInfo: null,
        loadingNeteaseInfo: false,
      };
      set(next);
      saveNeteasePersisted(next);
      try {
        CookieReader.clearCookiesForUrl('https://music.163.com').catch(() => {});
      } catch (e) {
        console.warn('[neteaseLogout] clearCookiesForUrl failed', e);
      }
    },
  };
});
