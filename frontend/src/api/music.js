// music.js — Sonus 原生 APK 模式专用 API 层
// 直接请求 QQ 音乐官方接口，通过 CookieReader 自动注入 Cookie，无 CORS 限制

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
    platform: 'qq',
    title: s.name || '',
    artist: (s.singer || []).map((a) => a.name).join(' / '),
    album: s.album?.name || '',
    cover: s.album?.mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${s.album.mid}.jpg` : '',
    duration: s.interval || 0,
  }));
}

// ==================== 播放链接 ====================
// 多策略 fallback：先试 m4a 标准音质，空了试 mp3，再试 songtype=1（VIP）
// cookie 字符串优先注入请求头，保证登录态有效
async function urlAPK(id, cookie = '', uin = '0', key = '') {
  const rawId = String(id).replace(/^qq_/, '');
  const uinStr = String(uin || '0');
  const loginflag = cookie ? 1 : 0;
  const cookieStr = cookie || '';

  // 把登录 Cookie 同步到音频流域名，让 WebView Audio 播放时带登录态
  if (cookieStr) {
    try { await CookieReader.syncStreamCookies('https://y.qq.com'); } catch {}
  }

  // 策略列表：音质前缀/后缀 + songtype 组合
  const strategies = [
    { prefix: 'C400', ext: '.m4a', songtype: 0 },
    { prefix: 'M500', ext: '.mp3', songtype: 0 },
    { prefix: 'M800', ext: '.mp3', songtype: 0 },
    { prefix: 'C400', ext: '.m4a', songtype: 1 },
    { prefix: 'M500', ext: '.mp3', songtype: 1 },
  ];

  for (const s of strategies) {
    try {
      // 标准 filename 格式：前缀 + songmid + mediaId(默认=songmid) + 后缀
      const file = `${s.prefix}${rawId}${rawId}${s.ext}`;
      const guid = '10000';
      const payload = {
        req_0: {
          module: 'vkey.GetVkeyServer',
          method: 'CgiGetVkey',
          param: {
            filename: [file],
            guid,
            songmid: [rawId],
            songtype: [s.songtype],
            uin: uinStr,
            loginflag,
            platform: '20',
          },
        },
        comm: {
          uin: uinStr,
          format: 'json',
          ct: 19,
          cv: 0,
          authst: key || '',
        },
      };
      const url = `https://u.y.qq.com/cgi-bin/musicu.fcg?-=getplaysongvkey&g_tk=5381&loginUin=${uinStr}&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0&data=${encodeURIComponent(JSON.stringify(payload))}`;
      const d = await nativeGet(url, cookieStr);
      console.log('[vkey]', file, s.songtype, JSON.stringify(d?.req_0?.data?.midurlinfo?.[0]));
      const item = d?.req_0?.data?.midurlinfo?.[0];
      let domain = d?.req_0?.data?.sip?.find(i => !i.startsWith('http://ws'));
      if (!domain) domain = d?.req_0?.data?.sip?.[0];
      if (item?.purl && domain) {
        const url = domain + item.purl;
        console.log('[stream url]', url);
        return url;
      }
    } catch (e) {
      console.warn('[vkey failed]', s.songtype, e.message);
    }
  }

  // 最后 fallback：旧版 mobile express 接口
  try {
    const fb = await nativeGet(
      `https://c.y.qq.com/base/fcgi-bin/fcg_music_express_mobile3.fcg?format=json205361747&songmid=${rawId}&filename=C400${rawId}.m4a&guid=10000&uin=${uinStr}&platform=yqq&cid=205361747`,
      cookieStr
    );
    console.log('[express fallback]', JSON.stringify(fb));
    const fi = fb?.data?.items?.[0];
    if (fi?.url) return fi.url;
    if (fi?.filename) return `https://dl.stream.qqmusic.qq.com/${fi.filename}`;
  } catch (e) {
    console.warn('[express fallback failed]', e.message);
  }
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
