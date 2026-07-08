const crypto = require('crypto');
const axios = require('axios');
const QRCode = require('qrcode');
const express = require('express');
const router = express.Router();

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const REFERER = 'https://music.163.com/';
const WEAPI_BASE = 'https://music.163.com';

// ==================== 网易云 weapi 加密 ====================
// 常量（公开，与社区实现一致）。AES-128-CBC 两次 + RSA(encSecKey)。
const NONCE = '0CoJUm6Qyw8W8jud'; // 第一次加密固定密钥
const IV = '0102030405060708';
const PUBKEY = '010001';
const MODULUS =
  '00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7';
const RANDOM_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function randomKey(size = 16) {
  let k = '';
  for (let i = 0; i < size; i++) k += RANDOM_CHARS.charAt(Math.floor(Math.random() * RANDOM_CHARS.length));
  return k;
}

function aesCbc(text, key) {
  const cipher = crypto.createCipheriv('aes-128-cbc', Buffer.from(key, 'utf8'), Buffer.from(IV, 'utf8'));
  return cipher.update(text, 'utf8', 'hex') + cipher.final('hex');
}

function rsaEncrypt(secKey) {
  // 与社区实现一致：反转 secKey 字符串，按字节作为大整数做 RSA，结果 hex 左补 0 至 256
  const reversed = [...secKey].reverse().join('');
  const bi = BigInt('0x' + Buffer.from(reversed, 'utf8').toString('hex'));
  const enc = bi ** BigInt('0x' + PUBKEY) % BigInt('0x' + MODULUS);
  let hex = enc.toString(16);
  while (hex.length < 256) hex = '0' + hex;
  return hex;
}

function weapi(payload) {
  const text = JSON.stringify(payload);
  const encText = aesCbc(aesCbc(text, NONCE), (() => randomKey())());
  const secKey = randomKey();
  const params = aesCbc(aesCbc(text, NONCE), secKey);
  const encSecKey = rsaEncrypt(secKey);
  return { params, encSecKey };
}

