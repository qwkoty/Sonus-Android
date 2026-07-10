// 网易云音乐音源适配器（真实实现）
// 网易云无原生 App 通道，全部经后端 /api/music（weapi 加密 + 扫码登录）代理。
// 接口形状与 qqSource 对齐，使 Player / usePlayerStore 调用方零改动。

import { apiUrl } from '../api/base';

async function getJSON(path, params = {}) {
  const url = apiUrl(path);
  const u = new URL(url);
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null) u.searchParams.set(k, v); });
  const r = await fetch(u.toString(), { credentials: 'include' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export const neteaseSource = {
  id: 'netease',
  name: '网易云音乐',
  loginDomains: ['https://music.163.com'],
  ready: true,
  loginMethod: 'qr', // 扫码登录

  openLogin: async () => {}, // 扫码由 Login.jsx 驱动

  // —— 扫码登录（后端 weapi）——
  qrCreate: async () => {
    const j = await getJSON('/login/netease/qrcode');
    return { qrcode: j?.data?.qrcode, key: j?.data?.unikey, status: 'waiting' };
  },
  qrCheck: async (key) => {
    const j = await getJSON('/login/netease/poll', { key });
    const d = j?.data || {};
    if (d.status === 'confirmed') {
      return { status: 'confirmed', cookie: d.cookie, uid: d.uid, nickname: d.nickname };
    }
    return { status: d.status || 'waiting' };
  },

  // —— 凭证解析 ——
  parseCredentials: (cookie) => {
    const m = (cookie || '').match(/(?:^|;\s*)MUSIC_U=([^;]+)/);
    return { uid: '', key: m ? m[1] : '' };
  },
  validateLogin: async (creds) => {
    try {
      const i = await neteaseSource.userInfo(creds.cookie);
      return !!(i && i.nickname);
    } catch {
      return false;
    }
  },

  // —— 音源访问（经后端，platform=netease）——
  search: async (keyword, limit = 30) => {
    const j = await getJSON('/search', { platform: 'netease', keyword, limit });
    return j?.data || [];
  },
  // 返回后端 /stream 代理（携带 CORS + Range，供 Web Audio 可视化使用）
  url: async (id) => apiUrl(`/stream?platform=netease&id=${encodeURIComponent(id)}`),
  stream: async (id) => neteaseSource.url(id),
  cover: (url) => url, // 封面经 getProxyUrl 走 /cover 代理
  lyric: async (id) => {
    const j = await getJSON('/lyric', { platform: 'netease', id });
    return j?.data?.lyric || '';
  },
  loginByCookie: async (cookie) => {
    const i = await neteaseSource.userInfo(cookie);
    return {
      code: i?.uid ? 0 : 800,
      msg: i?.uid ? 'ok' : 'invalid',
      cookie,
      uid: i?.uid || '',
      key: '',
      nickname: i?.nickname || '网易云用户',
    };
  },
  userInfo: async (cookie) => {
    const j = await getJSON('/user/netease/info', { cookie });
    const raw = j?.data ?? {};
    // 兼容多种响应结构（与 qqSource.userInfoAPK 同理的多路径提取）
    const pick = (...keys) =>
      keys.map((k) => raw?.[k]).find((v) => v !== undefined && v !== null && v !== '');
    return {
      uid: raw?.uid || raw?.account?.id || raw?.userId || '',
      nickname: pick('nickname', 'name', 'userName', 'profileNickname') || '网易云用户',
      avatar: pick('avatar', 'profileImageUrl', 'headImgUrl', 'icon'),
    };
  },
  userPlaylists: async (cookie, uid) => {
    const j = await getJSON('/user/netease/playlists', { cookie, uid });
    return j?.data || [];
  },
  playlist: async (id) => {
    const j = await getJSON('/playlist', { platform: 'netease', id });
    return j?.data || { name: '歌单', tracks: [] };
  },
  // 封面走后端 /cover 代理（CORS 安全，供 canvas 采样可视化着色）
  getProxyUrl: (url) => (url ? apiUrl('/cover?url=' + encodeURIComponent(url)) : url),
};

export default neteaseSource;
