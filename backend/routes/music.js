const axios = require('axios');
const express = require('express');
const QRCode = require('qrcode');
const router = express.Router();

const FAKE_IP = '223.5.5.5';
const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'X-Real-IP': FAKE_IP,
  'X-Forwarded-For': FAKE_IP,
};

const cache = new Map();
function withCache(key, ttl, fn) {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.t < ttl) return Promise.resolve(hit.v);
  return fn().then((v) => { cache.set(key, { v, t: now }); return v; });
}

function parseSetCookies(setCookies) {
  const jar = {};
  for (const c of (setCookies || [])) {
    const eq = c.indexOf('=');
    if (eq > 0) {
      const k = c.slice(0, eq).trim();
      const v = c.slice(eq + 1).split(';')[0];
      if (k) jar[k] = v;
    }
  }
  return jar;
}

function cookieJarToString(jar) {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

// ---------- 扫码登录：网易云 ----------
// 生成 unikey
async function neteaseQrUnikey() {
  const url = 'https://music.163.com/api/login/qrcode/unikey';
  const { data } = await axios.post(url, 'type=1', {
    headers: {
      ...COMMON_HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: 'https://music.163.com/',
    },
    timeout: 10000,
  });
  return data?.unikey || '';
}

// 生成二维码（后端用 qrcode 库根据 unikey 生成图片）
async function neteaseQrCreate(unikey) {
  const qrUrl = `https://music.163.com/m/login?codekey=${unikey}`;
  const qrimg = await QRCode.toDataURL(qrUrl, { margin: 1, width: 280 });
  return { qrimg, qrurl: qrUrl };
}

const neteaseCookieJars = new Map();

async function neteaseQrCheck(unikey) {
  let jar = neteaseCookieJars.get(unikey) || {};
  const url = 'https://music.163.com/api/login/qrcode/client/login';
  const resp = await axios.post(url, `key=${unikey}&type=1`, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...COMMON_HEADERS,
      Referer: 'https://music.163.com/',
      Cookie: cookieJarToString(jar),
    },
    timeout: 10000,
    maxRedirects: 0,
    validateStatus: () => true,
  });
  const newCookies = parseSetCookies(resp.headers?.['set-cookie']);
  Object.assign(jar, newCookies);
  neteaseCookieJars.set(unikey, jar);

  const data = resp.data || {};
  let cookie = '';
  if (data.code === 803) {
    if (jar.MUSIC_U) {
      cookie = Object.entries(jar)
        .filter(([k]) => ['MUSIC_U', '__csrf', 'MUSIC_S', '__remember_me', 'NMTID'].includes(k))
        .map(([k, v]) => `${k}=${v}`).join('; ');
    }
    if (!cookie && newCookies.MUSIC_U) {
      cookie = Object.entries(newCookies)
        .map(([k, v]) => `${k}=${v}`).join('; ');
    }
    setTimeout(() => neteaseCookieJars.delete(unikey), 30000);
  }

  let user = null;
  if (cookie) {
    try {
      // 5 秒超时，用户信息获取失败不阻塞登录成功
      user = await Promise.race([
        neteaseUserInfo(cookie),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
      ]);
    } catch (e) { /* ignore */ }
  }
  return { code: data.code, cookie, user };
}

// 网易云用户信息
async function neteaseUserInfo(cookie) {
  const url = 'https://music.163.com/api/w/nuser/account/get';
  const { data } = await axios.get(url, {
    headers: {
      ...COMMON_HEADERS,
      Cookie: cookie,
      Referer: 'https://music.163.com/',
    },
    timeout: 10000,
  });
  const acc = data?.account || data?.profile;
  if (!acc) return null;
  return {
    nickname: data?.profile?.nickname || acc.nickname || '网易云用户',
    avatar: data?.profile?.avatarUrl || '',
    userId: acc.userId || data?.profile?.userId || '',
  };
}

// 网易云用户歌单列表
async function neteaseUserPlaylists(cookie, uid) {
  const url = 'https://music.163.com/api/user/playlist';
  const { data } = await axios.get(url, {
    params: { uid, limit: 100, offset: 0 },
    headers: { ...COMMON_HEADERS, Cookie: cookie, Referer: 'https://music.163.com/' },
    timeout: 10000,
  });
  const list = data?.playlist || [];
  return list.map((p) => ({
    id: String(p.id),
    name: p.name,
    cover: p.coverImgUrl || '',
    trackCount: p.trackCount || 0,
    creator: p.creator?.nickname || '',
  }));
}

