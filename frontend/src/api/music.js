// music.js — Sonus 原生 APK 模式专用 API 层
// 直接请求 QQ 音乐官方接口，通过 CookieReader 自动注入 Cookie，无 CORS 限制
// 参照 Mineradio 项目的 QQ 音乐接口实现

import { CookieReader } from '../plugins/CookieReader';

// 从 Cookie 字符串中提取 uin（兼容 o0 前缀）
function extractUinFromCookie(cookie) {
  if (!cookie) return '';
  const m = cookie.match(/(?:^|;\s*)(?:uin|wxuin)=o?(\d+)/);
  return m ? m[1] : '';
}

function qqUrl(payload) {
  return `https://u.y.qq.com/cgi-bin/musicu.fcg?data=${encodeURIComponent(JSON.stringify(payload))}`;
}

// 本地音频代理端口缓存（首次取到后缓存，避免每次播放都查原生）
let _proxyPort = 0;
async function getProxyPort() {
  if (_proxyPort > 0) return _proxyPort;
  try {
    const r = await CookieReader.getProxyPort();
    if (r && r.available && r.port > 0) _proxyPort = r.port;
  } catch (e) {
    console.warn('[getProxyPort] failed', e?.message || e);
  }
  return _proxyPort;
}

// 把 QQ 音乐 CDN 直链包装成本地代理 URL
// 代理会带 Referer + Cookie 转发请求，绕过 WebView Audio 跨域 403
async function wrapWithProxy(streamUrl) {
  if (!streamUrl) return '';
  const port = await getProxyPort();
  if (port <= 0) {
    console.warn('[wrapWithProxy] proxy not available, fallback to direct URL');
    return streamUrl;
  }
  const proxyUrl = `http://localhost:${port}/?url=${encodeURIComponent(streamUrl)}`;
  console.log('[proxy url]', proxyUrl);
  return proxyUrl;
}

