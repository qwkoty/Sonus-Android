const axios = require('axios');
const express = require('express');
const router = express.Router();
const ne = require('./netease'); // 网易云：weapi 加密 + 扫码登录/目录

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Referer: 'https://y.qq.com/' };

const cache = new Map();
function withCache(key, ttl, fn) {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.t < ttl) return Promise.resolve(hit.v);
  return fn().then((v) => { cache.set(key, { v, t: now }); return v; });
}

// ==================== Cookie 工具 ====================

function parseSetCookies(setCookieHeaders) {
  const cookies = {};
  if (!setCookieHeaders) return cookies;
  for (const header of setCookieHeaders) {
    const pair = header.split(';')[0];
    const eq = pair.indexOf('=');
    if (eq > 0) cookies[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return cookies;
}

function cookieToString(cookies) {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

// ==================== QQ 音乐搜索 ====================

async function searchQQ(keyword, page = 1, num = 20) {
  const payload = {
    req_0: {
      module: 'music.search.SearchCgiService',
      method: 'DoSearchForQQMusicDesktop',
      param: { num_per_page: num, page_num: page, query: keyword, search_type: 0 },
    },
    comm: { g_tk: 5381, uin: '0', format: 'json', ct: 24, cv: 0, platform: 'h5' },
  };
  const { data } = await axios.get('https://u.y.qq.com/cgi-bin/musicu.fcg', {
    params: { data: JSON.stringify(payload) },
    headers: HEADERS,
    timeout: 15000,
  });
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

// ==================== QQ 音乐歌词 ====================

async function getQQLyric(songmid) {
  const rawId = String(songmid).replace(/^qq_/, '');
  const payload = {
    req_0: { module: 'music.musichallSong.PlayLyricInfo', method: 'GetPlayLyricInfo', param: { songMID: rawId } },
    comm: { uin: '0', format: 'json', ct: 24, cv: 0 },
  };
  const { data } = await axios.get('https://u.y.qq.com/cgi-bin/musicu.fcg', {
    params: { data: JSON.stringify(payload) },
    headers: HEADERS,
    timeout: 10000,
  });
  const b64 = data?.req_0?.data?.lyric;
  if (!b64) return '';
  return Buffer.from(b64, 'base64').toString('utf-8');
}

// ==================== QQ 音乐播放链接 ====================

async function getQQUrl(songmid, cookie = '', uin = '0') {
  const rawId = String(songmid).replace(/^qq_/, '');
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
  if (cookie) headers.Cookie = cookie;
  try {
    const { data } = await axios.get('https://u.y.qq.com/cgi-bin/musicu.fcg', {
      params: { data: JSON.stringify(payload) },
      headers,
      timeout: 10000,
    });
    const item = data?.req_0?.data?.midurlinfo?.[0];
    const sip = data?.req_0?.data?.sip?.[0];
    if (item?.purl && sip) return sip + item.purl;
  } catch (e) {}
  // fallback
  try {
    const { data } = await axios.get('https://c.y.qq.com/base/fcgi-bin/fcg_music_express_mobile3.fcg', {
      params: { format: 'json205361747', songmid: rawId, guid: '10000', uin: String(uin), platform: 'yqq', cid: '205361747' },
      headers,
      timeout: 10000,
    });
    const item = data?.data?.items?.[0];
    if (item?.url) return item.url;
    if (item?.filename) return `https://dl.stream.qqmusic.qq.com/${item.filename}`;
  } catch (e) {}
  return '';
}

// ==================== QQ 音乐扫码登录 ====================
// 注：扫码状态检查（ptqrlogin）已改为前端 JSONP，绕过服务器 IP 风控（服务器请求会 403）
// 后端只负责：1. 获取二维码 (/login/qq/qrcode)  2. 收集登录 cookie (/login/qq/redirect)

// 生成二维码（返回 QQ 原始图片 + qrsig + login_sig）
// 关键：先请求 xlogin 获取 pt_login_sig，否则 ptqrlogin 检查扫码状态会失败
async function qqQrCreate() {
  // 1. 请求 xlogin 获取 pt_login_sig（login_sig）
  let loginSig = '';
  try {
    const xloginResp = await axios.get('https://xui.ptlogin2.qq.com/cgi-bin/xlogin', {
      params: {
        appid: '716027609',
        daid: '383',
        pt_skey_valid: '0',
        pt_no_auth: '1',
        s_url: 'https://y.qq.com/',
        referer: 'https://y.qq.com/',
        self_regurl: '',
        target: 'self',
        style: '40',
        pt_qzone_sig: '1',
        proxy_url: 'https://xui.ptlogin2.qq.com/cgi-bin/xlogin',
        aid: '716027609',
        daid: '383',
        pt_no_auth: '1',
      },
      headers: { 'User-Agent': UA, Referer: 'https://y.qq.com/' },
      timeout: 8000,
      maxRedirects: 0,
      validateStatus: () => true,
    });
    loginSig = parseSetCookies(xloginResp.headers?.['set-cookie'])?.pt_login_sig || '';
  } catch (e) {
    // login_sig 获取失败不阻塞，但扫码状态检测可能会受影响
  }

  // 2. 请求 ptqrshow 获取二维码
  const resp = await axios.get('https://ssl.ptlogin2.qq.com/ptqrshow', {
    params: {
      appid: '716027609',
      e: '2',
      l: 'L',
      s: '3',
      d: '72',
      v: '4',
      t: String(Math.random()),
      da: '25',
      pt_3rd_aid: '0',
    },
    headers: { 'User-Agent': UA, Referer: 'https://y.qq.com/' },
    responseType: 'arraybuffer',
    timeout: 10000,
    maxRedirects: 0,
    validateStatus: () => true,
  });
  const qrsig = parseSetCookies(resp.headers?.['set-cookie'])?.qrsig;
  if (!qrsig) throw new Error('获取二维码失败');
  // 直接返回 QQ 原始二维码图片，不做二次加工（重生成会触发风控）
  const base64 = Buffer.from(resp.data).toString('base64');
  return { qrsig, login_sig: loginSig, qrcode: `data:image/png;base64,${base64}` };
}

// ==================== QQ 音乐 Cookie 登录（免扫码，备用） ====================
// 用户从浏览器复制 QQ 音乐的 Cookie 粘贴进来，后端验证并补全 qqmusic_key
async function qqCookieLogin(rawCookie) {
  if (!rawCookie) return { code: 800, msg: 'Cookie 不能为空' };

  // 解析出 uin
  const cookies = {};
  for (const pair of rawCookie.split(';')) {
    const eq = pair.indexOf('=');
    if (eq > 0) cookies[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  let uin = (cookies.uin || cookies.wxuin || '').toString().replace(/^o0*/, '');
  if (!uin) return { code: 800, msg: 'Cookie 中未找到 uin，请确认复制的是已登录的 QQ 音乐 Cookie' };

  // 用该 cookie 访问 QQ 音乐主页，补全 qqmusic_key
  let jar = { ...cookies };
  try {
    const homeResp = await axios.get('https://y.qq.com/', {
      headers: { 'User-Agent': UA, Cookie: cookieToString(jar) },
      timeout: 8000,
      maxRedirects: 5,
      validateStatus: () => true,
    });
    Object.assign(jar, parseSetCookies(homeResp.headers?.['set-cookie']));
  } catch (e) {}

  const key = jar.qqmusic_key || jar.p_skey || jar.skey || '';
  const fullCookie = cookieToString(jar);

  // 用用户信息接口验证 cookie 是否有效
  try {
    const info = await qqUserInfo(fullCookie, uin);
    if (!info || !info.uin) return { code: 800, msg: 'Cookie 无效或已过期' };
    return {
      code: 0,
      msg: '登录成功',
      cookie: fullCookie,
      uin: String(uin),
      key,
      nickname: info.nickname || 'QQ音乐用户',
    };
  } catch (e) {
    return { code: 800, msg: 'Cookie 验证失败：' + e.message };
  }
}

// ==================== QQ 音乐用户信息 ====================

async function qqUserInfo(cookie, uin) {
  const payload = {
    comm: { uin: String(uin), format: 'json', ct: 24, cv: 0 },
    req_0: { module: 'music.UserInfo.userInfoServer', method: 'GetLoginUserInfo', param: {} },
  };
  const headers = { ...HEADERS, Cookie: cookie };
  try {
    const { data } = await axios.get('https://u.y.qq.com/cgi-bin/musicu.fcg', {
      params: { data: JSON.stringify(payload) },
      headers,
      timeout: 10000,
    });
    const info = data?.req_0?.data;
    return {
      nickname: info?.nick || info?.nickname || 'QQ音乐用户',
      avatar: info?.headpic || info?.avatar || '',
      uin: String(uin),
      vipLevel: info?.vipLevel || 0,
      follow: info?.follow || 0,
      fans: info?.fans || 0,
    };
  } catch (e) {
    return { nickname: 'QQ音乐用户', avatar: '', uin: String(uin), vipLevel: 0, follow: 0, fans: 0 };
  }
}

// ==================== QQ 音乐用户歌单 ====================

async function qqUserPlaylists(cookie, uin) {
  const payload = {
    comm: { uin: String(uin), format: 'json', ct: 24, cv: 0 },
    req_0: {
      module: 'music.musicasset.PlaylistBaseRead',
      method: 'GetPlaylistByUin',
      param: { uin: String(uin), num: 100, order: 0 },
    },
  };
  const headers = { ...HEADERS, Cookie: cookie };
  try {
    const { data } = await axios.get('https://u.y.qq.com/cgi-bin/musicu.fcg', {
      params: { data: JSON.stringify(payload) },
      headers,
      timeout: 10000,
    });
    const list = data?.req_0?.data?.v_playlist || [];
    return list.map((p) => ({
      id: p.tid || p.dirId || '',
      name: p.diss_name || p.dirName || '歌单',
      cover: p.diss_cover || p.picurl || '',
      songCount: p.song_nums || p.songNum || 0,
    }));
  } catch (e) {
    return [];
  }
}

// ==================== QQ 音乐歌单详情 ====================

async function getQQPlaylist(id, cookie = '') {
  return withCache(`qq_playlist_${id}`, 120000, async () => {
    const payload = {
      comm: { uin: '0', format: 'json', ct: 24, cv: 0 },
      req_0: {
        module: 'music.srfDissInfo.aiDissInfo',
        method: 'uniform_get_Dissinfo',
        param: { disstid: Number(id), song_num: 1000, song_begin: 0, info: 1 },
      },
    };
    const headers = { ...HEADERS };
    if (cookie) headers.Cookie = cookie;
    const { data } = await axios.get('https://u.y.qq.com/cgi-bin/musicu.fcg', {
      params: { data: JSON.stringify(payload) },
      headers,
      timeout: 15000,
    });
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
  });
}

// ==================== 路由 ====================

// 搜索
router.get('/search', async (req, res) => {
  try {
    const { keyword, limit = 20, platform = 'qq' } = req.query;
    if (!keyword) return res.status(400).json({ error: 'keyword required' });
    if (platform === 'netease') {
      const list = await ne.neSearch(keyword, Number(limit));
      return res.json({ code: 200, data: list });
    }
    const list = await searchQQ(keyword, 1, Number(limit));
    res.json({ code: 200, data: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 播放链接
router.get('/url', async (req, res) => {
  try {
    const { id, cookie = '', uin = '0', platform = 'qq' } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });
    if (platform === 'netease') {
      const url = await ne.neUrl(id);
      return res.json({ code: 200, data: { url, platform: 'netease' } });
    }
    const url = await getQQUrl(id, cookie, uin);
    res.json({ code: 200, data: { url, platform: 'qq' } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 音频流代理
router.get('/stream', async (req, res) => {
  try {
    const { id, cookie = '', uin = '0', platform = 'qq' } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });
    const targetUrl = platform === 'netease' ? await ne.neUrl(id) : await getQQUrl(id, cookie, uin);
    if (!targetUrl) return res.status(404).json({ error: 'no audio url' });

    const upstreamHeaders = { ...HEADERS };
    if (req.headers.range) upstreamHeaders.Range = req.headers.range;
    const upstream = await axios.get(targetUrl, {
      responseType: 'stream', headers: upstreamHeaders, timeout: 15000, maxRedirects: 5, validateStatus: () => true,
    });
    res.status(upstream.status);
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control']) {
      if (upstream.headers[h]) res.setHeader(h, upstream.headers[h]);
    }
    // 强制声明支持 Range，让浏览器走分段请求做 seek
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Access-Control-Allow-Origin', '*');
    // 暴露 Range 相关头给前端 JS，部分浏览器默认不暴露
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');
    upstream.data.pipe(res);
    req.on('close', () => upstream.data.destroy());
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// 封面代理
router.get('/cover', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'invalid url' });
    const upstream = await axios.get(url, {
      responseType: 'stream', headers: { 'User-Agent': UA }, timeout: 10000, maxRedirects: 5, validateStatus: () => true,
    });
    res.status(upstream.status);
    for (const h of ['content-type', 'content-length', 'cache-control']) {
      if (upstream.headers[h]) res.setHeader(h, upstream.headers[h]);
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    upstream.data.pipe(res);
    req.on('close', () => upstream.data.destroy());
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// 歌词
router.get('/lyric', async (req, res) => {
  try {
    const { id, platform = 'qq' } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });
    if (platform === 'netease') {
      const { lyric, tlyric } = await ne.neLyric(id);
      return res.json({ code: 200, data: { lyric, tlyric, platform: 'netease' } });
    }
    const lyric = await getQQLyric(id);
    res.json({ code: 200, data: { lyric, platform: 'qq' } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 登录：获取二维码
router.get('/login/qq/qrcode', async (req, res) => {
  try {
    const result = await qqQrCreate();
    res.json({ code: 200, data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 前端 JSONP 拿到 redirectUrl 后，后端跟随重定向收集 cookie
router.post('/login/qq/redirect', async (req, res) => {
  try {
    const { redirectUrl, qrsig } = req.body || {};
    if (!redirectUrl || !qrsig) return res.status(400).json({ error: 'redirectUrl and qrsig required' });

    const jar = { qrsig };
    let currentUrl = redirectUrl;

    for (let hop = 0; hop < 10; hop++) {
      const hopResp = await axios.get(currentUrl, {
        headers: { 'User-Agent': UA, Cookie: cookieToString(jar) },
        timeout: 8000,
        maxRedirects: 0,
        validateStatus: () => true,
      });
      Object.assign(jar, parseSetCookies(hopResp.headers?.['set-cookie']));

      if (hopResp.status >= 300 && hopResp.status < 400 && hopResp.headers?.location) {
        currentUrl = hopResp.headers.location;
        continue;
      }

      const body = typeof hopResp.data === 'string' ? hopResp.data : '';
      const jsMatch = body.match(/window\.location(?:\.href)?\s*=\s*["']([^"']+)["']/);
      const metaMatch = body.match(/<meta[^>]*url=([^"'>]+)["']/i);
      const nextUrl = jsMatch?.[1] || metaMatch?.[1];
      if (nextUrl) {
        currentUrl = nextUrl.startsWith('http') ? nextUrl : new URL(nextUrl, currentUrl).href;
        continue;
      }
      break;
    }

    // 补充访问 QQ 音乐主页获取 qqmusic_key
    if (!jar.qqmusic_key) {
      try {
        const homeResp = await axios.get('https://y.qq.com/', {
          headers: { 'User-Agent': UA, Cookie: cookieToString(jar) },
          timeout: 8000,
          maxRedirects: 5,
          validateStatus: () => true,
        });
        Object.assign(jar, parseSetCookies(homeResp.headers?.['set-cookie']));
      } catch (e) {}
    }

    // uin 解析：优先 jar，兜底从 cookie 字符串正则提取
    let uin = (jar.uin || jar.wxuin || '').toString().replace(/^o0*/, '');
    if (!uin) {
      const m = cookieToString(jar).match(/(?:^|;\s*)(?:uin|wxuin)=o?(\d+)/);
      if (m) uin = m[1];
    }

    if (!uin) {
      return res.json({ code: 200, data: { code: 800, msg: 'Cookie 收集失败：未找到 uin' } });
    }

    const key = jar.qqmusic_key || jar.p_skey || jar.skey || '';
    res.json({ code: 200, data: {
      code: 0,
      msg: '登录成功',
      cookie: cookieToString(jar),
      uin,
      key,
      nickname: 'QQ音乐用户',
    }});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// WebView 登录后前端传入 Cookie（APK 模式）
// 前端从 CookieReader 读取完整 cookie 字符串后 POST 到此接口验证
router.post('/login/qq/cookie', async (req, res) => {
  try {
    const { cookie } = req.body || {};
    const result = await qqCookieLogin(cookie || '');
    res.json({ code: 200, data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 用户信息
router.get('/user/qq/info', async (req, res) => {
  try {
    const { cookie, uin } = req.query;
    if (!cookie || !uin) return res.status(400).json({ error: 'cookie and uin required' });
    const info = await qqUserInfo(cookie, uin);
    res.json({ code: 200, data: info });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 用户歌单
router.get('/user/qq/playlists', async (req, res) => {
  try {
    const { cookie, uin } = req.query;
    if (!cookie || !uin) return res.status(400).json({ error: 'cookie and uin required' });
    const list = await qqUserPlaylists(cookie, uin);
    res.json({ code: 200, data: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 歌单详情
router.get('/playlist', async (req, res) => {
  try {
    const { id, cookie = '', platform = 'qq' } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });
    if (platform === 'netease') {
      const detail = await ne.nePlaylist(id);
      return res.json({ code: 200, data: detail });
    }
    const detail = await getQQPlaylist(id, cookie);
    res.json({ code: 200, data: detail });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
