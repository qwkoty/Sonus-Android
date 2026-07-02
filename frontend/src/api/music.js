const BASE = import.meta.env.VITE_API_BASE || '';

async function get(path, timeout = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`${BASE}${path}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export const music = {
  search: (keyword, platforms = 'netease,qq', limit = 20) =>
    get(`/api/music/search?keyword=${encodeURIComponent(keyword)}&platforms=${platforms}&limit=${limit}`),
  url: (id, platform) =>
    get(`/api/music/url?id=${encodeURIComponent(id)}&platform=${encodeURIComponent(platform)}`),
  // 返回同源流代理 URL，解决 CDN CORS 限制；cookie 可选用于登录后解锁 VIP
  stream: (id, platform, cookie = '') =>
    `${BASE}/api/music/stream?id=${encodeURIComponent(id)}&platform=${encodeURIComponent(platform)}${cookie ? `&cookie=${encodeURIComponent(cookie)}` : ''}`,
  // 返回同源封面代理 URL，解决 CDN CORS 限制（供 canvas 采样）
  cover: (url) =>
    `${BASE}/api/music/cover?url=${encodeURIComponent(url)}`,
  lyric: (id, platform) =>
    get(`/api/music/lyric?id=${encodeURIComponent(id)}&platform=${encodeURIComponent(platform)}`),

  // ---- 扫码登录：网易云 ----
  neteaseUnikey: () => get('/api/music/login/netease/unikey'),
  neteaseQrcode: (unikey) => get(`/api/music/login/netease/qrcode?unikey=${encodeURIComponent(unikey)}`),
  neteaseCheck: (unikey) => get(`/api/music/login/netease/check?unikey=${encodeURIComponent(unikey)}`, 45000),
  neteasePlaylists: (cookie, uid) => get(`/api/music/user/netease/playlists?cookie=${encodeURIComponent(cookie)}&uid=${encodeURIComponent(uid)}`),
  neteaseLikedSongs: (cookie, uid) => get(`/api/music/user/netease/likedsongs?cookie=${encodeURIComponent(cookie)}&uid=${encodeURIComponent(uid)}`),

  // ---- 扫码登录：QQ 音乐 ----
  qqQrcode: () => get('/api/music/login/qq/qrcode'),
  qqCheck: (qrsig) => get(`/api/music/login/qq/check?qrsig=${encodeURIComponent(qrsig)}`, 45000),
  qqPlaylists: (uin, key) => get(`/api/music/user/qq/playlists?uin=${encodeURIComponent(uin)}&key=${encodeURIComponent(key)}`),
  qqLikedSongs: (uin, key) => get(`/api/music/user/qq/likedsongs?uin=${encodeURIComponent(uin)}&key=${encodeURIComponent(key)}`),

  // ---- 歌单详情（加载云歌单歌曲） ----
  playlist: (id, platform, cookie = '') => get(`/api/music/playlist?id=${encodeURIComponent(id)}&platform=${encodeURIComponent(platform)}${cookie ? `&cookie=${encodeURIComponent(cookie)}` : ''}`),
};
