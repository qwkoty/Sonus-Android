// music.js — Sonus 原生 APK 模式专用 API 层
// 直接请求 QQ 音乐官方接口，通过 CookieReader 自动注入 Cookie，无 CORS 限制
// 参照 Mineradio 项目的 QQ 音乐接口实现

import { CookieReader } from '../plugins/CookieReader';

function qqUrl(payload) {
  return `https://u.y.qq.com/cgi-bin/musicu.fcg?data=${encodeURIComponent(JSON.stringify(payload))}`;
}

// 原生 HTTP GET：优先使用传入的 cookie 字符串，否则从 CookieManager 读取
async function nativeGet(url, cookieString = '') {
  const r = cookieString
    ? await CookieReader.httpGet(url, 'https://y.qq.com', cookieString)
    : await CookieReader.httpGet(url, 'https://y.qq.com');
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
  return JSON.parse(r.body);
}

function decodeB64Utf8(b64) {
  try {
    return Buffer.from(b64, 'base64').toString('utf-8');
  } catch {
    const s = atob(b64);
    const ua = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) ua[i] = s.charCodeAt(i);
    return new TextDecoder().decode(ua);
  }
}

// 从 Cookie 字符串中提取播放授权票据（qm_keyst 优先）
function extractMusicKey(cookie) {
  if (!cookie) return '';
  // 按优先级匹配：qm_keyst > qqmusic_key > music_key > wxskey > p_skey > skey
  const keys = ['qm_keyst', 'qqmusic_key', 'music_key', 'wxskey', 'p_skey', 'skey'];
  for (const k of keys) {
    const m = cookie.match(new RegExp(`(?:^|;\\s*)${k}=([^;]+)`));
    if (m) return m[1];
  }
  return '';
}

