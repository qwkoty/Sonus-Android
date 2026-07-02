const axios = require('axios');
const express = require('express');
const router = express.Router();

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

function hash33(s) {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash += (hash << 5) + s.charCodeAt(i);
  }
  return hash & 0x7FFFFFFF;
}

// 登录结果缓存，防止并发轮询重复处理
const loginResults = new Map();
const processing = new Set();

async function qqQrCreate() {
  // ssl.pt.qq.com 在本服务器 DNS 返回 NXDOMAIN，只能用 ssl.ptlogin2.qq.com
  // 参数沿用上一代风格：l=L / da=25 / pt_3rd_aid=0
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
  // 直接返回 QQ 原始二维码图片，不做任何二次加工
  // （重新生成会触发 QQ 风控：提示"不能用长按识别只能用摄像头"）
  // 前端用 CSS image-rendering: pixelated 放大显示保持清晰
  const base64 = Buffer.from(resp.data).toString('base64');
  return { qrsig, qrcode: `data:image/png;base64,${base64}` };
}

async function qqQrCheck(qrsig) {
  // 如果已有结果，直接返回
  const cached = loginResults.get(qrsig);
  if (cached) return cached;

  // 如果正在处理，返回等待状态
  if (processing.has(qrsig)) {
    return { code: 67, msg: '正在登录，请稍候…' };
  }

  const ptqrtoken = hash33(qrsig);
  const resp = await axios.get('https://ssl.ptlogin2.qq.com/ptqrlogin', {
    params: {
      u1: 'https://y.qq.com/',
      ptqrtoken,
      ptredirect: '0',
      h: '1',
      t: '1',
      g: '1',
      from_ui: '1',
      ptlang: '2052',
      action: '0-0-' + Date.now(),
      js_ver: '24042410',
      js_type: '1',
      login_sig: '',
      pt_uistyle: '40',
      aid: '716027609',
      daid: '383',
      pt_3rd_aid: '0',
    },
    headers: { 'User-Agent': UA, Referer: 'https://y.qq.com/', Cookie: `qrsig=${qrsig}` },
    timeout: 30000,
    maxRedirects: 0,
    validateStatus: () => true,
  });

  const text = typeof resp.data === 'string' ? resp.data : '';
  const match = text.match(/ptuiCB\('(\d+)','0','([^']*)','0','([^']*)','([^']*)'\)/);
  if (!match) return { code: 66, msg: '等待扫码' };

  const [, code, redirectUrl, msg, nickname] = match;

  if (code !== '0' || !redirectUrl) {
    return { code: Number(code), msg };
  }

  // 登录成功，跟随重定向链收集 Cookie
  processing.add(qrsig);
  try {
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

      // HTTP 重定向
      if (hopResp.status >= 300 && hopResp.status < 400 && hopResp.headers?.location) {
        currentUrl = hopResp.headers.location;
        continue;
      }

      // JS 重定向
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

    const uin = (jar.uin || jar.wxuin || '').toString().replace(/^o0*/, '');
    const key = jar.qqmusic_key || jar.p_skey || jar.skey || '';
    const result = {
      code: 0,
      msg: '登录成功',
      cookie: cookieToString(jar),
      uin,
      key,
      nickname: nickname || 'QQ音乐用户',
    };
    loginResults.set(qrsig, result);
    setTimeout(() => loginResults.delete(qrsig), 60000);
    return result;
  } catch (e) {
    return { code: 800, msg: '登录跳转失败: ' + e.message };
  } finally {
    processing.delete(qrsig);
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
    const { keyword, limit = 20 } = req.query;
    if (!keyword) return res.status(400).json({ error: 'keyword required' });
    const list = await searchQQ(keyword, 1, Number(limit));
    res.json({ code: 200, data: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 播放链接
router.get('/url', async (req, res) => {
  try {
    const { id, cookie = '', uin = '0' } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });
    const url = await getQQUrl(id, cookie, uin);
    res.json({ code: 200, data: { url, platform: 'qq' } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 音频流代理
router.get('/stream', async (req, res) => {
  try {
    const { id, cookie = '', uin = '0' } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });
    const targetUrl = await getQQUrl(id, cookie, uin);
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
    res.setHeader('Access-Control-Allow-Origin', '*');
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
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });
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

// 登录：检查状态
router.get('/login/qq/check', async (req, res) => {
  try {
    const { qrsig } = req.query;
    if (!qrsig) return res.status(400).json({ error: 'qrsig required' });
    const result = await qqQrCheck(qrsig);
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
    const { id, cookie = '' } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });
    const detail = await getQQPlaylist(id, cookie);
    res.json({ code: 200, data: detail });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
