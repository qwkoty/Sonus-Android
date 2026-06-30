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
    url: null, // 播放时再去获取直链
  }));
}

function getNeteaseUrl(id) {
  // 网易云的公开直链接口，会 302 跳转到实际音频地址
  return `https://music.163.com/song/media/outer/url?id=${id}.mp3`;
}

// ---------- 酷狗音乐 ----------
async function searchKugou(keyword, page = 1, pagesize = 20) {
  const url = 'https://mobilecdn.kugou.com/api/v3/search/song';
  const { data } = await axios.get(url, {
    params: {
      format: 'json',
      keyword,
      page,
      pagesize,
      showtype: 1,
    },
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    },
    timeout: 15000,
  });

  const songs = data?.data?.info || [];
  return songs.map((s) => ({
    id: `kugou_${s.hash || s.sqhash || s.songname}`,
    rawId: s.hash || s.sqhash || '',
    platform: 'kugou',
    title: s.songname || '',
    artist: s.singername || '',
    album: s.album_name || '',
    cover: s.img || '',
    duration: 0,
    url: null,
  }));
}

// ---------- 聚合搜索 ----------
router.get('/search', async (req, res) => {
  try {
    const { keyword, platforms = 'netease,kugou', limit = 20 } = req.query;
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
    if (platformList.includes('kugou')) {
      jobs.push(
        searchKugou(keyword, 1, Number(limit)).catch((err) => {
          console.error('Kugou search error:', err.message);
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
      // 跟随 302 获取真实地址
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
        // 如果 head 失败，直接返回重定向链接让前端自己处理
        return res.json({ code: 200, data: { url: redirectUrl, platform } });
      }
    }

    if (platform === 'kugou') {
      // 酷狗通过 hash 获取播放链接
      const ts = Date.now();
      const apiUrl = 'https://wwwapi.kugou.com/yy/index.php';
      const { data } = await axios.get(apiUrl, {
        params: {
          r: 'play/getdata',
          hash: id,
          dfid: '',
          mid: '',
          platid: 4,
          _: ts,
        },
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15',
          Referer: 'https://www.kugou.com/',
        },
        timeout: 10000,
      });
      const url = data?.data?.play_url || '';
      return res.json({ code: 200, data: { url, platform } });
    }

    res.status(400).json({ error: 'unsupported platform' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
