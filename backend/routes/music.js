const axios = require('axios');
const express = require('express');
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

// ==================== 网易云音乐 ====================

async function searchNetease(keyword, limit = 20) {
  const url = 'https://music.163.com/api/search/get/web';
  const { data } = await axios.post(url, `s=${encodeURIComponent(keyword)}&type=1&offset=0&limit=${limit}`, {
    headers: { ...COMMON_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://music.163.com/' },
    timeout: 15000,
  });
  const list = data?.result?.songs || [];
  return list.map((s) => ({
    id: `ne_${s.id}`,
    rawId: String(s.id),
    platform: 'netease',
    title: s.name || '',
    artist: (s.artists || []).map((a) => a.name).join(' / '),
    album: s.album?.name || '',
    cover: s.album?.artist?.img1v1Url || '',
    duration: (s.duration || 0) / 1000,
    url: null,
  }));
}

async function getNeteaseLyric(id) {
  const rawId = String(id).replace(/^ne_/, '');
  const { data } = await axios.get(`https://music.163.com/api/song/lyric`, {
    params: { id: rawId, lv: 1, kv: 1, tv: -1 },
    headers: { ...COMMON_HEADERS, Referer: 'https://music.163.com/' },
    timeout: 10000,
  });
  return data?.lrc?.lyric || '';
}

async function getNeteaseRealUrl(id) {
  const rawId = String(id).replace(/^ne_/, '');
  try {
    const { data } = await axios.get(`https://music.163.com/api/song/enhance/player/url`, {
      params: { ids: `[${rawId}]`, br: 320000 },
      headers: { ...COMMON_HEADERS, Referer: 'https://music.163.com/' },
      timeout: 10000,
    });
    const url = data?.data?.[0]?.url;
    if (url) return url;
  } catch (e) {}
  // fallback: outer/url 302
  try {
    const resp = await axios.get(`https://music.163.com/song/media/outer/url?id=${rawId}.mp3`, {
      headers: COMMON_HEADERS, timeout: 10000, maxRedirects: 0, validateStatus: () => true,
    });
    if (resp.headers?.location) return resp.headers.location;
  } catch (e) {}
  return '';
}

async function getNeteaseRankList() {
  return withCache('ne_rank', 600000, async () => {
    const ids = [19723756, 3778678, 2884035, 3779629, 991319590];
    const results = [];
    for (const id of ids) {
      try {
        const { data } = await axios.get(`https://music.163.com/api/playlist/detail`, {
          params: { id },
          headers: { ...COMMON_HEADERS, Referer: 'https://music.163.com/' },
          timeout: 10000,
        });
        if (data?.result?.tracks?.length) {
          results.push({
            id: `ne_rank_${id}`,
            name: data.result.name || '排行榜',
            cover: data.result.coverImgUrl || '',
            platform: 'netease',
          });
        }
      } catch (e) {}
    }
    return results;
  });
}

async function getNeteaseRankSongs(id) {
  const rawId = String(id).replace(/^ne_rank_/, '');
  return withCache(`ne_rank_songs_${rawId}`, 120000, async () => {
    const { data } = await axios.get(`https://music.163.com/api/playlist/detail`, {
      params: { id: rawId },
      headers: { ...COMMON_HEADERS, Referer: 'https://music.163.com/' },
      timeout: 10000,
    });
    const tracks = data?.result?.tracks || [];
    return {
      name: data?.result?.name || '排行榜',
      cover: data?.result?.coverImgUrl || '',
      tracks: tracks.map((s) => ({
        id: `ne_${s.id}`,
        rawId: String(s.id),
        platform: 'netease',
        title: s.name || '',
        artist: (s.artists || []).map((a) => a.name).join(' / '),
        album: s.album?.name || '',
        cover: s.album?.picUrl || '',
        duration: (s.duration || 0) / 1000,
        url: null,
      })),
    };
  });
}

// ==================== QQ 音乐 ====================

async function searchQQ(keyword, page = 1, num = 20) {
  const url = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
  const payload = {
    req_0: {
      module: 'music.search.SearchCgiService',
      method: 'DoSearchForQQMusicDesktop',
      param: { num_per_page: num, page_num: page, query: keyword, search_type: 0 },
    },
    comm: { g_tk: 5381, uin: 0, format: 'json', ct: 24, cv: 0, platform: 'h5' },
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
    cover: s.album?.mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${s.album.mid}.jpg` : '',
    duration: s.interval || 0,
    url: null,
  }));
}

async function getQQLyric(songmid) {
  const rawId = String(songmid).replace(/^qq_/, '');
  const url = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
  const payload = {
    req_0: { module: 'music.musichallSong.PlayLyricInfo', method: 'GetPlayLyricInfo', param: { songMID: rawId } },
    comm: { uin: 0, format: 'json', ct: 24, cv: 0 },
  };
  const { data } = await axios.get(url, {
    params: { data: JSON.stringify(payload) },
    headers: { ...COMMON_HEADERS, Referer: 'https://y.qq.com/' },
    timeout: 10000,
  });
  const b64 = data?.req_0?.data?.lyric;
  if (!b64) return '';
  return Buffer.from(b64, 'base64').toString('utf-8');
}

async function getQQUrl(songmid) {
  const rawId = String(songmid).replace(/^qq_/, '');
  // 1. vkey.GetVkeyServer
  try {
    const url = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
    const payload = {
      req_0: {
        module: 'music.vkey.GetVkeyServer',
        method: 'CgiGetVkey',
        param: { guid: '10000', songmid: rawId, songtype: 0, uin: '0', loginflag: 0, platform: '23', h5to: 'speed' },
      },
      comm: { uin: '0', format: 'json', ct: 24, cv: 0 },
    };
    const { data } = await axios.get(url, {
      params: { data: JSON.stringify(payload) },
      headers: { ...COMMON_HEADERS, Referer: 'https://y.qq.com/' },
      timeout: 10000,
    });
    const item = data?.req_0?.data?.midurlinfo?.[0];
    const sip = data?.req_0?.data?.sip?.[0];
    if (item?.purl && sip) return sip + item.purl;
  } catch (e) {}
  // 2. fcg_music_express_mobile3
  try {
    const { data } = await axios.get('https://c.y.qq.com/base/fcgi-bin/fcg_music_express_mobile3.fcg', {
      params: { format: 'json205361747', songmid: rawId, guid: '10000', uin: '0', platform: 'yqq', cid: '205361747' },
      headers: { ...COMMON_HEADERS, Referer: 'https://y.qq.com/' },
      timeout: 10000,
    });
    const item = data?.data?.items?.[0];
    if (item?.url) return item.url;
    if (item?.filename) return `https://dl.stream.qqmusic.qq.com/${item.filename}`;
  } catch (e) {}
  return '';
}

async function getQQRankList() {
  return withCache('qq_rank', 600000, async () => {
    const url = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
    const payload = {
      req_0: { module: 'musicToplist.ToplistInfoServer', method: 'GetAll', param: {} },
      comm: { uin: 0, format: 'json', ct: 24, cv: 0 },
    };
    const { data } = await axios.get(url, {
      params: { data: JSON.stringify(payload) },
      headers: { ...COMMON_HEADERS, Referer: 'https://y.qq.com/' },
      timeout: 10000,
    });
    const groups = data?.req_0?.data?.group || [];
    const results = [];
    for (const g of groups) {
      for (const t of (g.toplist || [])) {
        results.push({
          id: `qq_rank_${t.topId}`,
          name: t.title || t.titleZh || '排行榜',
          cover: t.frontPicUrl || t.picUrl || '',
          platform: 'qq',
        });
      }
    }
    return results.slice(0, 20);
  });
}

async function getQQRankSongs(topId) {
  const rawId = String(topId).replace(/^qq_rank_/, '');
  return withCache(`qq_rank_songs_${rawId}`, 120000, async () => {
    const url = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
    const payload = {
      req_0: {
        module: 'musicToplist.ToplistInfoServer',
        method: 'GetDetail',
        param: { topId: Number(rawId), offset: 0, num: 100, period: '2023-01-01' },
      },
      comm: { uin: 0, format: 'json', ct: 24, cv: 0 },
    };
    const { data } = await axios.get(url, {
      params: { data: JSON.stringify(payload) },
      headers: { ...COMMON_HEADERS, Referer: 'https://y.qq.com/' },
      timeout: 10000,
    });
    const info = data?.req_0?.data;
    const songs = info?.songInfoList || [];
    return {
      name: info?.title || '排行榜',
      cover: info?.frontPicUrl || info?.picUrl || '',
      tracks: songs.map((s) => ({
        id: `qq_${s.mid}`,
        rawId: s.mid,
        platform: 'qq',
        title: s.name || s.title || '',
        artist: (s.singer || []).map((a) => a.name).join(' / '),
        album: s.album?.name || '',
        cover: s.album?.mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${s.album.mid}.jpg` : '',
        duration: s.interval || 0,
        url: null,
      })),
    };
  });
}

// ==================== 路由 ====================

// 搜索（不合并，按平台分组返回）
router.get('/search', async (req, res) => {
  try {
    const { keyword, platforms = 'netease,qq', limit = 20 } = req.query;
    if (!keyword) return res.status(400).json({ error: 'keyword required' });
    const platformList = String(platforms).split(',').map((p) => p.trim());
    const groups = {};
    const tasks = [];
    if (platformList.includes('netease')) {
      tasks.push(searchNetease(keyword, Number(limit)).then((r) => { groups.netease = r; }).catch((e) => { console.error('Netease search:', e.message); groups.netease = []; }));
    }
    if (platformList.includes('qq')) {
      tasks.push(searchQQ(keyword, 1, Number(limit)).then((r) => { groups.qq = r; }).catch((e) => { console.error('QQ search:', e.message); groups.qq = []; }));
    }
    await Promise.all(tasks);
    res.json({ code: 200, data: groups });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取播放链接
router.get('/url', async (req, res) => {
  try {
    const { id, platform } = req.query;
    if (!id || !platform) return res.status(400).json({ error: 'id and platform required' });
    if (platform === 'netease') {
      return res.json({ code: 200, data: { url: await getNeteaseRealUrl(id), platform } });
    }
    if (platform === 'qq') {
      return res.json({ code: 200, data: { url: await getQQUrl(id), platform } });
    }
    res.status(400).json({ error: 'unsupported platform' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 音频流代理
router.get('/stream', async (req, res) => {
  try {
    const { id, platform } = req.query;
    if (!id || !platform) return res.status(400).json({ error: 'id and platform required' });
    let targetUrl = '';
    if (platform === 'netease') targetUrl = await getNeteaseRealUrl(id);
    else if (platform === 'qq') targetUrl = await getQQUrl(id);
    else return res.status(400).json({ error: 'unsupported platform' });
    if (!targetUrl) return res.status(404).json({ error: 'no audio url' });

    const upstreamHeaders = { ...COMMON_HEADERS };
    if (req.headers.range) upstreamHeaders.Range = req.headers.range;
    const upstream = await axios.get(targetUrl, { responseType: 'stream', headers: upstreamHeaders, timeout: 15000, maxRedirects: 5, validateStatus: () => true });
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
    const upstream = await axios.get(url, { responseType: 'stream', headers: COMMON_HEADERS, timeout: 10000, maxRedirects: 5, validateStatus: () => true });
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
    const { id, platform } = req.query;
    if (!id || !platform) return res.status(400).json({ error: 'id and platform required' });
    if (platform === 'netease') return res.json({ code: 200, data: { lyric: await getNeteaseLyric(id), platform } });
    if (platform === 'qq') return res.json({ code: 200, data: { lyric: await getQQLyric(id), platform } });
    res.json({ code: 200, data: { lyric: '', platform } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 排行榜列表
router.get('/rank', async (req, res) => {
  try {
    const { platform } = req.query;
    if (platform === 'netease') return res.json({ code: 200, data: { platform, list: await getNeteaseRankList() } });
    if (platform === 'qq') return res.json({ code: 200, data: { platform, list: await getQQRankList() } });
    const [netease, qq] = await Promise.all([getNeteaseRankList().catch(() => []), getQQRankList().catch(() => [])]);
    res.json({ code: 200, data: { netease, qq } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 榜单歌曲
router.get('/rank/songs', async (req, res) => {
  try {
    const { id, platform } = req.query;
    if (!id || !platform) return res.status(400).json({ error: 'id and platform required' });
    if (platform === 'netease') return res.json({ code: 200, data: await getNeteaseRankSongs(id) });
    if (platform === 'qq') return res.json({ code: 200, data: await getQQRankSongs(id) });
    res.status(400).json({ error: 'unsupported platform' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
