// music.js — 双模式 API 层
// - Capacitor Android: 直连 QQ 音乐 API（CapacitorHttp 绕过 CORS）
// - 浏览器: 走后端代理 /api/music/*

import { CapacitorHttp } from '@capacitor/core';
import { isCapacitor } from '../utils/platform';

const BASE = import.meta.env.VITE_API_BASE || '';
const USE_DIRECT = isCapacitor(); // APK 模式直连 QQ 音乐 API

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Referer: 'https://y.qq.com/' };

// ===== 后端代理请求（浏览器模式） =====
async function get(path, timeout = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`${BASE}${path}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json && typeof json === 'object' && 'data' in json) return json.data;
    if (json && json.error) throw new Error(json.error);
    return json;
  } finally {
    clearTimeout(timer);
  }
}

async function post(path, body, timeout = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json && typeof json === 'object' && 'data' in json) return json.data;
    if (json && json.error) throw new Error(json.error);
    return json;
  } finally {
    clearTimeout(timer);
  }
}

// ===== CapacitorHttp 直连 QQ 音乐 API（APK 模式） =====
async function qqMusicRequest(payload, cookie = '', uin = '0') {
  const headers = { ...HEADERS };
  if (cookie) headers['Cookie'] = cookie;

  const params = { data: JSON.stringify(payload) };
  const response = await CapacitorHttp.request({
    method: 'GET',
    url: 'https://u.y.qq.com/cgi-bin/musicu.fcg',
    headers,
    params,
    responseType: 'json',
    connectTimeout: 15000,
    readTimeout: 15000,
  });
  return response.data;
}

// 搜索
async function searchDirect(keyword, limit = 30) {
  const payload = {
    req_0: {
      module: 'music.search.SearchCgiService',
      method: 'DoSearchForQQMusicDesktop',
      param: { num_per_page: limit, page_num: 1, query: keyword, search_type: 0 },
    },
    comm: { g_tk: 5381, uin: '0', format: 'json', ct: 24, cv: 0, platform: 'h5' },
  };
  const data = await qqMusicRequest(payload);
  const list = data?.req_0?.data?.body?.song?.list || [];
  return list.map((s) => ({
    id: `qq_${s.mid}`,
    rawId: s.mid,
    platform: 'qq',
    title: s.name || s.title || '',
    artist: (s.singer || []).map((a) => a.name).join(' / '),
    album: s.album?.name || '',
    cover: s.album?.mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${s.album.mid}.jpg` : '',
    duration: s.interval || 0,
  }));
}

// 播放链接
async function urlDirect(id, cookie = '', uin = '0') {
  const rawId = String(id).replace(/^qq_/, '');
  const loginflag = cookie ? 1 : 0;
  const payload = {
    req_0: {
      module: 'music.vkey.GetVkeyServer',
      method: 'CgiGetVkey',
      param: { guid: '10000', songmid: rawId, songtype: 0, uin: String(uin), loginflag, platform: '23', h5to: 'speed' },
    },
    comm: { uin: String(uin), format: 'json', ct: 24, cv: 0 },
  };
  const headers = { ...HEADERS };
  if (cookie) headers['Cookie'] = cookie;
  const data = await qqMusicRequest(payload, cookie, uin);
  const item = data?.req_0?.data?.midurlinfo?.[0];
  const sip = data?.req_0?.data?.sip?.[0];
  if (item?.purl && sip) return sip + item.purl;
  return '';
}