// QQ 音乐二维码登录会话（key: qrsig, value: cookie jar）
const qqCookieJars = new Map();
// 正在处理登录重定向的 qrsig 集合，防止前端高频轮询导致并发处理
const qqProcessing = new Map();
// 已完成的登录结果缓存（防止前端请求超时后重试时丢失结果）
const qqLoginResults = new Map();

async function qqQrCreate() {
  const showUrl = 'https://ssl.ptlogin2.qq.com/ptqrshow';
  const showResp = await axios.get(showUrl, {
    params: {
      appid: '716027609',
      e: '2',
      l: 'M',
      s: '3',
      d: '72',
      v: '4',
      t: String(Math.random()),
      daid: '383',
      pt_3rd_aid: '100497308',
    },
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Referer: 'https://y.qq.com/',
    },
    timeout: 15000,
    responseType: 'arraybuffer',
    maxRedirects: 0,
    validateStatus: () => true,
  });
  const jar = parseSetCookies(showResp.headers?.['set-cookie']);
  const qrsig = jar.qrsig || '';
  if (!qrsig) throw new Error('获取 qrsig 失败');
  qqCookieJars.set(qrsig, jar);
  const qrimg = 'data:image/png;base64,' + Buffer.from(showResp.data).toString('base64');
  return { qrsig, qrimg };
}

function hash33(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h += (h << 5) + s.charCodeAt(i);
  }
  return 2147483647 & h;
}

