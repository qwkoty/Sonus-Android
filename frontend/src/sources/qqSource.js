// QQ 音乐音源适配器（SourceAdapter）
// 原 frontend/src/api/music.js 的 QQ 逻辑整体迁入此处，行为 100% 不变。
// 额外补充 SourceAdapter 元数据与登录辅助方法，使登录/音源访问统一走抽象接口。

import { CookieReader } from '../plugins/CookieReader';
import { apiUrl } from '../api/base';

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

// 封面跨域代理（QQ 专属）
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

  const musicKey = extractMusicKey(cookieStr);
  console.log('[urlAPK] songmid:', songmid,
    'mediaMid:', mediaMid || '(none)',
    'hasCookie:', !!cookieStr,
    'hasMusicKey:', !!musicKey,
    'musicKeyHead:', musicKey ? musicKey.substring(0, 10) + '...' : '(none)');

  if (cookieStr) {
    try { await CookieReader.syncStreamCookies('https://y.qq.com'); } catch {}
  }

  const guid = String(10000000 + Math.floor(Math.random() * 90000000));

  const mediaIds = [];
  if (mediaMid) mediaIds.push(mediaMid);
  if (songmid && !mediaIds.includes(songmid)) mediaIds.push(songmid);

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
        let sip = (data?.sip?.[0]) || 'https://ws.stream.qqmusic.qq.com/';
        sip = sip.replace(/^http:\/\//, 'https://');
        if (!sip.endsWith('/')) sip += '/';
        const streamUrl = sip + purl;
        console.log('[stream url]', streamUrl);
        return await wrapWithProxy(streamUrl);
      }
    } catch (e) {
      console.warn(`[vkey:${attempt.label} failed]`, e.message);
    }
  }

  console.warn('[vkey] all attempts failed');
  return '';
}

// 后端 /stream 代理取链（与网易云保持一致）：
// 由后端请求 QQ vkey 接口并代理音频流，规避前端原生直连(CookieReader) + 本地 NanoHTTPD 代理
// 在真机上不稳定 / 被风控导致整类歌曲放不出的问题。登录态(qm_keyst)随 query 透传，VIP 歌曲仍可播放。
async function qqUrlBackend(id, cookie = '', uin = '0') {
  const params = new URLSearchParams({ platform: 'qq', id: String(id) });
  if (cookie) {
    params.set('cookie', cookie);
    params.set('uin', String(uin || '0'));
  }
  return apiUrl(`/stream?${params.toString()}`);
}