// ==================== 搜索 ====================
async function searchAPK(keyword, limit = 30) {
  const d = await nativeGet(qqUrl({
    req_0: {
      module: 'music.search.SearchCgiService',
      method: 'DoSearchForQQMusicDesktop',
      param: { num_per_page: limit, page_num: 1, query: keyword, search_type: 0 },
    },
    comm: { g_tk: 5381, uin: '0', format: 'json', ct: 24, cv: 0, platform: 'h5' },
  }));
  return (d?.req_0?.data?.body?.song?.list || []).map((s) => ({
    id: `qq_${s.mid}`,
    rawId: s.mid,
    mediaMid: s.file?.media_mid || '',
    platform: 'qq',
    title: s.name || '',
    artist: (s.singer || []).map((a) => a.name).join(' / '),
    album: s.album?.name || '',
    cover: s.album?.mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${s.album.mid}.jpg` : '',
    duration: s.interval || 0,
  }));
}

// ==================== 播放链接 ====================
// 安卓端 QQ 音乐播放链接获取
// 策略：先无登录态请求（免费歌曲可播），失败再用登录态重试（VIP 歌曲）
async function urlAPK(id, cookie = '', uin = '0', _key = '', mediaMid = '') {
  const songmid = String(id).replace(/^qq_/, '');
  const cookieStr = cookie || '';

  // 从 cookie 中提取播放授权票据
  const musicKey = extractMusicKey(cookieStr);

  // 把登录 Cookie 同步到音频流域名，让 WebView Audio 播放时带登录态
  if (cookieStr) {
    try { await CookieReader.syncStreamCookies('https://y.qq.com'); } catch {}
  }

  // 随机 guid
  const guid = String(10000000 + Math.floor(Math.random() * 90000000));

  // mediaId 候选：优先 mediaMid，其次 songmid
  const mediaIds = [];
  if (mediaMid) mediaIds.push(mediaMid);
  if (songmid && !mediaIds.includes(songmid)) mediaIds.push(songmid);

  // 音质候选（从低到高，低音质更容易免费）
  const qualityCandidates = [
    { prefix: 'M500', ext: '.mp3' },
    { prefix: 'C400', ext: '.m4a' },
    { prefix: 'M800', ext: '.mp3' },
    { prefix: 'F000', ext: '.flac' },
  ];

  // 生成所有 filename 候选
  const fileCandidates = mediaIds.flatMap(mediaId =>
    qualityCandidates.map(item => ({ ...item, mediaId, filename: item.prefix + mediaId + item.ext }))
  );
  const filenames = fileCandidates.map(item => item.filename);

  // 请求 vkey：先无登录态（免费歌曲），失败再用登录态
  const attempts = [
    { uin: '0', loginflag: 0, ct: 24, authst: null, label: '匿名' },
  ];
  if (musicKey) {
    attempts.push({ uin: String(uin || '0'), loginflag: 1, ct: 19, authst: musicKey, label: '登录态' });
  }

  for (const attempt of attempts) {
    try {
      const param = {
        guid,
        songmid: filenames.map(() => songmid),
        songtype: filenames.map(() => 0),
        uin: attempt.uin,
        loginflag: attempt.loginflag,
        platform: '20',
        filename: filenames,
      };
      const comm = { uin: attempt.uin, format: 'json', ct: attempt.ct, cv: 0 };
      if (attempt.authst) comm.authst = attempt.authst;

      const payload = {
        comm,
        req_0: {
          module: 'vkey.GetVkeyServer',
          method: 'CgiGetVkey',
          param,
        },
      };

      const url = qqUrl(payload);
      const d = await nativeGet(url, attempt.loginflag ? cookieStr : '');
      const data = d?.req_0?.data;
      const infos = Array.isArray(data?.midurlinfo) ? data.midurlinfo : [];
      const info = infos.find(item => item && item.purl) || infos[0];
      const purl = info?.purl;

      console.log(`[vkey:${attempt.label}]`, 'purl:', purl ? 'YES' : 'NO', 'code:', info?.result || info?.code || '-');

      if (purl) {
        const sip = (data?.sip?.[0]) || 'https://ws.stream.qqmusic.qq.com/';
        const streamUrl = sip + purl;
        console.log('[stream url]', streamUrl);
        return streamUrl;
      }
    } catch (e) {
      console.warn(`[vkey:${attempt.label} failed]`, e.message);
    }
  }

  console.warn('[vkey] all attempts failed, tried:', filenames.slice(0, 4));
  return '';
}

// ==================== 歌词 ====================
async function lyricAPK(id) {
  const rawId = String(id).replace(/^qq_/, '');
  const d = await nativeGet(qqUrl({
    req_0: {
      module: 'music.musichallSong.PlayLyricInfo',
      method: 'GetPlayLyricInfo',
      param: { songMID: rawId },
    },
    comm: { uin: '0', format: 'json', ct: 24, cv: 0 },
  }));
  const b64 = d?.req_0?.data?.lyric;
  if (!b64) return '';
  return decodeB64Utf8(b64);
}

// ==================== 用户信息 ====================
async function userInfoAPK(uin, cookie = '') {
  const d = await nativeGet(qqUrl({
    comm: { uin: String(uin), format: 'json', ct: 24, cv: 0 },
    req_0: { module: 'music.UserInfo.userInfoServer', method: 'GetLoginUserInfo', param: {} },
  }), cookie);
  const i = d?.req_0?.data;
  return {
    nickname: i?.nick || 'QQ音乐用户',
    avatar: i?.headpic || '',
    uin: String(uin),
    vipLevel: i?.vipLevel || 0,
    follow: i?.follow || 0,
    fans: i?.fans || 0,
  };
}

// ==================== 用户歌单列表 ====================
async function playlistsAPK(uin, cookie = '') {
  const d = await nativeGet(qqUrl({
    comm: { uin: String(uin), format: 'json', ct: 24, cv: 0 },
    req_0: {
      module: 'music.musicasset.PlaylistBaseRead',
      method: 'GetPlaylistByUin',
      param: { uin: String(uin), num: 100, order: 0 },
    },
  }), cookie);
  return (d?.req_0?.data?.v_playlist || []).map((p) => ({
    id: p.tid || p.dirId || '',
    name: p.diss_name || p.dirName || '歌单',
    cover: p.diss_cover || p.picurl || '',
    songCount: p.song_nums || p.songNum || 0,
  }));
}

// ==================== 歌单详情 ====================
async function playlistAPK(id, cookie = '') {
  const d = await nativeGet(qqUrl({
    comm: { uin: '0', format: 'json', ct: 24, cv: 0 },
    req_0: {
      module: 'music.srfDissInfo.aiDissInfo',
      method: 'uniform_get_Dissinfo',
      param: { disstid: Number(id), song_num: 1000, song_begin: 0, info: 1 },
    },
  }));
  const dirinfo = d?.req_0?.data?.dirinfo;
  const songlist = d?.req_0?.data?.songlist || [];
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

// ==================== Cookie 登录验证 ====================
async function loginByCookieAPK(cookie) {
  const m = cookie.match(/(?:^|;\s*)(?:uin|wxuin)=o?(\d+)/);
  if (!m) return { code: 800, msg: '未找到 uin' };
  const uin = m[1];
  const key = (cookie.match(/(?:^|;\s*)(qqmusic_key|qm_keyst|p_skey|skey)=([^;]+)/) || [])[2] || '';
  try {
    // 用 cookie 调用 userInfo 接口验证登录态是否有效
    const i = await userInfoAPK(uin, cookie);
    return { code: 0, msg: 'ok', cookie, uin, key, nickname: i.nickname };
  } catch {
    return { code: 800, msg: 'cookie 验证失败' };
  }
}

export const music = {
  search: searchAPK,
  url: urlAPK,
  stream: urlAPK,
  cover: (url) => url,
  lyric: lyricAPK,
  loginByCookie: loginByCookieAPK,
  userInfo: (cookie, uin) => userInfoAPK(uin, cookie),
  userPlaylists: (cookie, uin) => playlistsAPK(uin, cookie),
  playlist: (id, _cookie = '') => playlistAPK(id),
};

export default music;