async function qqQrCheck(qrsig) {
  // 如果已有完成的登录结果，直接返回（防止前端请求超时后重试丢失结果）
  const cached = qqLoginResults.get(qrsig);
  if (cached) {
    qqLoginResults.delete(qrsig);
    return cached;
  }
  // 防止前端高频轮询导致并发处理同一 qrsig 的重定向链
  if (qqProcessing.has(qrsig)) {
    return { code: 802, msg: '正在登录，请稍候…', cookie: '', uin: '', key: '', user: null };
  }

  let jar = qqCookieJars.get(qrsig) || { qrsig };
  const ptqrtoken = hash33(qrsig);
  const loginUrl = 'https://ssl.ptlogin2.qq.com/ptqrlogin';
  const resp = await axios.get(loginUrl, {
    params: {
      u1: 'https://graph.qq.com/oauth2.0/authorize?client_id=100497308&redirect_uri=https%3A%2F%2Fy.qq.com%2Fportal%2Fwx_redirect.html&response_type=code&state=qqmusic',
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
      login_sig: jar.pt_login_sig || '',
      pt_uistyle: '40',
      aid: '716027609',
      daid: '383',
      pt_3rd_aid: '100497308',
    },
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Cookie: cookieJarToString(jar),
      Referer: 'https://y.qq.com/',
    },
    timeout: 10000,
    maxRedirects: 0,
    validateStatus: () => true,
  });
  Object.assign(jar, parseSetCookies(resp.headers?.['set-cookie']));

  const body = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
  const m = body.match(/ptuiCB\('(\d+)','(\d+)','([^']*)','(\d+)','([^']*)'/);
  if (!m) return { code: 800, msg: '解析失败', cookie: '', uin: '', key: '', user: null };
  const [, code, , redirectUrl, , msg] = m;

  // 未登录成功：保存 jar 并返回状态码
  if (code !== '0' || !redirectUrl) {
    qqCookieJars.set(qrsig, jar);
    const statusMap = { '66': 801, '67': 802, '65': 800, '68': 800 };
    return { code: statusMap[code] || 800, msg: msg || '', cookie: '', uin: '', key: '', user: null };
  }

  // 登录成功，标记为处理中，防止并发
  qqProcessing.set(qrsig, true);
  const deadline = Date.now() + 20000; // 重定向链总超时 20 秒

  try {
    // 跟随重定向链（最多 8 跳，同时检测 HTTP 302 和 JS 跳转）
    let currentUrl = redirectUrl;
    for (let hop = 0; hop < 8 && Date.now() < deadline; hop++) {
      const hopResp = await axios.get(currentUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Cookie: cookieJarToString(jar),
          Referer: 'https://y.qq.com/',
        },
        timeout: 6000,
        maxRedirects: 0,
        validateStatus: () => true,
      });
      Object.assign(jar, parseSetCookies(hopResp.headers?.['set-cookie']));

      // 1. 检查 HTTP 302/301 重定向
      let loc = hopResp.headers?.location;
      if (loc) {
        if (loc.startsWith('/')) {
          try { const u = new URL(currentUrl); loc = `${u.protocol}//${u.host}${loc}`; } catch (e) {}
        }
        if (loc.startsWith('http')) { currentUrl = loc; continue; }
      }

      // 2. 检查 HTML 中的 JS 跳转和 meta refresh（OAuth 回调页常用）
      if (hopResp.data && typeof hopResp.data === 'string') {
        const jsMatch = hopResp.data.match(/(?:window\.location|location)\.href\s*=\s*["']([^"']+)["']/i);
        const metaMatch = hopResp.data.match(/<meta[^>]*http-equiv=["']refresh["'][^>]*url=([^"'>\s]+)/i);
        const found = jsMatch || metaMatch;
        if (found) {
          let nextUrl = found[1];
          if (nextUrl.startsWith('/')) {
            try { const u = new URL(currentUrl); nextUrl = `${u.protocol}//${u.host}${nextUrl}`; } catch (e) {}
          }
          if (nextUrl.startsWith('http')) { currentUrl = nextUrl; continue; }
        }
      }
      break; // 没有更多跳转
    }

    // 始终访问 QQ 音乐主页获取 qqmusic_key（无论重定向链结果如何）
    try {
      const homeResp = await axios.get('https://y.qq.com/', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Cookie: cookieJarToString(jar),
        },
        timeout: 6000,
        maxRedirects: 5,
        validateStatus: () => true,
      });
      Object.assign(jar, parseSetCookies(homeResp.headers?.['set-cookie']));
    } catch (e) { /* 主页访问失败不阻塞 */ }

    // 提取 uin 和 key
    let uin = (jar.uin || jar.wxuin || '').toString().replace(/^o0*/, '');
    let key = jar.qqmusic_key || jar.ptmqmusicticket || jar.p_skey || jar.skey || '';
    if (!key) {
      for (const k of Object.keys(jar)) {
        if (/music.*key/i.test(k) && jar[k]) { key = jar[k]; break; }
      }
    }
    const cookieStr = cookieJarToString(jar);

    // 获取用户信息（5 秒超时，失败不阻塞登录成功）
    let user = null;
    if (uin) {
      try {
        user = await Promise.race([
          qqUserInfo(uin, key || ''),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
        ]);
      } catch (e) {
        console.error('QQ userinfo error:', e.message);
      }
    }

    qqCookieJars.delete(qrsig);
    const result = { code: 803, msg: '登录成功', cookie: cookieStr, uin, key, user };
    qqLoginResults.set(qrsig, result);
    setTimeout(() => qqLoginResults.delete(qrsig), 60000);
    return result;
  } catch (e) {
    console.error('QQ redirect error:', e.message);
    // 即使重定向链出错，也尝试用已收集的 cookie 返回成功
    let uin = (jar.uin || jar.wxuin || '').toString().replace(/^o0*/, '');
    let key = jar.qqmusic_key || jar.p_skey || jar.skey || '';
    const cookieStr = cookieJarToString(jar);
    qqCookieJars.delete(qrsig);
    if (uin || cookieStr) {
      const result = { code: 803, msg: '登录成功', cookie: cookieStr, uin, key, user: null };
      qqLoginResults.set(qrsig, result);
      setTimeout(() => qqLoginResults.delete(qrsig), 60000);
      return result;
    }
    return { code: 800, msg: '登录跳转失败: ' + e.message, cookie: '', uin: '', key: '', user: null };
  } finally {
    qqProcessing.delete(qrsig);
  }
}

// QQ 音乐用户信息
async function qqUserInfo(uin, key) {
  const url = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
  const payload = {
    comm: { uin: Number(uin), format: 'json', ct: 24, cv: 0 },
    req_0: {
      module: 'music.UserInfo.userInfoServer',
      method: 'GetLoginUserInfo',
      param: {},
    },
    req_1: {
      module: 'music.musicasset.PlaylistBaseRead',
      method: 'GetPlaylistByUin',
      param: { hostUin: Number(uin), size: 1, dirId: 0, from: 1 },
    },
  };
  const { data } = await axios.get(url, {
    params: { data: JSON.stringify(payload) },
    headers: {
      ...COMMON_HEADERS,
      Cookie: `uin=o0${uin}; qqmusic_key=${key};`,
      Referer: 'https://y.qq.com/',
    },
    timeout: 10000,
  });
  const info = data?.req_0?.data;
  if (!info) return null;
  return {
    nickname: info.nickname || info.name || 'QQ音乐用户',
    avatar: info.headpic || info.avatar || '',
    userId: uin,
    vipLevel: info.vipLevel || info.diamondLevel || 0,
    follow: info.follow || 0,
    fans: info.fans || 0,
  };
}