// 混合取链：原生设备链路优先（设备真实 IP + 设备 Cookie，最不易被 QQ 服务端风控），
// 失败兜底走后端 /stream 代理（与网易云一致）。
// 背景：v1.32 曾把 QQ 整条改走后端，但 QQ 对服务端 IP 的 vkey 接口有风控(500003)，
// 后端在云服务器上几乎必败；原生 urlAPK 正是为绕开该风控而设计。故恢复原生优先，仅保留后端作兜底。
// 详见 docs/DEV_FIX_QQ_PLAYBACK_HYBRID_v1.33.md
async function qqUrlHybrid(id, cookie = '', uin = '0', _key = '', _mediaMid = '') {
  try {
    const nativeUrl = await urlAPK(id, cookie, uin, _key, _mediaMid);
    if (nativeUrl) return nativeUrl;
    console.warn('[qqUrlHybrid] 原生取链为空，兜底走后端 /stream');
  } catch (e) {
    console.warn('[qqUrlHybrid] 原生取链失败，兜底走后端 /stream：', e?.message || e);
  }
  return qqUrlBackend(id, cookie, uin);
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

  // 排查日志：打印响应 key 树（仅路径，不含敏感值）
  function logKeys(obj, prefix = '', depth = 0) {
    if (depth > 5 || !obj || typeof obj !== 'object') return;
    for (const k of Object.keys(obj).slice(0, 40)) {
      console.log(`[userInfo] ${prefix}${k} : ${typeof obj[k]}${Array.isArray(obj[k]) ? `[${obj[k].length}]` : ''}`);
      logKeys(obj[k], `${prefix}${k}.`, depth + 1);
    }
  }
  console.log('[userInfo] === response key tree (uin=' + uin + ') ===');
  logKeys(d);

  // 多层嵌套深层 pick（覆盖 info/result/data/accountInfo 等常见嵌套）
  const deepPick = (obj, ...paths) => {
    for (const path of paths) {
      let cur = obj;
      for (const seg of path) { if (cur && typeof cur === 'object') cur = cur[seg]; else { cur = undefined; break; } }
      if (cur !== undefined && cur !== null && cur !== '' && typeof cur !== 'object') return cur;
    }
    return undefined;
  };

  const rawBase = d?.req_0?.data ?? d?.req_0 ?? {};
  const nick = deepPick(rawBase,
    ['nick'], ['nickname'], ['name'], ['user_name'], ['usrName'],
    // 一层嵌套
    ['info', 'nick'], ['info', 'nickname'], ['info', 'name'],
    ['result', 'nick'], ['result', 'nickname'],
    ['data', 'nick'], ['data', 'nickname'],
    ['base_info', 'nick'],
    // 两层嵌套
    ['info', 'base_info', 'nick'], ['accountInfo', 'nick'],
    ['data', 'info', 'nick'], ['data', 'result', 'nick'],
  );
  const avatar = deepPick(rawBase,
    ['headpic'], ['headimg'], ['avatar'], ['face'], ['headPic'],
    ['pic'], ['picurl'], ['headpic_url'], ['icon'],
    ['info', 'headpic'], ['info', 'avatar'], ['info', 'headimg'],
    ['result', 'avatar'], ['result', 'headpic'],
    ['data', 'avatar'], ['data', 'headpic'],
  );
  const qlogo = uin ? `https://q1.qlogo.cn/g?b=qq&nk=${String(uin)}&s=640` : '';
  console.log('[userInfo] resolved:', { nick: nick || '(fallback)', hasAvatar: !!avatar, useQlogo: !!(!avatar && qlogo) });

  return {
    nickname: nick || 'QQ音乐用户',
    avatar: avatar || qlogo,
    uin: String(uin),
    vipLevel: deepPick(rawBase, ['vipLevel']) || 0,
    isVip: !!(deepPick(rawBase, ['isVip']) || deepPick(rawBase, ['vip']) || deepPick(rawBase, ['vipStatus'])),
    follow: deepPick(rawBase, ['follow']) || 0,
    fans: deepPick(rawBase, ['fans']) || 0,
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
    const i = await userInfoAPK(uin, cookie);
    return { code: 0, msg: 'ok', cookie, uin, key, nickname: i.nickname };
  } catch {
    return { code: 800, msg: 'cookie 验证失败' };
  }
}

// ==================== QQ 扫码登录（前端 JSONP 轮询 + 后端收 cookie）====================
// 后端已提供 /login/qq/qrcode 与 /login/qq/redirect；扫码状态检查（ptqrlogin）走前端 JSONP，
// 绕过服务器 IP 风控（服务器请求会被 403）。

let _qqLoginSig = ''; // qrCreate 返回的 login_sig，qrCheck 复用

async function qqQrCreate() {
  const j = await (await fetch(apiUrl('/login/qq/qrcode'), { credentials: 'include' })).json();
  _qqLoginSig = j?.data?.login_sig || '';
  return { qrcode: j?.data?.qrcode, key: j?.data?.qrsig, login_sig: _qqLoginSig, status: 'waiting' };
}

// ptqrtoken：qrsig 的 33 位哈希（社区标准实现）
function hash33(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h += (h << 5) + s.charCodeAt(i);
  return h & 0x7fffffff;
}

