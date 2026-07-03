// music.js — APK 用原生 httpGet（自动带 Cookie），浏览器走后端代理
import { isAndroid } from '../utils/platform';
import { CookieReader } from '../plugins/CookieReader';

const BASE = import.meta.env.VITE_API_BASE || '';
const DIR = isAndroid();

// ===== 后端代理（浏览器） =====
async function pget(path, to = 30000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), to);
  try { const r = await fetch(`${BASE}${path}`, { signal: c.signal }); if (!r.ok) throw new Error(`HTTP ${r.status}`); const j = await r.json(); return j?.data || j; } finally { clearTimeout(t); }
}
async function ppost(path, b, to = 30000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), to);
  try { const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b), signal: c.signal }); if (!r.ok) throw new Error(`HTTP ${r.status}`); const j = await r.json(); return j?.data || j; } finally { clearTimeout(t); }
}

// ===== APK 原生请求：CookieReader.httpGet 自动从 CookieManager 带 Cookie =====
async function nativeGet(url) {
  const r = await CookieReader.httpGet(url);
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
  return JSON.parse(r.body);
}

// 拼装 musicu.fcg 请求
function qqUrl(payload) {
  return `https://u.y.qq.com/cgi-bin/musicu.fcg?data=${encodeURIComponent(JSON.stringify(payload))}`;
}

// ===== 搜索 =====
async function searchAPK(keyword, limit = 30) {
  const d = await nativeGet(qqUrl({ req_0: { module: 'music.search.SearchCgiService', method: 'DoSearchForQQMusicDesktop', param: { num_per_page: limit, page_num: 1, query: keyword, search_type: 0 } }, comm: { g_tk: 5381, uin: '0', format: 'json', ct: 24, cv: 0, platform: 'h5' } }));
  return (d?.req_0?.data?.body?.song?.list || []).map(s => ({ id: `qq_${s.mid}`, rawId: s.mid, platform: 'qq', title: s.name || '', artist: (s.singer || []).map(a => a.name).join(' / '), album: s.album?.name || '', cover: s.album?.mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${s.album.mid}.jpg` : '', duration: s.interval || 0 }));
}
async function searchWeb(k, l) { return pget(`/api/music/search?keyword=${encodeURIComponent(k)}&limit=${l}`); }

// ===== 播放链接 =====
async function urlAPK(id, cookie = '', uin = '0') {
  const rawId = String(id).replace(/^qq_/, '');
  const d = await nativeGet(qqUrl({ req_0: { module: 'music.vkey.GetVkeyServer', method: 'CgiGetVkey', param: { guid: '10000', songmid: rawId, songtype: 0, uin: String(uin), loginflag: cookie ? 1 : 0, platform: '23', h5to: 'speed' } }, comm: { uin: String(uin), format: 'json', ct: 24, cv: 0 } }));
  const item = d?.req_0?.data?.midurlinfo?.[0], sip = d?.req_0?.data?.sip?.[0];
  return (item?.purl && sip) ? sip + item.purl : '';
}
async function urlWeb(id, c = '', u = '0') { return pget(`/api/music/url?id=${encodeURIComponent(id)}&cookie=${encodeURIComponent(c)}&uin=${encodeURIComponent(u)}`); }

// ===== 歌词 =====
async function lyricAPK(id) {
  const rawId = String(id).replace(/^qq_/, '');
  const d = await nativeGet(qqUrl({ req_0: { module: 'music.musichallSong.PlayLyricInfo', method: 'GetPlayLyricInfo', param: { songMID: rawId } }, comm: { uin: '0', format: 'json', ct: 24, cv: 0 } }));
  const b64 = d?.req_0?.data?.lyric; if (!b64) return '';
  try { return Buffer.from(b64, 'base64').toString('utf-8'); } catch { const s = atob(b64); const ua = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) ua[i] = s.charCodeAt(i); return new TextDecoder().decode(ua); }
}
async function lyricWeb(id) { const r = await pget(`/api/music/lyric?id=${encodeURIComponent(id)}`); return r?.lyric || ''; }

// ===== 用户信息 =====
async function userInfoAPK(uin) {
  const d = await nativeGet(qqUrl({ comm: { uin: String(uin), format: 'json', ct: 24, cv: 0 }, req_0: { module: 'music.UserInfo.userInfoServer', method: 'GetLoginUserInfo', param: {} } }));
  const i = d?.req_0?.data;
  return { nickname: i?.nick || 'QQ音乐用户', avatar: i?.headpic || '', uin: String(uin), vipLevel: i?.vipLevel || 0, follow: i?.follow || 0, fans: i?.fans || 0 };
}

// ===== 歌单 =====
async function playlistsAPK(uin) {
  const d = await nativeGet(qqUrl({ comm: { uin: String(uin), format: 'json', ct: 24, cv: 0 }, req_0: { module: 'music.musicasset.PlaylistBaseRead', method: 'GetPlaylistByUin', param: { uin: String(uin), num: 100, order: 0 } } }));
  return (d?.req_0?.data?.v_playlist || []).map(p => ({ id: p.tid || p.dirId || '', name: p.diss_name || p.dirName || '歌单', cover: p.diss_cover || p.picurl || '', songCount: p.song_nums || p.songNum || 0 }));
}

// ===== Cookie 登录验证 =====
async function loginByCookieAPK(cookie) {
  const m = cookie.match(/(?:^|;\s*)(?:uin|wxuin)=o?(\d+)/);
  if (!m) return { code: 800, msg: '未找到 uin' };
  const uin = m[1], key = (cookie.match(/(?:^|;\s*)(qqmusic_key|qm_keyst|p_skey|skey)=([^;]+)/) || [])[2] || '';
  try { const i = await userInfoAPK(uin); return { code: 0, msg: 'ok', cookie, uin, key, nickname: i.nickname }; }
  catch { return { code: 800, msg: 'cookie 验证失败' }; }
}

export const music = {
  search: DIR ? searchAPK : searchWeb,
  url: DIR ? urlAPK : urlWeb,
  stream: (id, c = '', u = '0') => DIR ? urlAPK(id, c, u) : `${BASE}/api/music/stream?id=${encodeURIComponent(id)}&cookie=${encodeURIComponent(c)}&uin=${encodeURIComponent(u)}`,
  cover: url => url,
  lyric: DIR ? lyricAPK : lyricWeb,
  loginQrCode: () => pget('/api/music/login/qq/qrcode'),
  loginByRedirect: (u, q) => ppost('/api/music/login/qq/redirect', { redirectUrl: u, qrsig: q }),
  loginByCookie: DIR ? loginByCookieAPK : c => ppost('/api/music/login/qq/cookie', { cookie: c }),
  userInfo: (c, u) => DIR ? userInfoAPK(u) : pget(`/api/music/user/qq/info?cookie=${encodeURIComponent(c)}&uin=${encodeURIComponent(u)}`),
  userPlaylists: (c, u) => DIR ? playlistsAPK(u) : pget(`/api/music/user/qq/playlists?cookie=${encodeURIComponent(c)}&uin=${encodeURIComponent(u)}`),
  playlist: (id, c = '') => DIR ? pget(`/api/music/playlist?id=${encodeURIComponent(id)}&cookie=${encodeURIComponent(c)}`) : pget(`/api/music/playlist?id=${encodeURIComponent(id)}&cookie=${encodeURIComponent(c)}`),
};