// QQ 音乐用户歌单
async function qqUserPlaylists(uin, key) {
  const url = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
  const payload = {
    comm: { uin: Number(uin), format: 'json', ct: 24, cv: 0 },
    req_0: {
      module: 'music.musicasset.PlaylistBaseRead',
      method: 'GetPlaylistByUin',
      param: { hostUin: Number(uin), size: 100, dirId: 0, from: 1 },
    },
  };
  const { data } = await axios.get(url, {
    params: { data: JSON.stringify(payload) },
    headers: {
      ...COMMON_HEADERS,
      Cookie: `uin=o0${uin}; qqmusic_key=${key};`,
      Referer: 'https://y.qq.com/',
    },
    timeout: 10000,
  });
  const vlist = data?.req_0?.data?.v_playlist || [];
  return vlist.map((p) => ({
    id: String(p.tid),
    name: p.diss_name || p.title || '',
    cover: p.diss_cover || p.picurl || '',
    trackCount: p.song_cnt || 0,
    creator: p.creator?.name || '',
  }));
}

// ---------- 网易云音乐 ----------
async function searchNetease(keyword, limit = 20) {
  const url = 'https://music.163.com/api/search/get/web';
  const { data } = await axios.get(url, {
    params: { csrf_token: '', s: keyword, type: 1, offset: 0, total: true, limit },
    headers: { ...COMMON_HEADERS, Referer: 'https://music.163.com/' },
    timeout: 15000,
  });

  const songs = data?.result?.songs || [];
  return songs.map((s) => ({
    id: `netease_${s.id}`,
    rawId: String(s.id),
    platform: 'netease',
    title: s.name,
    artist: (s.artists || []).map((a) => a.name).join(' / '),
    album: s.album?.name || '',
    cover: s.album?.picUrl
      ? s.album.picUrl + '?param=300x300'
      : s.album?.blurPicUrl
        ? s.album.blurPicUrl + '?param=300x300'
        : '',
    duration: Math.floor((s.duration || 0) / 1000),
    url: null,
  }));
}

// 网易云播放链接：多级 fallback，cookie 可选（登录后解锁 VIP）
async function getNeteaseRealUrl(id, cookie = '') {
  const cookieHeader = cookie ? { Cookie: cookie } : {};
  // 1. 标准 enhance/player/url，提升到 320k
  try {
    const url = 'https://music.163.com/api/song/enhance/player/url';
    const { data } = await axios.post(url, `ids=[${id}]&br=320000`, {
      headers: {
        ...COMMON_HEADERS,
        ...cookieHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: 'https://music.163.com/',
      },
      timeout: 10000,
    });
    const song = data?.data?.[0];
    if (song?.code === 200 && song?.url) {
      return song.url.replace('http:', 'https:');
    }
  } catch (e) {
    console.error('Netease enhance url error:', e.message);
  }

  // 2. outer/url 302 重定向兜底（免费歌曲直接可用）
  try {
    const outerUrl = `https://music.163.com/song/media/outer/url?id=${id}.mp3`;
    const resp = await axios.get(outerUrl, {
      headers: { ...COMMON_HEADERS, ...cookieHeader },
      timeout: 8000,
      maxRedirects: 0,
      validateStatus: () => true,
    });
    // 302/301 时取 Location
    if ([301, 302].includes(resp.status) && resp.headers?.location) {
      return resp.headers.location.replace('http:', 'https:');
    }
    // 某些情况会直接 200 返回音频
    if (resp.status === 200 && resp.headers?.['content-type']?.includes('audio')) {
      return outerUrl.replace('http:', 'https:');
    }
  } catch (e) {
    console.error('Netease outer url error:', e.message);
  }

  return '';
}

async function getNeteaseLyric(id) {
  const url = 'https://music.163.com/api/song/lyric';
  const { data } = await axios.get(url, {
    params: { id, lv: 1, kv: 1, tv: -1 },
    headers: { ...COMMON_HEADERS, Referer: 'https://music.163.com/' },
    timeout: 10000,
  });
  return data?.lrc?.lyric || '';
}