// JSONP 轮询 ptqrlogin：返回回调参数数组或 null（超时/失败）
function qqPtqrlogin(qrsig, loginSig) {
  return new Promise((resolve) => {
    const cb = 'ptqrlogin_Callback';
    const prev = window[cb];
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      try { delete window[cb]; } catch {}
      if (script) script.remove();
      if (prev) window[cb] = prev;
      resolve(v);
    };
    window[cb] = (...args) => finish(args);
    const token = hash33(qrsig);
    const u1 = encodeURIComponent('https://y.qq.com/');
    const url = `https://ssl.ptlogin2.qq.com/ptqrlogin?u1=${u1}&ptqrtoken=${token}` +
      `&ptredirect=0&h=1&t=1&g=1&from_ui=1&ptlang=2052&js_type=1&js_ver=10220` +
      `&login_sig=${encodeURIComponent(loginSig || '')}&pt_randsalt=0&qrsig=${encodeURIComponent(qrsig)}`;
    const script = document.createElement('script');
    script.src = url;
    script.onerror = () => finish(null);
    document.body.appendChild(script);
    setTimeout(() => finish(null), 8000);
  });
}

async function qqQrCheck(qrsig, loginSig) {
  const args = await qqPtqrlogin(qrsig, loginSig);
  if (!args) return { status: 'waiting' };
  const status = Number(args[0]);
  if (status === 0) return { status: 'waiting' };
  if (status === 1) return { status: 'scanned' };
  if (status === 2) {
    // 已确认：args[1]（或 args[4]）为跳转 URL，交给后端跟随收集 cookie
    const redirectUrl = args[1] || args[4] || '';
    if (!redirectUrl) return { status: 'confirmed', cookie: '', uid: '', nickname: 'QQ音乐用户' };
    try {
      const r = await fetch(apiUrl('/login/qq/redirect'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ redirectUrl, qrsig }),
      });
      const j = await r.json();
      const d = j?.data || {};
      return { status: 'confirmed', cookie: d.cookie, uid: d.uin, nickname: d.nickname || 'QQ音乐用户' };
    } catch {
      return { status: 'confirmed', cookie: '', uid: '', nickname: 'QQ音乐用户' };
    }
  }
  return { status: 'expired' };
}

// ==================== SourceAdapter 导出 ====================
export const qqSource = {
  id: 'qq',
  name: 'QQ 音乐',
  loginDomains: ['https://y.qq.com'],
  ready: true,
  loginMethod: 'qr', // 扫码登录

  // —— 登录辅助（供 Login.jsx 使用）——
  openLogin: async () => CookieReader.openLoginWebView(),
  qrCreate: qqQrCreate,
  qrCheck: (key, ctx) => qqQrCheck(key, (ctx && ctx.login_sig) || _qqLoginSig),
  parseCredentials: (cookie) => {
    const m = (cookie || '').match(/(?:^|;\s*)(?:uin|wxuin)=o?(\d+)/);
    const uin = m ? m[1] : '';
    const key = (cookie.match(/(?:^|;\s*)(qqmusic_key|qm_keyst|p_skey|skey)=([^;]+)/) || [])[2] || '';
    return { uin, key };
  },
  validateLogin: async (creds) => {
    try {
      const i = await userInfoAPK(creds.uin, creds.cookie);
      return !!(i && i.nick);
    } catch {
      return false;
    }
  },

  // —— 音源访问（沿用原 music 对象方法签名，保证播放器调用方零改动）——
  search: searchAPK,
  // QQ 播放：原生设备链路优先（绕开 QQ 服务端风控），失败兜底走后端 /stream 代理（与网易云一致）。
  // 详见 docs/DEV_FIX_QQ_PLAYBACK_HYBRID_v1.33.md
  url: qqUrlHybrid,
  stream: qqUrlHybrid,
  cover: (url) => url,
  lyric: lyricAPK,
  loginByCookie: loginByCookieAPK,
  userInfo: (cookie, uin) => userInfoAPK(uin, cookie),
  userPlaylists: (cookie, uin) => playlistsAPK(uin, cookie),
  playlist: (id, _cookie = '') => playlistAPK(id),
  getProxyUrl,
};

export default qqSource;
