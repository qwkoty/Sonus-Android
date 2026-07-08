import { create } from 'zustand';
import { music } from '../api/music';
import { getActiveSource, setActiveSource as setRegistryActiveSource, getSource } from '../sources/registry';

const STORAGE_KEY = 'sonus_auth';
const VERSION = 2;

// 各音源默认空凭证槽位
function emptySourceCreds(id) {
  return { isLoggedIn: false, cookie: '', uin: '', key: '', nickname: '', userInfo: null };
}

function defaultNickname(id) {
  if (id === 'netease') return '网易云用户';
  if (id === 'kugou') return '酷狗用户';
  return 'QQ音乐用户';
}

// 从当前激活源派生顶层兼容字段（普通 state，避免 zustand set 合并破坏 getter）
function deriveActive(sources, activeSourceId) {
  const c = sources[activeSourceId] || emptySourceCreds(activeSourceId);
  return {
    cookie: c.cookie || '',
    uin: c.uin || '',
    key: c.key || '',
    nickname: c.nickname || 'Sonus',
    userInfo: c.userInfo || null,
    isLoggedIn: Object.values(sources).some((s) => s.isLoggedIn),
  };
}

// 旧结构（v1：单源 {cookie,uin,sourceId}）迁移到 v2（多源 sources map）
function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (obj && obj.version === VERSION && obj.sources) return obj;
    if (obj && obj.cookie && obj.uin) {
      const id = obj.sourceId || 'qq';
      return {
        version: VERSION,
        activeSourceId: id,
        sources: {
          [id]: {
            isLoggedIn: true,
            cookie: obj.cookie,
            uin: obj.uin,
            key: obj.key || '',
            nickname: obj.nickname || defaultNickname(id),
            userInfo: null,
          },
        },
      };
    }
  } catch {}
  return null;
}

function savePersisted(state) {
  try {
    const sources = {};
    let any = false;
    for (const [id, c] of Object.entries(state.sources)) {
      if (c.isLoggedIn && c.cookie) {
        sources[id] = { ...c, userInfo: c.userInfo || null };
        any = true;
      }
    }
    if (any) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: VERSION,
        activeSourceId: state.activeSourceId,
        sources,
      }));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {}
}

export const useAuthStore = create((set, get) => {
  const persisted = loadPersisted();
  const initialActive = persisted?.activeSourceId || getActiveSource().id;

  // 合并默认槽位与持久化槽位（保证 kugou 等骨架源始终有槽位）
  const sources = {
    qq: emptySourceCreds('qq'),
    netease: emptySourceCreds('netease'),
    kugou: emptySourceCreds('kugou'),
    ...(persisted?.sources || {}),
  };

  return {
    sources,
    activeSourceId: initialActive,
    loadingInfo: false,

    // —— 向后兼容顶层字段（始终等于 active 源的派生值）——
    ...deriveActive(sources, initialActive),

    // 取指定源凭证
    getSourceCreds: (id) => get().sources[id] || emptySourceCreds(id),
    // 取当前激活源凭证
    getActiveCreds: () => get().sources[get().activeSourceId] || emptySourceCreds(get().activeSourceId),

    // 向指定源写入凭证（多源并存）
    setAuth: (sourceId, { cookie, uin, key, nickname }) => {
      const next = {
        isLoggedIn: true,
        cookie: cookie || '',
        uin: String(uin || ''),
        key: key || '',
        nickname: nickname || defaultNickname(sourceId),
        userInfo: null,
      };
      const sources = { ...get().sources, [sourceId]: next };
      const activeSourceId = get().activeSourceId || sourceId;
      set({ sources, activeSourceId, loadingInfo: false, ...deriveActive(sources, activeSourceId) });
      savePersisted(get());
      get().fetchUserInfo(sourceId);
    },

    // 切换激活音源（同步音源注册表，供 music Proxy 使用）
    setActiveSource: (id) => {
      if (!get().sources[id]) return;
      try { setRegistryActiveSource(id); } catch {}
      const sources = get().sources;
      set({ activeSourceId: id, ...deriveActive(sources, id) });
      savePersisted(get());
    },

    // 刷新指定源（默认当前激活源）用户信息
    fetchUserInfo: async (sourceId) => {
      const id = sourceId || get().activeSourceId;
      const c = get().sources[id];
      if (!c || !c.isLoggedIn || !c.cookie || !c.uin) return;
      set({ loadingInfo: true });
      try {
        const info = await getSource(id).userInfo(c.cookie, c.uin);
        const sources = {
          ...get().sources,
          [id]: { ...get().sources[id], userInfo: info, nickname: info?.nickname || get().sources[id].nickname },
        };
        set({ sources, loadingInfo: false, ...deriveActive(sources, id) });
        savePersisted(get());
      } catch (e) {
        console.error('[fetchUserInfo] failed:', e);
        set({ loadingInfo: false });
      }
    },

    // 登出指定源（缺省全部登出）
    logout: (sourceId) => {
      const sources = { ...get().sources };
      if (sourceId) {
        sources[sourceId] = emptySourceCreds(sourceId);
      } else {
        for (const k of Object.keys(sources)) sources[k] = emptySourceCreds(k);
      }
      const activeSourceId = get().activeSourceId;
      set({ sources, ...deriveActive(sources, activeSourceId) });
      savePersisted(get());
    },
  };
});