// 网易云歌单详情
async function getNeteasePlaylist(id) {
  return withCache(`netease_pl_${id}`, 120000, async () => {
    const url = 'https://music.163.com/api/v6/playlist/detail';
    const { data } = await axios.get(url, {
      params: { id, n: 1000 },
      headers: { ...COMMON_HEADERS, Referer: 'https://music.163.com/' },
      timeout: 15000,
    });
    const tracks = data?.playlist?.tracks || [];
    return {
      name: data?.playlist?.name || '',
      cover: data?.playlist?.coverImgUrl || '',
      tracks: tracks.map((s) => ({
        id: `netease_${s.id}`,
        rawId: String(s.id),
        platform: 'netease',
        title: s.name,
        artist: (s.ar || []).map((a) => a.name).join(' / '),
        album: s.al?.name || '',
        cover: s.al?.picUrl ? s.al.picUrl + '?param=300x300' : '',
        duration: Math.floor((s.dt || 0) / 1000),
        url: null,
      })),
    };
  });
}

// 网易云排行榜（返回榜单列表）
async function getNeteaseRankList() {
  return withCache('netease_rank_list', 600000, async () => {
    const url = 'https://music.163.com/api/toplist';
    const { data } = await axios.get(url, {
      headers: { ...COMMON_HEADERS, Referer: 'https://music.163.com/' },
      timeout: 10000,
    });
    const list = data?.list || [];
    return list.map((t) => ({
      id: String(t.id),
      name: t.name,
      cover: t.coverImgUrl,
      description: t.description || '',
      updateFrequency: t.updateFrequency || '',
    }));
  });
}

// 网易云某个榜单的歌曲（榜单本身也是一个歌单）
async function getNeteaseRankSongs(id) {
  return getNeteasePlaylist(id);
}

// ---------- QQ 音乐（musicu.fcg 新接口） ----------
async function searchQQ(keyword, page = 1, num = 20) {
  const url = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
  const payload = {
    req_0: {
      module: 'music.search.SearchCgiService',
      method: 'DoSearchForQQMusicDesktop',
      param: { num_per_page: num, page_num: page, query: keyword, search_type: 0 },
    },
    comm: { g_tk: 5381, uin: 0, format: 'json', platform: 'h5' },
  };

  const { data } = await axios.get(url, {
    params: { data: JSON.stringify(payload) },
    headers: { ...COMMON_HEADERS, Referer: 'https://y.qq.com/' },
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
    cover: s.album?.mid
      ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${s.album.mid}.jpg`
      : '',
    duration: s.interval || 0,
    url: null,
  }));
}

// QQ 播放链接：多级 fallback，cookie 可选（登录后解锁 VIP）
async function getQQUrl(songmid, cookie = '') {
  const cookieHeader = cookie ? { Cookie: cookie } : {};
  // 从 cookie 中提取 uin 和 qqmusic_key
  let uin = '0';
  let key = '';
  if (cookie) {
    const uinMatch = cookie.match(/(?:^|;\s*)uin=o?(\d+)/i);
    if (uinMatch) uin = uinMatch[1];
    const keyMatch = cookie.match(/qqmusic_key=([^;]+)/i);
    if (keyMatch) key = keyMatch[1];
  }

  // 1. vkey.GetVkeyServer（传入登录用户 uin 解锁 VIP 歌曲）
  try {
    const url = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
    const payload = {
      req_0: {
        module: 'vkey.GetVkeyServer',
        method: 'CgiGetVkey',
        param: {
          guid: '0', songmid: [songmid], songtype: [0], uin, loginflag: key ? 1 : 0, platform: '20',
        },
      },
      comm: { uin: Number(uin) || 0, format: 'json', ct: 24, cv: 0 },
    };

    const { data } = await axios.get(url, {
      params: { data: JSON.stringify(payload) },
      headers: { ...COMMON_HEADERS, ...cookieHeader, Referer: 'https://y.qq.com/' },
      timeout: 10000,
    });

    const info = data?.req_0?.data?.midurlinfo?.[0];
    if (info?.purl) {
      const sip = data?.req_0?.data?.sip?.[0] || 'https://ws.stream.qqmusic.qq.com/';
      return `${sip}${info.purl}`;
    }
  } catch (e) {
    console.error('QQ vkey url error:', e.message);
  }

  // 2. fcg_music_express_mobile3 备用接口
  try {
    const url = 'https://c.y.qq.com/base/fcgi-bin/fcg_music_express_mobile3.fcg';
    const { data } = await axios.get(url, {
      params: {
        g_tk: 5381, loginUin: uin, hostUin: 0, format: 'json', inCharset: 'utf8',
        outCharset: 'utf-8', notice: 0, platform: 'yqq', needNewCode: 0,
        cid: 205361747, uin, songmid,
        filename: `C400${songmid}.m4a`, guid: 0,
      },
      headers: { ...COMMON_HEADERS, ...cookieHeader, Referer: 'https://y.qq.com/' },
      timeout: 10000,
    });
    const info = data?.data?.items?.[0];
    if (info?.vkey) {
      return `https://ws.stream.qqmusic.qq.com/${info.filename}?fromtag=0&guid=0&vkey=${info.vkey}`;
    }
  } catch (e) {
    console.error('QQ express url error:', e.message);
  }

  return '';
}

