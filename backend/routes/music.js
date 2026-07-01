const express = require('express');
const axios = require('axios');
const router = express.Router();

// 伪装国内 IP，部分平台对海外 IP 有限制
const FAKE_IP = '223.5.5.5';
const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'X-Real-IP': FAKE_IP,
  'X-Forwarded-For': FAKE_IP,
};

// 简单内存缓存，避免高频请求触发风控
const cache = new Map();
function withCache(key, ttl, fn) {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.t < ttl) return Promise.resolve(hit.v);
  return fn().then((v) => { cache.set(key, { v, t: now }); return v; });
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

// 网易云播放链接：多级 fallback
async function getNeteaseRealUrl(id) {
  // 1. 标准 enhance/player/url，提升到 320k
  try {
    const url = 'https://music.163.com/api/song/enhance/player/url';
    const { data } = await axios.post(url, `ids=[${id}]&br=320000`, {
      headers: {
        ...COMMON_HEADERS,
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
      headers: COMMON_HEADERS,
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

// QQ 播放链接：多级 fallback
async function getQQUrl(songmid) {
  // 1. vkey.GetVkeyServer
  try {
    const url = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
    const payload = {
      req_0: {
        module: 'vkey.GetVkeyServer',
        method: 'CgiGetVkey',
        param: {
          guid: '0', songmid: [songmid], songtype: [0], uin: '0', loginflag: 1, platform: '20',
        },
      },
      comm: { uin: 0, format: 'json', ct: 24, cv: 0 },
    };

    const { data } = await axios.get(url, {
      params: { data: JSON.stringify(payload) },
      headers: { ...COMMON_HEADERS, Referer: 'https://y.qq.com/' },
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
        g_tk: 5381, loginUin: 0, hostUin: 0, format: 'json', inCharset: 'utf8',
        outCharset: 'utf-8', notice: 0, platform: 'yqq', needNewCode: 0,
        cid: 205361747, uin: 0, songmid,
        filename: `C400${songmid}.m4a`, guid: 0,
      },
      headers: { ...COMMON_HEADERS, Referer: 'https://y.qq.com/' },
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
    const { id, platform } = req.query;
    if (!id || !platform) return res.status(400).json({ error: 'id and platform required' });

    if (platform === 'netease') {
      const realUrl = await getNeteaseRealUrl(id);
      return res.json({ code: 200, data: { url: realUrl, platform } });
    }

    if (platform === 'qq') {
      const url = await getQQUrl(id);
      return res.json({ code: 200, data: { url, platform } });
    }

    res.status(400).json({ error: 'unsupported platform' });
  } catch (err) {
    res.status(500).json({ error: err.message });
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

module.exports = router;
