const BASE = import.meta.env.VITE_API_BASE || '';

async function get(path, timeout = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`${BASE}${path}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export const music = {
  search: (keyword, platforms = 'netease,qq', limit = 20) =>
    get(`/api/music/search?keyword=${encodeURIComponent(keyword)}&platforms=${platforms}&limit=${limit}`),
  url: (id, platform) =>
    get(`/api/music/url?id=${encodeURIComponent(id)}&platform=${encodeURIComponent(platform)}`),
  stream: (id, platform) =>
    `${BASE}/api/music/stream?id=${encodeURIComponent(id)}&platform=${encodeURIComponent(platform)}`,
  cover: (url) =>
    `${BASE}/api/music/cover?url=${encodeURIComponent(url)}`,
  lyric: (id, platform) =>
    get(`/api/music/lyric?id=${encodeURIComponent(id)}&platform=${encodeURIComponent(platform)}`),
  rank: (platform) =>
    get(`/api/music/rank${platform ? `?platform=${platform}` : ''}`),
  rankSongs: (id, platform) =>
    get(`/api/music/rank/songs?id=${encodeURIComponent(id)}&platform=${encodeURIComponent(platform)}`),
};
