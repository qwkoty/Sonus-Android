// netease.js — 网易云音乐 API 层
// 直接请求网易云音乐官方接口，通过 CookieReader 自动注入 Cookie，无 CORS 限制
// 所有请求统一使用 cookieDomain='https://music.163.com'

import { CookieReader } from '../plugins/CookieReader';
import { getProxyUrl } from './music';

const NCM_BASE = 'https://music.163.com';

// 原生 HTTP GET：所有网易云音乐请求都走 music.163.com 域
// 传入的 cookie 会与 CookieManager 中的 cookie 合并，避免缺失 __csrf 等字段
async function ncmGet(path, cookie = '') {
  const url = path.startsWith('http') ? path : NCM_BASE + path;
  let cookies = cookie || '';
  try {
    const cm = await CookieReader.getCookiesForUrl(NCM_BASE);
    const cmCookie = cm?.cookie || '';
    if (cmCookie) {
      // 合并：传入的 cookie 优先，CookieManager 补充缺失的字段
      cookies = mergeCookies(cmCookie, cookies);
    }
  } catch (e) {}
  const r = cookies
    ? await CookieReader.httpGet(url, NCM_BASE, cookies)
    : await CookieReader.httpGet(url, NCM_BASE);
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
  return JSON.parse(r.body);
}

// 合并两段 cookie 字符串， latter 中的同名键覆盖前者
function mergeCookies(base, override) {
  if (!base && !override) return '';
  if (!base) return override;
  if (!override) return base;
  const map = new Map();
  for (const pair of base.split(';')) {
    const idx = pair.indexOf('=');
    if (idx > 0) map.set(pair.slice(0, idx).trim(), pair.trim());
  }
  for (const pair of override.split(';')) {
    const idx = pair.indexOf('=');
    if (idx > 0) map.set(pair.slice(0, idx).trim(), pair.trim());
  }
  return Array.from(map.values()).join('; ');
}

// 从 Cookie 字符串中提取 MUSIC_U（网易云登录态主票据）
function extractMusicU(cookie) {
  if (!cookie) return '';
  const m = cookie.match(/(?:^|;\s*)MUSIC_U=([^;]+)/);
  return m ? m[1] : '';
}

// ==================== 二维码登录 ====================
// 获取二维码 unikey
async function qrKey() {
  const d = await ncmGet('/api/login/qrcode/unikey?type=1');
  if (Number(d?.code) !== 200 || !d?.unikey) {
    throw new Error(`qrKey 失败: code=${d?.code}`);
  }
  return d.unikey;
}

// 检查二维码扫描状态
// 返回：{code, message?, cookie?}
//   800 = 二维码过期
//   801 = 等待扫码
//   802 = 已扫描等待确认
//   803 = 登录成功（携带 cookie）
async function qrCheck(key) {
  // 直接调原生 httpGet，拿响应体 + setCookies（Set-Cookie 拼接字符串）
  const url = `${NCM_BASE}/api/login/qrcode/client/login?key=${encodeURIComponent(key)}&type=1`;
  const r = await CookieReader.httpGet(url, NCM_BASE);
  if (!r.ok || !r.body) return { code: 0, message: 'HTTP ' + r.status };
  const d = JSON.parse(r.body);
  const code = Number(d?.code);
  const result = { code, message: d?.message || d?.msg || '' };
  if (code === 803) {
    // 登录成功：优先用原生层返回的 setCookies（Set-Cookie 拼接字符串）
    let cookie = r.setCookies || '';
    // fallback：如果 setCookies 为空，尝试从 CookieManager 读取
    if (!cookie) {
      try {
        const cr = await CookieReader.getCookiesForUrl(NCM_BASE);
        cookie = cr?.cookie || '';
      } catch (e) {
        console.warn('[ncm.qrCheck] getCookiesForUrl 失败', e);
      }
    }
    // 再 fallback：从响应体里找 cookie 字段（网易云某些接口会在 body 里返回）
    if (!cookie && d?.cookie) {
      cookie = typeof d.cookie === 'string' ? d.cookie : '';
    }
    result.cookie = cookie;
    if (!cookie) {
      console.warn('[ncm.qrCheck] 803 但 cookie 为空，setCookies=', r.setCookies);
    }
  }
  return result;
}

// ==================== 用户信息 ====================
// 返回 {uid, nickname, avatar}
async function accountInfo(cookie) {
  const d = await ncmGet('/api/nuser/account/get', cookie);
  if (Number(d?.code) !== 200) {
    throw new Error(`accountInfo 失败: code=${d?.code}`);
  }
  const acc = d?.account || {};
  const prof = d?.profile || acc?.profile || {};
  return {
    uid: String(acc.id || prof.userId || ''),
    nickname: prof.nickname || acc?.userName || '网易云用户',
    avatar: prof.avatarUrl || acc?.avatarUrl || '',
  };
}

// ==================== 用户歌单 ====================
// 返回 [{id, name, cover, songCount, platform:'ncm'}]
async function userPlaylists(uid, cookie) {
  const d = await ncmGet(`/api/user/playlist?uid=${encodeURIComponent(uid)}&limit=100`, cookie);
  if (Number(d?.code) !== 200) {
    throw new Error(`userPlaylists 失败: code=${d?.code}`);
  }
  const list = d?.playlist || [];
  return list.filter(Boolean).map((p) => ({
    id: p.id || p.dissid || '',
    name: p.name || '歌单',
    cover: p.coverImgUrl || p.picUrl || '',
    songCount: p.trackCount || 0,
    platform: 'ncm',
  }));
}

