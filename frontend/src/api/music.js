const BASE = import.meta.env.VITE_API_BASE || '';

async function get(path, timeout = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`${BASE}${path}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    // 后端统一返回 { code: 200, data: ... }，失败时 { error }
    if (json && typeof json === 'object' && 'data' in json) return json.data;
    if (json && json.error) throw new Error(json.error);
    return json;
  } finally {
    clearTimeout(timer);
  }
}

export const music = {
  // 搜索：仅 QQ 音乐
  search: (keyword, limit = 30) =>
    get(`/api/music/search?keyword=${encodeURIComponent(keyword)}&limit=${limit}`),

  // 播放链接（带登录态可解锁 VIP）
  url: (id, cookie = '', uin = '0') =>
    get(`/api/music/url?id=${encodeURIComponent(id)}&cookie=${encodeURIComponent(cookie)}&uin=${encodeURIComponent(uin)}`),

  // 音频流代理 URL（直接作为 audio.src）
  stream: (id, cookie = '', uin = '0') =>
    `${BASE}/api/music/stream?id=${encodeURIComponent(id)}&cookie=${encodeURIComponent(cookie)}&uin=${encodeURIComponent(uin)}`,

  // 封面代理
  cover: (url) =>
    `${BASE}/api/music/cover?url=${encodeURIComponent(url)}`,

  // 歌词
  lyric: (id) =>
    get(`/api/music/lyric?id=${encodeURIComponent(id)}`),

  // ===== 登录 =====
  loginQrCode: () =>
    get(`/api/music/login/qq/qrcode`),
  loginCheck: (qrsig) =>
    get(`/api/music/login/qq/check?qrsig=${encodeURIComponent(qrsig)}`),

  // ===== 用户 =====
  userInfo: (cookie, uin) =>
    get(`/api/music/user/qq/info?cookie=${encodeURIComponent(cookie)}&uin=${encodeURIComponent(uin)}`),
  userPlaylists: (cookie, uin) =>
    get(`/api/music/user/qq/playlists?cookie=${encodeURIComponent(cookie)}&uin=${encodeURIComponent(uin)}`),

  // 歌单详情
  playlist: (id, cookie = '') =>
    get(`/api/music/playlist?id=${encodeURIComponent(id)}&cookie=${encodeURIComponent(cookie)}`),
};