// QQ 歌词（base64 编码）
async function getQQLyric(songmid) {
  const url = 'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_yqq.fcg';
  const { data } = await axios.get(url, {
    params: {
      g_tk: 5381, loginUin: 0, hostUin: 0, format: 'json', inCharset: 'utf8',
      outCharset: 'utf-8', notice: 0, platform: 'yqq', needNewCode: 0,
      cid: 2026000668, songmid, callback: '',
    },
    headers: { ...COMMON_HEADERS, Referer: 'https://y.qq.com/' },
    timeout: 10000,
  });
  // 返回 { retcode, code, lyric: 'base64', trans: 'base64' }
  let lyric = '';
  if (data?.lyric) {
    lyric = Buffer.from(data.lyric, 'base64').toString('utf-8');
  }
  return lyric;
}

// QQ 歌单详情
async function getQQPlaylist(id) {
  return withCache(`qq_pl_${id}`, 120000, async () => {
    const url = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
    const payload = {
      req_0: {
        module: 'music.srfDissInfo.aiSvrGet',
        method: 'GetDissInfo',
        param: { disstid: Number(id), song_num: 100, song_begin: 0 },
      },
      comm: { uin: 0, format: 'json', ct: 24, cv: 0 },
    };
    const { data } = await axios.get(url, {
      params: { data: JSON.stringify(payload) },
      headers: { ...COMMON_HEADERS, Referer: 'https://y.qq.com/' },
      timeout: 15000,
    });
    const dirinfo = data?.req_0?.data?.dirinfo || {};
    const list = data?.req_0?.data?.songlist || [];
    return {
      name: dirinfo.title || '',
      cover: dirinfo.picurl || '',
      tracks: list.map((s) => ({
        id: `qq_${s.mid}`,
        rawId: s.mid,
        platform: 'qq',
        title: s.name || s.title || '',
        artist: (s.singer || []).map((a) => a.name).join(' / '),
        album: s.album?.name || '',
        cover: s.album?.mid
          ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${s.album.mid}.jpg`
          : '',
        duration: s.interval || 0,
        url: null,
      })),
    };
  });
}

// QQ 排行榜列表
async function getQQRankList() {
  return withCache('qq_rank_list', 600000, async () => {
    const url = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
    const payload = {
      req_0: {
        module: 'musicToplist.ToplistInfoServer',
        method: 'GetAll',
        param: {},
      },
      comm: { uin: 0, format: 'json', ct: 24, cv: 0 },
    };
    const { data } = await axios.get(url, {
      params: { data: JSON.stringify(payload) },
      headers: { ...COMMON_HEADERS, Referer: 'https://y.qq.com/' },
      timeout: 15000,
    });
    const list = data?.req_0?.data?.topList || [];
    return list.map((t) => ({
      id: String(t.topId),
      name: t.title || t.topName || '',
      cover: t.frontPicUrl || t.picUrl || '',
      description: t.intro || '',
      updateFrequency: t.updateTime || '',
    }));
  });
}

// QQ 某个榜单的歌曲
async function getQQRankSongs(topId) {
  return withCache(`qq_rank_${topId}`, 120000, async () => {
    const url = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
    const payload = {
      req_0: {
        module: 'musicToplist.ToplistInfoServer',
        method: 'GetDetail',
        param: { topid: Number(topId), offset: 0, num: 100 },
      },
      comm: { uin: 0, format: 'json', ct: 24, cv: 0 },
    };
    const { data } = await axios.get(url, {
      params: { data: JSON.stringify(payload) },
      headers: { ...COMMON_HEADERS, Referer: 'https://y.qq.com/' },
      timeout: 15000,
    });
    const info = data?.req_0?.data?.data || {};
    const list = info.songInfoList || [];
    return {
      name: info.title || info.topName || '',
      cover: info.frontPicUrl || info.picUrl || '',
      tracks: list.map((s) => {
        const song = s?.title ? s : (s?.song || s);
        return {
          id: `qq_${song.mid}`,
          rawId: song.mid,
          platform: 'qq',
          title: song.name || song.title || '',
          artist: (song.singer || []).map((a) => a.name).join(' / '),
          album: song.album?.name || '',
          cover: song.album?.mid
            ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${song.album.mid}.jpg`
            : '',
          duration: song.interval || 0,
          url: null,
        };
      }),
    };
  });
}

