// netease.js — 网易云音乐 API 层
// 直接请求网易云音乐官方接口，通过 CookieReader 自动注入 Cookie，无 CORS 限制
// 所有请求统一使用 cookieDomain='https://music.163.com'

import { CookieReader } from '../plugins/CookieReader';
import { getProxyUrl } from './music';

const NCM_BASE = 'https://music.163.com';

// 原生 HTTP GET：所有网易云音乐请求都走 music.163.com 域
async function ncmGet(path, cookie = '') {
  const url = path.startsWith('http') ? path : NCM_BASE + path;
  const r = cookie
    ? await CookieReader.httpGet(url, NCM_BASE, cookie)
    : await CookieReader.httpGet(url, NCM_BASE);
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
  return JSON.parse(r.body);
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
  const d = await ncmGet(`/api/login/qrcode/client/login?key=${encodeURIComponent(key)}&type=1`);
  const code = Number(d?.code);
  const result = { code, message: d?.message || d?.msg || '' };
  if (code === 803) {
    // 登录成功：原生层会捕获 Set-Cookie，从 CookieManager 读取完整 cookie
    try {
      const r = await CookieReader.getCookiesForUrl(NCM_BASE);
      const cookie = r?.cookie || '';
      const musicU = extractMusicU(cookie);
      if (cookie && musicU) {
        result.cookie = cookie;
      } else {
        // 即便没解析出 MUSIC_U 也把 cookie 带回去，由上层决定是否继续
        result.cookie = cookie;
      }
    } catch (e) {
      console.warn('[ncm.qrCheck] 读取 cookie 失败', e);
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
async function songUrl(id, cookie) {
  const rawId = String(id).replace(/^ncm_/, '');
  const d = await ncmGet(`/api/song/enhance/player/url?id=${encodeURIComponent(rawId)}&br=320000`, cookie);
  if (Number(d?.code) !== 200) {
    throw new Error(`songUrl 失败: code=${d?.code}`);
  }
  const data = d?.data || [];
  const item = data.find((it) => it && it.url) || data[0];
  const rawUrl = item?.url || '';
  if (!rawUrl) return '';
  // 网易云 CDN 直链同样需要本地代理转发，绕过 WebView Audio 跨域 403
  return await getProxyUrl(rawUrl);
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