// 歌词
async function lyricDirect(id) {
  const rawId = String(id).replace(/^qq_/, '');
  const payload = {
    req_0: { module: 'music.musichallSong.PlayLyricInfo', method: 'GetPlayLyricInfo', param: { songMID: rawId } },
    comm: { uin: '0', format: 'json', ct: 24, cv: 0 },
  };
  const data = await qqMusicRequest(payload);
  const b64 = data?.req_0?.data?.lyric;
  if (!b64) return '';
  // base64 decode
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

// 用户信息
async function userInfoDirect(cookie, uin) {
  const payload = {
    comm: { uin: String(uin), format: 'json', ct: 24, cv: 0 },
    req_0: { module: 'music.UserInfo.userInfoServer', method: 'GetLoginUserInfo', param: {} },
  };
  const data = await qqMusicRequest(payload, cookie, uin);
  const info = data?.req_0?.data;
  return {
    nickname: info?.nick || info?.nickname || 'QQ音乐用户',
    avatar: info?.headpic || info?.avatar || '',
    uin: String(uin),
    vipLevel: info?.vipLevel || 0,
    follow: info?.follow || 0,
    fans: info?.fans || 0,
  };
}

// 用户歌单
async function userPlaylistsDirect(cookie, uin) {
  const payload = {
    comm: { uin: String(uin), format: 'json', ct: 24, cv: 0 },
    req_0: {
      module: 'music.musicasset.PlaylistBaseRead',
      method: 'GetPlaylistByUin',
      param: { uin: String(uin), num: 100, order: 0 },
    },
  };
  const data = await qqMusicRequest(payload, cookie, uin);
  const list = data?.req_0?.data?.v_playlist || [];
  return list.map((p) => ({
    id: p.tid || p.dirId || '',
    name: p.diss_name || p.dirName || '歌单',
    cover: p.diss_cover || p.picurl || '',
    songCount: p.song_nums || p.songNum || 0,
  }));
}

// 歌单详情
async function playlistDirect(id, cookie = '') {
  const payload = {
    comm: { uin: '0', format: 'json', ct: 24, cv: 0 },
    req_0: {
      module: 'music.srfDissInfo.aiDissInfo',
      method: 'uniform_get_Dissinfo',
      param: { disstid: Number(id), song_num: 1000, song_begin: 0, info: 1 },
    },
  };
  const data = await qqMusicRequest(payload, cookie);
  const dirinfo = data?.req_0?.data?.dirinfo;
  const songlist = data?.req_0?.data?.songlist || [];
  return {
    name: dirinfo?.title || '歌单',
    cover: dirinfo?.picurl || '',
    tracks: songlist.map((s) => ({
      id: `qq_${s.mid}`,
      rawId: s.mid,
      platform: 'qq',
      title: s.name || s.title || '',
      artist: (s.singer || []).map((a) => a.name).join(' / '),
      album: s.album?.name || '',
      cover: s.album?.mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${s.album.mid}.jpg` : '',
      duration: s.interval || 0,
    })),
  };
}

// Cookie 登录验证（APK 模式）
async function loginByCookieDirect(cookie) {
  // 从 cookie 中提取 uin
  const m = cookie.match(/(?:^|;\s*)(?:uin|wxuin)=o?(\d+)/);
  if (!m) return { code: 800, msg: 'Cookie 中未找到 uin' };
  const uin = m[1];
  const key = (cookie.match(/(?:^|;\s*)(qqmusic_key|qm_keyst|p_skey|skey)=([^;]+)/) || [])[2] || '';
  try {
    const info = await userInfoDirect(cookie, uin);
    return {
      code: 0,
      msg: '登录成功',
      cookie,
      uin,
      key,
      nickname: info.nickname || 'QQ音乐用户',
    };
  } catch (e) {
    return { code: 800, msg: 'Cookie 验证失败' };
  }
}

// ===== 统一导出：根据环境自动选择直连 or 后端代理 =====
export const music = {
  search: (keyword, limit = 30) =>
    USE_DIRECT ? searchDirect(keyword, limit) : get(`/api/music/search?keyword=${encodeURIComponent(keyword)}&limit=${limit}`),

  url: (id, cookie = '', uin = '0') =>
    USE_DIRECT ? urlDirect(id, cookie, uin) : get(`/api/music/url?id=${encodeURIComponent(id)}&cookie=${encodeURIComponent(cookie)}&uin=${encodeURIComponent(uin)}`),

  // 音频流：APK 模式返回直链 URL，浏览器模式返回后端代理 URL
  stream: (id, cookie = '', uin = '0') => {
    if (USE_DIRECT) {
      // APK 模式需要异步获取直链，这里返回 Promise
      return urlDirect(id, cookie, uin);
    }
    return `${BASE}/api/music/stream?id=${encodeURIComponent(id)}&cookie=${encodeURIComponent(cookie)}&uin=${encodeURIComponent(uin)}`;
  },

  // 下载音频为 Blob URL（APK 模式，绕过 CORS）
  streamBlob: async (id, cookie = '', uin = '0') => {
    if (!USE_DIRECT) return null;
    const directUrl = await urlDirect(id, cookie, uin);
    if (!directUrl) return '';
    try {
      const response = await CapacitorHttp.request({
        method: 'GET',
        url: directUrl,
        headers: { ...HEADERS, Range: 'bytes=0-' },
        responseType: 'arraybuffer',
        connectTimeout: 30000,
        readTimeout: 30000,
      });
      // CapacitorHttp arraybuffer 返回 base64
      if (response.data) {
        const binary = atob(response.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'audio/mpeg' });
        return URL.createObjectURL(blob);
      }
      return '';
    } catch (e) {
      // Blob 下载失败，回退到直链
      return directUrl;
    }
  },

  cover: (url) => url, // APK 模式直接用原 URL（Capacitor 不受 CORS 限制）

  lyric: (id) =>
    USE_DIRECT ? lyricDirect(id) : get(`/api/music/lyric?id=${encodeURIComponent(id)}`),

  // ===== 登录 =====
  loginQrCode: () =>
    get(`/api/music/login/qq/qrcode`),
  loginByRedirect: (redirectUrl, qrsig) =>
    post(`/api/music/login/qq/redirect`, { redirectUrl, qrsig }),
  loginByCookie: (cookie) =>
    USE_DIRECT ? loginByCookieDirect(cookie) : post(`/api/music/login/qq/cookie`, { cookie }),

  // ===== 用户 =====
  userInfo: (cookie, uin) =>
    USE_DIRECT ? userInfoDirect(cookie, uin) : get(`/api/music/user/qq/info?cookie=${encodeURIComponent(cookie)}&uin=${encodeURIComponent(uin)}`),
  userPlaylists: (cookie, uin) =>
    USE_DIRECT ? userPlaylistsDirect(cookie, uin) : get(`/api/music/user/qq/playlists?cookie=${encodeURIComponent(cookie)}&uin=${encodeURIComponent(uin)}`),

  // 歌单详情
  playlist: (id, cookie = '') =>
    USE_DIRECT ? playlistDirect(id, cookie) : get(`/api/music/playlist?id=${encodeURIComponent(id)}&cookie=${encodeURIComponent(cookie)}`),
};