// ---------- 聚合搜索 ----------
router.get('/search', async (req, res) => {
  try {
    const { keyword, platforms = 'netease,qq', limit = 20 } = req.query;
    if (!keyword) return res.status(400).json({ error: 'keyword required' });

    const platformList = String(platforms).split(',').map((p) => p.trim());
    const jobs = [];

    if (platformList.includes('netease')) {
      jobs.push(
        searchNetease(keyword, Number(limit)).catch((err) => {
          console.error('Netease search error:', err.message);
          return [];
        })
      );
    }
    if (platformList.includes('qq')) {
      jobs.push(
        searchQQ(keyword, 1, Number(limit)).catch((err) => {
          console.error('QQ search error:', err.message);
          return [];
        })
      );
    }

    const results = await Promise.all(jobs);
    const allSongs = results.flat();

    res.json({
      code: 200,
      data: allSongs,
      total: allSongs.length,
      platforms: platformList,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- 获取播放链接 ----------
router.get('/url', async (req, res) => {
  try {
    const { id, platform, cookie = '' } = req.query;
    if (!id || !platform) return res.status(400).json({ error: 'id and platform required' });

    if (platform === 'netease') {
      const realUrl = await getNeteaseRealUrl(id, cookie);
      return res.json({ code: 200, data: { url: realUrl, platform } });
    }

    if (platform === 'qq') {
      const url = await getQQUrl(id, cookie);
      return res.json({ code: 200, data: { url, platform } });
    }

    res.status(400).json({ error: 'unsupported platform' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- 音频流代理（解决 CORS） ----------
router.get('/stream', async (req, res) => {
  try {
    const { id, platform, cookie = '' } = req.query;
    if (!id || !platform) return res.status(400).json({ error: 'id and platform required' });

    let targetUrl = '';
    if (platform === 'netease') {
      targetUrl = await getNeteaseRealUrl(id, cookie);
    } else if (platform === 'qq') {
      targetUrl = await getQQUrl(id, cookie);
    } else {
      return res.status(400).json({ error: 'unsupported platform' });
    }

    if (!targetUrl) {
      return res.status(404).json({ error: 'no audio url available' });
    }

    // 流式代理：转发 Range 请求以支持拖动进度条
    const range = req.headers.range;
    const upstreamHeaders = { ...COMMON_HEADERS };
    if (range) upstreamHeaders.Range = range;

    const upstream = await axios.get(targetUrl, {
      responseType: 'stream',
      headers: upstreamHeaders,
      timeout: 15000,
      maxRedirects: 5,
      validateStatus: () => true,
    });

    // 转发状态码和关键响应头
    res.status(upstream.status);
    const passHeaders = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control'];
    for (const h of passHeaders) {
      if (upstream.headers[h]) res.setHeader(h, upstream.headers[h]);
    }
    res.setHeader('Access-Control-Allow-Origin', '*');

    upstream.data.pipe(res);
    req.on('close', () => upstream.data.destroy());
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

// ---------- 封面图代理（解决 CORS，供 3D 粒子采样） ----------
router.get('/cover', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'url required' });
    // 仅允许 http(s)
    if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'invalid url' });

    const upstream = await axios.get(url, {
      responseType: 'stream',
      headers: COMMON_HEADERS,
      timeout: 10000,
      maxRedirects: 5,
      validateStatus: () => true,
    });

    res.status(upstream.status);
    const passHeaders = ['content-type', 'content-length', 'cache-control'];
    for (const h of passHeaders) {
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

// ---------- 获取歌词 ----------
router.get('/lyric', async (req, res) => {
  try {
    const { id, platform } = req.query;
    if (!id || !platform) return res.status(400).json({ error: 'id and platform required' });

    if (platform === 'netease') {
      const lyric = await getNeteaseLyric(id);
      return res.json({ code: 200, data: { lyric, platform } });
    }

    if (platform === 'qq') {
      const lyric = await getQQLyric(id);
      return res.json({ code: 200, data: { lyric, platform } });
    }

    res.json({ code: 200, data: { lyric: '', platform } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- 获取歌单详情 ----------
router.get('/playlist', async (req, res) => {
  try {
    const { id, platform } = req.query;
    if (!id || !platform) return res.status(400).json({ error: 'id and platform required' });

    if (platform === 'netease') {
      const detail = await getNeteasePlaylist(id);
      return res.json({ code: 200, data: detail });
    }

    if (platform === 'qq') {
      const detail = await getQQPlaylist(id);
      return res.json({ code: 200, data: detail });
    }

    res.status(400).json({ error: 'unsupported platform' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- 获取排行榜列表 ----------
router.get('/rank', async (req, res) => {
  try {
    const { platform } = req.query;
    if (platform === 'netease') {
      const list = await getNeteaseRankList();
      return res.json({ code: 200, data: { platform, list } });
    }
    if (platform === 'qq') {
      const list = await getQQRankList();
      return res.json({ code: 200, data: { platform, list } });
    }
    // 默认返回两个平台榜单合并
    const [netease, qq] = await Promise.all([
      getNeteaseRankList().catch(() => []),
      getQQRankList().catch(() => []),
    ]);
    res.json({ code: 200, data: { netease, qq } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- 获取榜单歌曲 ----------
router.get('/rank/songs', async (req, res) => {
  try {
    const { id, platform } = req.query;
    if (!id || !platform) return res.status(400).json({ error: 'id and platform required' });

    if (platform === 'netease') {
      const detail = await getNeteaseRankSongs(id);
      return res.json({ code: 200, data: detail });
    }
    if (platform === 'qq') {
      const detail = await getQQRankSongs(id);
      return res.json({ code: 200, data: detail });
    }
    res.status(400).json({ error: 'unsupported platform' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- 扫码登录：网易云 ----------
// 1. 生成 unikey
router.get('/login/netease/unikey', async (req, res) => {
  try {
    const unikey = await neteaseQrUnikey();
    res.json({ code: 200, data: { unikey } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. 生成二维码图片
router.get('/login/netease/qrcode', async (req, res) => {
  try {
    const { unikey } = req.query;
    if (!unikey) return res.status(400).json({ error: 'unikey required' });
    const data = await neteaseQrCreate(unikey);
    res.json({ code: 200, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. 轮询登录状态
router.get('/login/netease/check', async (req, res) => {
  try {
    const { unikey } = req.query;
    if (!unikey) return res.status(400).json({ error: 'unikey required' });
    const result = await neteaseQrCheck(unikey);
    res.json({ code: 200, data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 网易云用户歌单
router.get('/user/netease/playlists', async (req, res) => {
  try {
    const { cookie, uid } = req.query;
    if (!cookie || !uid) return res.status(400).json({ error: 'cookie and uid required' });
    const list = await neteaseUserPlaylists(cookie, uid);
    res.json({ code: 200, data: { list } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- 扫码登录：QQ 音乐 ----------
// 1+2. 生成二维码图片 + qrsig
router.get('/login/qq/qrcode', async (req, res) => {
  try {
    const data = await qqQrCreate();
    res.json({ code: 200, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. 轮询登录状态
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

// QQ 用户歌单
router.get('/user/qq/playlists', async (req, res) => {
  try {
    const { uin, key } = req.query;
    if (!uin || !key) return res.status(400).json({ error: 'uin and key required' });
    const list = await qqUserPlaylists(uin, key);
    res.json({ code: 200, data: { list } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- 同步我喜欢 ----------
// 网易云：取用户歌单第一个（我喜欢的音乐）的完整歌曲
router.get('/user/netease/likedsongs', async (req, res) => {
  try {
    const { cookie, uid } = req.query;
    if (!cookie || !uid) return res.status(400).json({ error: 'cookie and uid required' });
    // 第一个歌单即"我喜欢的音乐"
    const list = await neteaseUserPlaylists(cookie, uid);
    if (!list.length) return res.json({ code: 200, data: { tracks: [], name: '我喜欢的音乐' } });
    const likedId = list[0].id;
    const detail = await getNeteasePlaylist(likedId);
    res.json({ code: 200, data: { tracks: detail.tracks, name: detail.name, cover: detail.cover } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// QQ 音乐：取用户歌单第一个（我喜欢）的完整歌曲
router.get('/user/qq/likedsongs', async (req, res) => {
  try {
    const { uin, key } = req.query;
    if (!uin || !key) return res.status(400).json({ error: 'uin and key required' });
    const list = await qqUserPlaylists(uin, key);
    if (!list.length) return res.json({ code: 200, data: { tracks: [], name: '我喜欢' } });
    const likedId = list[0].id;
    const detail = await getQQPlaylist(likedId);
    res.json({ code: 200, data: { tracks: detail.tracks, name: detail.name, cover: detail.cover } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
