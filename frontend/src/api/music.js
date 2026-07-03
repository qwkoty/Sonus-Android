// music.js — APK 模式直连 QQ 音乐 API / 浏览器走后端代理
import { CapacitorHttp } from '@capacitor/core';
import { isAndroid } from '../utils/platform';

const BASE = import.meta.env.VITE_API_BASE || '';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Referer: 'https://y.qq.com/' };

// ===== 后端代理请求（浏览器模式） =====
async function proxyGet(path, timeout = 30000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(`${BASE}${path}`, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    if (j && 'data' in j) return j.data;
    if (j && j.error) throw new Error(j.error);
    return j;
  } finally { clearTimeout(t); }
}
async function proxyPost(path, body, timeout = 30000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    if (j && 'data' in j) return j.data;
    if (j && j.error) throw new Error(j.error);
    return j;
  } finally { clearTimeout(t); }
}

// ===== CapacitorHttp 直连 QQ 音乐（APK 模式） =====
async function qqApi(payload) {
  const r = await CapacitorHttp.request({
    method: 'GET',
    url: 'https://u.y.qq.com/cgi-bin/musicu.fcg',
    headers: HEADERS,
    params: { data: JSON.stringify(payload) },
    responseType: 'json',
    connectTimeout: 12000,
    readTimeout: 12000,
  });
  return r.data;
}

async function qqApiWithCookie(payload, cookie) {
  const hdr = { ...HEADERS };
  if (cookie) hdr['Cookie'] = cookie;
  const r = await CapacitorHttp.request({
    method: 'GET',
    url: 'https://u.y.qq.com/cgi-bin/musicu.fcg',
    headers: hdr,
    params: { data: JSON.stringify(payload) },
    responseType: 'json',
    connectTimeout: 12000,
    readTimeout: 12000,
  });
  return r.data;
}

// ===== 搜索（APK 直连） =====
async function searchDirect(keyword, limit = 30) {
  const data = await qqApi({
    req_0: { module: 'music.search.SearchCgiService', method: 'DoSearchForQQMusicDesktop', param: { num_per_page: limit, page_num: 1, query: keyword, search_type: 0 } },
    comm: { g_tk: 5381, uin: '0', format: 'json', ct: 24, cv: 0, platform: 'h5' },
  });
  return (data?.req_0?.data?.body?.song?.list || []).map(s => ({
    id: `qq_${s.mid}`, rawId: s.mid, platform: 'qq',
    title: s.name || s.title || '',
    artist: (s.singer || []).map(a => a.name).join(' / '),
    album: s.album?.name || '',
    cover: s.album?.mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${s.album.mid}.jpg` : '',
    duration: s.interval || 0,
  }));
}

// ===== 搜索（浏览器代理） =====
async function searchProxy(keyword, limit = 30) {
  return proxyGet(`/api/music/search?keyword=${encodeURIComponent(keyword)}&limit=${limit}`);
}

// ===== 播放链接（APK 直连） =====
async function urlDirect(id, cookie = '', uin = '0') {
  const rawId = String(id).replace(/^qq_/, '');
  const loginflag = cookie ? 1 : 0;
  const data = await qqApiWithCookie({
    req_0: { module: 'music.vkey.GetVkeyServer', method: 'CgiGetVkey', param: { guid: '10000', songmid: rawId, songtype: 0, uin: String(uin), loginflag, platform: '23', h5to: 'speed' } },
    comm: { uin: String(uin), format: 'json', ct: 24, cv: 0 },
  }, cookie);
  const item = data?.req_0?.data?.midurlinfo?.[0];
  const sip = data?.req_0?.data?.sip?.[0];
  return (item?.purl && sip) ? sip + item.purl : '';
}

// ===== 播放链接（浏览器代理） =====
async function urlProxy(id, cookie = '', uin = '0') {
  return proxyGet(`/api/music/url?id=${encodeURIComponent(id)}&cookie=${encodeURIComponent(cookie)}&uin=${encodeURIComponent(uin)}`);
}

// ===== 歌词（APK 直连） =====
async function lyricDirect(id) {
  const rawId = String(id).replace(/^qq_/, '');
  const data = await qqApi({ req_0: { module: 'music.musichallSong.PlayLyricInfo', method: 'GetPlayLyricInfo', param: { songMID: rawId } }, comm: { uin: '0', format: 'json', ct: 24, cv: 0 } });
  const b64 = data?.req_0?.data?.lyric;
  if (!b64) return '';
  try { return Buffer.from(b64, 'base64').toString('utf-8'); } catch { const s = atob(b64); const ua = new Uint8Array(s.length); for (let i=0;i<s.length;i++) ua[i]=s.charCodeAt(i); return new TextDecoder().decode(ua); }
}

// ===== 歌词（浏览器代理） =====
async function lyricProxy(id) {
  const r = await proxyGet(`/api/music/lyric?id=${encodeURIComponent(id)}`);
  return r?.lyric || '';
}

// ===== 用户信息 =====
async function userInfoDirect(cookie, uin) {
  const data = await qqApiWithCookie({ comm: { uin: String(uin), format: 'json', ct: 24, cv: 0 }, req_0: { module: 'music.UserInfo.userInfoServer', method: 'GetLoginUserInfo', param: {} } }, cookie);
  const info = data?.req_0?.data;
  return { nickname: info?.nick || 'QQ音乐用户', avatar: info?.headpic || '', uin: String(uin), vipLevel: info?.vipLevel || 0, follow: info?.follow || 0, fans: info?.fans || 0 };
}

// ===== 用户歌单 =====
async function userPlaylistsDirect(cookie, uin) {
  const data = await qqApiWithCookie({ comm: { uin: String(uin), format: 'json', ct: 24, cv: 0 }, req_0: { module: 'music.musicasset.PlaylistBaseRead', method: 'GetPlaylistByUin', param: { uin: String(uin), num: 100, order: 0 } } }, cookie);
  return (data?.req_0?.data?.v_playlist || []).map(p => ({ id: p.tid || p.dirId || '', name: p.diss_name || p.dirName || '歌单', cover: p.diss_cover || p.picurl || '', songCount: p.song_nums || p.songNum || 0 }));
}

// ===== 歌单详情 =====
async function playlistDirect(id, cookie = '') {
  const data = await qqApiWithCookie({ comm: { uin: '0', format: 'json', ct: 24, cv: 0 }, req_0: { module: 'music.srfDissInfo.aiDissInfo', method: 'uniform_get_Dissinfo', param: { disstid: Number(id), song_num: 1000, song_begin: 0, info: 1 } } }, cookie);
  const dirinfo = data?.req_0?.data?.dirinfo, songlist = data?.req_0?.data?.songlist || [];
  return { name: dirinfo?.title || '歌单', cover: dirinfo?.picurl || '', tracks: songlist.map(s => ({ id: `qq_${s.mid}`, rawId: s.mid, platform: 'qq', title: s.name || '', artist: (s.singer || []).map(a => a.name).join(' / '), album: s.album?.name || '', cover: s.album?.mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${s.album.mid}.jpg` : '', duration: s.interval || 0 })) };
}