function parseSetCookie(headers) {
  const out = {};
  const arr = headers?.['set-cookie'];
  if (!arr) return out;
  for (const h of arr) {
    const pair = h.split(';')[0];
    const eq = pair.indexOf('=');
    if (eq > 0) out[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return out;
}
function cookieToString(cookies) {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

// 通用 weapi 请求：POST application/x-www-form-urlencoded，body = params&encSecKey
async function weapiRequest(endpoint, payload, cookie = '') {
  const { params, encSecKey } = weapi(payload);
  const headers = {
    'User-Agent': UA,
    Referer: REFERER,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (cookie) headers.Cookie = cookie;
  const { data, headers: respHeaders } = await axios.post(
    `${WEAPI_BASE}${endpoint}`,
    `params=${encodeURIComponent(params)}&encSecKey=${encodeURIComponent(encSecKey)}`,
    { headers, timeout: 12000, maxRedirects: 5, validateStatus: () => true },
  );
  return { data, setCookie: parseSetCookie(respHeaders) };
}

// ==================== 网易云扫码登录 ====================

// 取二维码：weapi 拿 unikey，用 qrcode 包生成登录页二维码（扫码用手机网易云 App 确认）
async function neQrCreate() {
  const { data } = await weapiRequest('/weapi/login/qrcode/unikey', { type: 1 });
  const unikey = data?.unikey;
  if (!unikey) throw new Error('获取网易云二维码密钥失败');
  const qrUrl = `https://music.163.com/login?qrimg=${encodeURIComponent(unikey)}`;
  const qrcode = await QRCode.toDataURL(qrUrl);
  return { unikey, qrcode };
}

// 轮询扫码状态：800=等待 / 801=已扫待确认 / 802=已授权 / 803=过期
// 802 时从 set-cookie 收集 MUSIC_U 等，并拉取账号信息
async function neQrPoll(unikey) {
  const { data, setCookie } = await weapiRequest('/weapi/login/qrcode/poll', { key: unikey, type: 1 });
  const code = data?.code;
  if (code === 802) {
    const jar = { ...setCookie };
    const cookie = cookieToString(jar);
    let uid = '', nickname = '网易云用户', avatar = '';
    try {
      const acc = await weapiRequest('/weapi/w/nuser/account/get', {}, cookie);
      uid = String(acc.data?.account?.id || acc.data?.profile?.userId || '');
      nickname = acc.data?.profile?.nickname || '网易云用户';
      avatar = acc.data?.profile?.avatarUrl || '';
    } catch (e) {}
    return { code: 0, status: 'confirmed', cookie, uid, nickname, avatar };
  }
  if (code === 800) return { code: 800, status: 'waiting' };
  if (code === 801) return { code: 801, status: 'scanned' };
  if (code === 803) return { code: 803, status: 'expired' };
  return { code: code || 0, status: 'expired' };
}

// ==================== 网易云用户信息 ====================

async function neUserInfo(cookie) {
  if (!cookie) return { uid: '', nickname: '网易云用户', avatar: '' };
  try {
    const { data } = await weapiRequest('/weapi/w/nuser/account/get', {}, cookie);
    return {
      uid: String(data?.account?.id || ''),
      nickname: data?.profile?.nickname || '网易云用户',
      avatar: data?.profile?.avatarUrl || '',
    };
  } catch (e) {
    return { uid: '', nickname: '网易云用户', avatar: '' };
  }
}

// ==================== 网易云搜索 ====================

async function neSearch(keyword, limit = 20) {
  const { data } = await weapiRequest('/weapi/search/get', { s: keyword, type: 1, limit, offset: 0 });
  const list = data?.result?.songs || [];
  return list.map((s) => ({
    id: `ne_${s.id}`,
    rawId: String(s.id),
    platform: 'netease',
    title: s.name || '',
    artist: (s.artists || s.ar || []).map((a) => a.name).join(' / ') || '未知歌手',
    album: s.album?.name || s.al?.name || '',
    cover: s.album?.picUrl || s.al?.picUrl || '',
    duration: Math.round((s.duration || s.dt || 0) / 1000),
  }));
}

// ==================== 网易云播放链接 ====================

async function neUrl(id) {
  const rawId = String(id).replace(/^ne_/, '');
  try {
    const { data } = await weapiRequest('/weapi/song/enhance/player/url', { ids: [Number(rawId)], br: 320000 });
    const item = data?.data?.[0];
    if (item?.url) return item.url;
  } catch (e) {}
  return '';
}

// ==================== 网易云歌词 ====================

async function neLyric(id) {
  const rawId = String(id).replace(/^ne_/, '');
  try {
    const { data } = await weapiRequest('/weapi/song/lyric', { id: Number(rawId), lv: -1, kv: -1 });
    const lyric = data?.lrc?.lyric || '';
    const tlyric = data?.tlyric?.lyric || '';
    return { lyric, tlyric };
  } catch (e) {
    return { lyric: '', tlyric: '' };
  }
}

// ==================== 网易云歌单 ====================

async function nePlaylist(id) {
  const rawId = String(id).replace(/^ne_/, '');
  const { data } = await weapiRequest('/weapi/v3/playlist/detail', { id: Number(rawId), n: 1000, s: 8 });
  const info = data?.playlist;
  const tracks = info?.tracks || [];
  return {
    name: info?.name || '歌单',
    cover: info?.coverImgUrl || '',
    tracks: tracks.map((s) => ({
      id: `ne_${s.id}`,
      rawId: String(s.id),
      platform: 'netease',
      title: s.name || '',
      artist: (s.ar || []).map((a) => a.name).join(' / ') || '未知歌手',
      album: s.al?.name || '',
      cover: s.al?.picUrl || '',
      duration: Math.round((s.dt || 0) / 1000),
    })),
  };
}

async function neUserPlaylists(cookie, uid) {
  if (!cookie || !uid) return [];
  try {
    const { data } = await weapiRequest('/weapi/user/playlist', { uid: String(uid), limit: 100, offset: 0 }, cookie);
    const list = data?.playlist || [];
    return list.map((p) => ({
      id: String(p.id),
      name: p.name || '歌单',
      cover: p.coverImgUrl || '',
      songCount: p.trackCount || 0,
    }));
  } catch (e) {
    return [];
  }
}

// ==================== 路由 ====================

// 扫码登录：取二维码
router.get('/login/netease/qrcode', async (req, res) => {
  try {
    const data = await neQrCreate();
    res.json({ code: 200, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 扫码登录：轮询状态
router.get('/login/netease/poll', async (req, res) => {
  try {
    const { key } = req.query;
    if (!key) return res.status(400).json({ error: 'key required' });
    const data = await neQrPoll(key);
    res.json({ code: 200, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 用户信息
router.get('/user/netease/info', async (req, res) => {
  try {
    const { cookie } = req.query;
    const info = await neUserInfo(cookie || '');
    res.json({ code: 200, data: info });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 用户歌单
router.get('/user/netease/playlists', async (req, res) => {
  try {
    const { cookie, uid } = req.query;
    const list = await neUserPlaylists(cookie || '', uid || '');
    res.json({ code: 200, data: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = {
  router,
  neSearch,
  neUrl,
  neLyric,
  nePlaylist,
  neUserInfo,
  neUserPlaylists,
  neQrCreate,
  neQrPoll,
};