// 导出：供 Visualizer3D 等组件获取代理 URL（用于封面图片跨域加载）
export async function getProxyUrl(url) {
  return await wrapWithProxy(url);
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
  return (d?.req_0?.data?.body?.song?.list || []).filter(Boolean).map((s) => ({
    id: `qq_${s.mid || Math.random().toString(36).slice(2)}`,
    rawId: s.mid || '',
    mediaMid: s.file?.media_mid || s.mid || '',
    platform: 'qq',
    title: s.name || '',
    artist: (s.singer || []).map((a) => a.name).join(' / ') || '未知歌手',
    album: s.album?.name || '',
    cover: s.album?.mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${s.album.mid}.jpg` : '',
    duration: s.interval || 0,
  }));
}

// ==================== 播放链接 ====================
// 安卓端 QQ 音乐播放链接获取
// 免费歌曲匿名即可获取 purl；VIP 歌曲需要登录态 + songtype=1
async function urlAPK(id, cookie = '', uin = '0', _key = '', mediaMid = '') {
  const songmid = String(id).replace(/^qq_/, '');
  const cookieStr = cookie || '';

  // 从 cookie 中提取播放授权票据
  const musicKey = extractMusicKey(cookieStr);
  console.log('[urlAPK] songmid:', songmid,
    'mediaMid:', mediaMid || '(none)',
    'hasCookie:', !!cookieStr,
    'hasMusicKey:', !!musicKey,
    'musicKeyHead:', musicKey ? musicKey.substring(0, 10) + '...' : '(none)');

  // 把登录 Cookie 同步到音频流域名，让 WebView Audio 播放时带登录态
  if (cookieStr) {
    try { await CookieReader.syncStreamCookies('https://y.qq.com'); } catch {}
  }

  const guid = String(10000000 + Math.floor(Math.random() * 90000000));

  // mediaId 候选：优先 mediaMid，其次 songmid
  const mediaIds = [];
  if (mediaMid) mediaIds.push(mediaMid);
  if (songmid && !mediaIds.includes(songmid)) mediaIds.push(songmid);

  // 音质候选（从低到高）
  const qualityCandidates = [
    { prefix: 'M500', ext: '.mp3' },
    { prefix: 'C400', ext: '.m4a' },
    { prefix: 'M800', ext: '.mp3' },
    { prefix: 'F000', ext: '.flac' },
  ];

  const fileCandidates = mediaIds.flatMap(mediaId =>
    qualityCandidates.map(item => ({ ...item, mediaId, filename: item.prefix + mediaId + item.ext }))
  );
  const filenames = fileCandidates.map(item => item.filename);

  // 三轮尝试：
  // 1. 匿名 + songtype=0 → 免费歌曲能拿到 purl
  // 2. 登录态 + songtype=0 → 部分歌曲需要登录态
  // 3. 登录态 + songtype=1 → VIP 歌曲需要标记为付费歌曲
  const attempts = [
    { uin: '0', loginflag: 0, ct: 24, authst: null, songtype: 0, label: '匿名', useCookie: false },
  ];
  if (musicKey) {
    attempts.push({ uin: String(uin || '0'), loginflag: 1, ct: 19, authst: musicKey, songtype: 0, label: '登录态', useCookie: true });
    attempts.push({ uin: String(uin || '0'), loginflag: 1, ct: 19, authst: musicKey, songtype: 1, label: 'VIP', useCookie: true });
  }

  for (const attempt of attempts) {
    try {
      const param = {
        guid,
        songmid: filenames.map(() => songmid),
        songtype: filenames.map(() => attempt.songtype),
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
      const d = await nativeGet(url, attempt.useCookie ? cookieStr : '');
      const data = d?.req_0?.data;
      const infos = Array.isArray(data?.midurlinfo) ? data.midurlinfo : [];
      const info = infos.find(item => item && item.purl) || infos[0];
      const purl = info?.purl;

      console.log(`[vkey:${attempt.label}]`, 'songtype:', attempt.songtype,
        'purl:', purl ? 'YES' : 'NO',
        'code:', info?.result || info?.code || '-',
        'sip:', data?.sip?.[0] || '(none)',
        'filename:', info?.filename || '(none)');

      if (purl) {
        // 强制 https，避免混合内容被 WebView 拦截
        let sip = (data?.sip?.[0]) || 'https://ws.stream.qqmusic.qq.com/';
        sip = sip.replace(/^http:\/\//, 'https://');
        if (!sip.endsWith('/')) sip += '/';
        const streamUrl = sip + purl;
        console.log('[stream url]', streamUrl);
        // 通过本地代理播放：注入 Referer + Cookie，绕过 WebView Audio 跨域 403
        return await wrapWithProxy(streamUrl);
      }
    } catch (e) {
      console.warn(`[vkey:${attempt.label} failed]`, e.message);
    }
  }

  console.warn('[vkey] all attempts failed');
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

// 计算 QQ 音乐 g_tk（从 cookie 中的 p_skey 或 skey）
function getGtk(skey) {
  if (!skey) return 5381;
  let hash = 5381;
  for (let i = 0; i < skey.length; i++) {
    hash += (hash << 5) + skey.charCodeAt(i);
  }
  return hash & 0x7fffffff;
}

// 解析 QQ 音乐 JSONP 响应 (callback({...}))
function parseJsonp(text, cbName = 'MusicJsonCallback') {
  if (!text) return null;
  const trimmed = text.trim();
  const prefix = cbName + '(';
  if (trimmed.startsWith(prefix) && trimmed.endsWith(')')) {
    try {
      return JSON.parse(trimmed.slice(prefix.length, -1));
    } catch (e) {
      return null;
    }
  }
  // 兜底：直接当 JSON 解析
  try {
    return JSON.parse(trimmed);
  } catch (e) {
    return null;
  }
}

// ==================== 用户信息 ====================
async function userInfoAPK(uin, cookie = '') {
  const skeyMatch = (cookie || '').match(/(?:^|;\s*)skey=([^;]+)/);
  const pskeyMatch = (cookie || '').match(/(?:^|;\s*)p_skey=([^;]+)/);
  const gtk = getGtk(pskeyMatch ? pskeyMatch[1] : (skeyMatch ? skeyMatch[1] : ''));
  const uinStr = String(uin || extractUinFromCookie(cookie) || '0');

  // 尝试接口 0：c.y.qq.com 公开用户主页接口（不需要登录 Cookie，最稳定）
  try {
    const profileUrl = `https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg?cid=205360838&userid=${encodeURIComponent(uinStr)}&reqfrom=1&reqtype=0&_=Date.now()`;
    const r0 = await CookieReader.httpGet(profileUrl, 'https://y.qq.com');
    const d0 = parseJsonp(r0?.body, 'MusicJsonCallback');
    const pd = d0?.data;
    if (pd && (pd.nick || pd.headpic)) {
      const avatar = pd?.headpic || pd?.headimg || pd?.avatar || '';
      const nickname = pd?.nick || pd?.nickname || '';
      console.log('[userInfo] from fcg_get_profile_homepage:', { nickname, uin: uinStr });
      return {
        nickname: nickname || 'QQ音乐用户',
        avatar,
        uin: uinStr,
        vipLevel: pd?.vipLevel || 0,
        isVip: false,
        follow: 0,
        fans: 0,
      };
    }
  } catch (e) {
    console.warn('[userInfo] fcg_get_profile_homepage failed:', e.message);
  }

  // 尝试接口 1：music.UserInfo.userInfoServer.GetLoginUserInfo（登录态）
  try {
    const d = await nativeGet(qqUrl({
      comm: {
        uin: uinStr,
        format: 'json',
        ct: 24,
        cv: 0,
        g_tk: gtk,
        t: Date.now(),
      },
      req_0: {
        module: 'music.UserInfo.userInfoServer',
        method: 'GetLoginUserInfo',
        param: {},
      },
    }), cookie);
    const i = d?.req_0?.data;
    if (i && (i.nick || i.nickname || i.name || i.headpic)) {
      const avatar = i?.headpic || i?.headimg || i?.avatar || i?.face || i?.headPic || '';
      const nickname = i?.nick || i?.nickname || i?.name || i?.userName || '';
      console.log('[userInfo] from GetLoginUserInfo:', { nickname, uin: uinStr });
      return {
        nickname: nickname || 'QQ音乐用户',
        avatar,
        uin: uinStr,
        vipLevel: i?.vipLevel || 0,
        isVip: !!(i?.isVip || i?.vip || i?.vipStatus || i?.svipLevel || i?.payPackId),
        follow: i?.follow || 0,
        fans: i?.fans || 0,
      };
    }
  } catch (e) {
    console.warn('[userInfo] GetLoginUserInfo failed:', e.message);
  }

  // 尝试接口 2：music.login.UserV3.GetUinEncryptMc（常用用户信息接口）
  try {
    const d2 = await nativeGet(qqUrl({
      comm: {
        uin: uinStr,
        format: 'json',
        ct: 24,
        cv: 0,
        g_tk: gtk,
        t: Date.now(),
      },
      req_0: {
        module: 'music.login.UserV3',
        method: 'GetUinEncryptMc',
        param: { uin: uinStr },
      },
    }), cookie);
    const i2 = d2?.req_0?.data;
    if (i2 && (i2.nick || i2.nickname || i2.name)) {
      const avatar = i2?.headpic || i2?.headimg || i2?.avatar || i2?.face || '';
      const nickname = i2?.nick || i2?.nickname || i2?.name || i2?.userName || '';
      console.log('[userInfo] from GetUinEncryptMc:', { nickname, uin: uinStr });
      return {
        nickname: nickname || 'QQ音乐用户',
        avatar,
        uin: uinStr,
        vipLevel: i2?.vipLevel || 0,
        isVip: !!(i2?.isVip || i2?.vip || i2?.vipStatus),
        follow: i2?.follow || 0,
        fans: i2?.fans || 0,
      };
    }
  } catch (e) {
    console.warn('[userInfo] GetUinEncryptMc failed:', e.message);
  }

  // 兜底：从 cookie 里尝试找名字（部分登录方式 cookie 里会有 nick）
  const cookieNick = (cookie || '').match(/(?:^|;\s*)nick=([^;]+)/);
  const fallbackNick = cookieNick ? decodeURIComponent(cookieNick[1]) : 'QQ音乐用户';
  console.log('[userInfo] all interfaces failed, fallback nick:', fallbackNick);
  return {
    nickname: fallbackNick,
    avatar: uinStr ? `https://q1.qlogo.cn/g?b=qq&nk=${uinStr}&s=640` : '',
    uin: uinStr,
    vipLevel: 0,
    isVip: false,
    follow: 0,
    fans: 0,
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
  return (d?.req_0?.data?.v_playlist || []).filter(Boolean).map((p) => ({
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
    tracks: songlist.filter(Boolean).map((s) => ({
      id: `qq_${s.mid || s.songmid || Math.random().toString(36).slice(2)}`,
      rawId: s.mid || s.songmid || '',
      mediaMid: s.file?.media_mid || s.mid || '',
      platform: 'qq',
      title: s.name || s.title || '未知歌曲',
      artist: (s.singer || []).map((a) => a.name).join(' / ') || '未知歌手',
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