// ===== Cookie 登录 =====
async function loginByCookieDirect(cookie) {
  const m = cookie.match(/(?:^|;\s*)(?:uin|wxuin)=o?(\d+)/);
  if (!m) return { code: 800, msg: '未找到 uin' };
  const uin = m[1], key = (cookie.match(/(?:^|;\s*)(qqmusic_key|qm_keyst|p_skey|skey)=([^;]+)/) || [])[2] || '';
  try { const info = await userInfoDirect(cookie, uin); return { code: 0, msg: 'ok', cookie, uin, key, nickname: info.nickname || 'QQ音乐用户' }; }
  catch { return { code: 800, msg: 'cookie 验证失败' }; }
}

// ===== 统一导出 =====
const DIR = isAndroid();

export const music = {
  search: DIR ? searchDirect : searchProxy,
  url: DIR ? urlDirect : urlProxy,
  // stream 返回直链 URL 字符串（用于 audio.src）
  stream: (id, cookie = '', uin = '0') => DIR ? urlDirect(id, cookie, uin) : `${BASE}/api/music/stream?id=${encodeURIComponent(id)}&cookie=${encodeURIComponent(cookie)}&uin=${encodeURIComponent(uin)}`,
  cover: (url) => url,
  lyric: DIR ? lyricDirect : lyricProxy,
  loginQrCode: () => proxyGet('/api/music/login/qq/qrcode'),
  loginByRedirect: (u, q) => proxyPost('/api/music/login/qq/redirect', { redirectUrl: u, qrsig: q }),
  loginByCookie: DIR ? loginByCookieDirect : (c) => proxyPost('/api/music/login/qq/cookie', { cookie: c }),
  userInfo: DIR ? userInfoDirect : (c, u) => proxyGet(`/api/music/user/qq/info?cookie=${encodeURIComponent(c)}&uin=${encodeURIComponent(u)}`),
  userPlaylists: DIR ? userPlaylistsDirect : (c, u) => proxyGet(`/api/music/user/qq/playlists?cookie=${encodeURIComponent(c)}&uin=${encodeURIComponent(u)}`),
  playlist: DIR ? playlistDirect : (id, c = '') => proxyGet(`/api/music/playlist?id=${encodeURIComponent(id)}&cookie=${encodeURIComponent(c)}`),
};
