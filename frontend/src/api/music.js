const BASE = import.meta.env.VITE_API_BASE || '';

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export const music = {
  search: (keyword, platforms = 'netease,qq', limit = 20) =>
    get(`/api/music/search?keyword=${encodeURIComponent(keyword)}&platforms=${platforms}&limit=${limit}`),
  url: (id, platform) =>
    get(`/api/music/url?id=${encodeURIComponent(id)}&platform=${encodeURIComponent(platform)}`),
};