// ==================== 歌单详情 ====================
// 返回 {name, cover, tracks: [{id:'ncm_'+id, rawId:id, platform:'ncm', title, artist, album, cover, duration}]}
async function playlist(id, cookie) {
  const d = await ncmGet(`/api/v6/playlist/detail?id=${encodeURIComponent(id)}&n=1000`, cookie);
  if (Number(d?.code) !== 200) {
    throw new Error(`playlist 失败: code=${d?.code}`);
  }
  const pl = d?.playlist || {};
  const tracks = pl.tracks || [];
  return {
    name: pl.name || '歌单',
    cover: pl.coverImgUrl || pl.picUrl || '',
    tracks: tracks.filter(Boolean).map((s) => {
      const ar = s.ar || s.artists || [];
      const al = s.al || s.album || {};
      return {
        id: `ncm_${s.id}`,
        rawId: String(s.id || ''),
        platform: 'ncm',
        title: s.name || '未知歌曲',
        artist: (ar).map((a) => a.name).join(' / ') || '未知歌手',
        album: al.name || '',
        cover: al.picUrl || pl.coverImgUrl || '',
        duration: Math.floor((s.dt || s.duration || 0) / 1000),
      };
    }),
  };
}

// ==================== 播放链接 ====================
// 返回本地代理包装后的 URL；空 URL 返回 ''
// 主策略：免登录 outer URL（302 跳转到真实 CDN，最稳定，不需要 POST/加密）
// 备选：登录态 /api/song/enhance/player/url（GET 方式，部分歌曲可用）
async function songUrl(id, cookie) {
  const rawId = String(id).replace(/^ncm_/, '');

  // 主策略：outer URL，302 跳转到真实 CDN
  // 用 noRedirect=true 避免下载整个 mp3 二进制流
  try {
    const outerUrl = `${NCM_BASE}/song/media/outer/url?id=${rawId}`;
    const r = await CookieReader.httpGet(outerUrl, NCM_BASE, '', true);
    const location = r?.location || '';
    console.log('[ncm.songUrl] outer status:', r?.status, 'location:', location);
    if (location && (location.includes('126.net') || /\.(mp3|m4a|flac|aac|ogg|wav)(\?|$)/i.test(location))) {
      return await getProxyUrl(location);
    }
    // 某些版本不返回 Location，尝试 finalUrl
    const finalUrl = r?.finalUrl || '';
    if (finalUrl && finalUrl !== outerUrl && (finalUrl.includes('126.net') || /\.(mp3|m4a|flac|aac|ogg|wav)(\?|$)/i.test(finalUrl))) {
      return await getProxyUrl(finalUrl);
    }
    console.warn('[ncm.songUrl] outer invalid, location:', location, 'finalUrl:', finalUrl);
  } catch (e) {
    console.warn('[ncm.songUrl] outer failed', e);
  }

  // 备选：登录态接口（GET 方式，部分歌曲可用）
  if (cookie) {
    for (const br of [128000, 320000]) {
      try {
        const d = await ncmGet(`/api/song/enhance/player/url?id=${encodeURIComponent(rawId)}&br=${br}`, cookie);
        if (Number(d?.code) !== 200) continue;
        const data = d?.data || [];
        const item = data.find((it) => it && it.url) || data[0];
        const rawUrl = item?.url || '';
        if (rawUrl) return await getProxyUrl(rawUrl);
      } catch (e) {}
    }
  }

  return '';
}

// ==================== 歌词 ====================
// 返回歌词文本（LRC 格式）
async function lyric(id, cookie) {
  const rawId = String(id).replace(/^ncm_/, '');
  const d = await ncmGet(`/api/song/lyric?id=${encodeURIComponent(rawId)}&lv=1&kv=1&tv=-1`, cookie);
  if (Number(d?.code) !== 200) {
    return '';
  }
  return d?.lrc?.lyric || '';
}

// ==================== 搜索 ====================
// 返回 [{id:'ncm_'+id, rawId:id, platform:'ncm', title, artist, album, cover, duration}]
async function search(keyword, limit = 30) {
  const d = await ncmGet(`/api/search/get?s=${encodeURIComponent(keyword)}&type=1&limit=${limit}`);
  if (Number(d?.code) !== 200) {
    return [];
  }
  const songs = d?.result?.songs || [];
  return songs.filter(Boolean).map((s) => {
    const ar = s.artists || s.ar || [];
    const al = s.album || s.al || {};
    return {
      id: `ncm_${s.id}`,
      rawId: String(s.id || ''),
      platform: 'ncm',
      title: s.name || '未知歌曲',
      artist: ar.map((a) => a.name).join(' / ') || '未知歌手',
      album: al.name || '',
      cover: al.picUrl || '',
      duration: Math.floor((s.duration || 0) / 1000),
    };
  });
}

export const netease = {
  qrKey,
  qrCheck,
  accountInfo,
  userPlaylists,
  playlist,
  songUrl,
  lyric,
  search,
};

export default netease;
