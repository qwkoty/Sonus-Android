const express = require('express');
const axios = require('axios');
const router = express.Router();

// ---------- 网易云音乐 ----------
async function searchNetease(keyword, limit = 20) {
  const url = 'https://music.163.com/api/search/get/web';
  const { data } = await axios.get(url, {
    params: {
      csrf_token: '',
      s: keyword,
      type: 1,
      offset: 0,
      total: true,
      limit,
    },
    headers: {
      Referer: 'https://music.163.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
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
    cover: s.album?.picUrl ? s.album.picUrl + '?param=300x300' : '',
    duration: Math.floor((s.duration || 0) / 1000),
    url: null,
  }));
}

function getNeteaseUrl(id) {
  return `https://music.163.com/song/media/outer/url?id=${id}.mp3`;
}

// ---------- QQ 音乐（非官方接口） ----------
async function searchQQ(keyword, page = 1, num = 20) {
  const url = 'https://c.y.qq.com/soso/fcgi-bin/client_search_cp';
  const { data } = await axios.get(url, {
    params: {
      ct: 24,
      qqmusic_ver: 1298,
      new_json: 1,
      remoteplace: 'txt.yqq.song',
      t: 0,
      aggr: 1,
      cr: 1,
      catZhida: 1,
      lossless: 0,
      flag_qc: 0,
      p: page,
      n: num,
      w: keyword,
    },
    headers: {
      Referer: 'https://y.qq.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    timeout: 15000,
  });

  // JSONP 解析: callback({...})
  const match = String(data).match(/callback\((.*)\)$/s);
  const json = match ? JSON.parse(match[1]) : {};
  const list = json?.data?.song?.list || [];

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

async function getQQUrl(songmid) {
  const url = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
  const payload = {
    req_0: {
      module: 'vkey.GetVkeyServer',
      method: 'CgiGetVkey',
      param: {
        guid: '0',
        songmid: [songmid],
        songtype: [0],
        uin: '0',
        loginflag: 1,
        platform: '20',
      },
    },
    comm: { uin: 0, format: 'json', ct: 24, cv: 0 },
  };

  const { data } = await axios.get(url, {
    params: { data: JSON.stringify(payload) },
    headers: {
      Referer: 'https://y.qq.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    timeout: 10000,
  });

  const info = data?.req_0?.data?.midurlinfo?.[0];
  if (info?.purl) {
    const sip = data?.req_0?.data?.sip?.[0] || 'https://ws.stream.qqmusic.qq.com/';
    return `${sip}${info.purl}`;
  }
  return '';
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
      const redirectUrl = getNeteaseUrl(id);
      try {
        const headRes = await axios.head(redirectUrl, {
          maxRedirects: 5,
          timeout: 10000,
          headers: {
            Referer: 'https://music.163.com/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        });
        const finalUrl = headRes.request?.res?.responseUrl || headRes.headers?.location || redirectUrl;
        return res.json({ code: 200, data: { url: finalUrl, platform } });
      } catch {
        return res.json({ code: 200, data: { url: redirectUrl, platform } });
      }
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

module.exports = router;
