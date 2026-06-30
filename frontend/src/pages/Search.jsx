import { useState } from 'react';
import { Search as SearchIcon, X, TrendingUp, Music } from 'lucide-react';
import { usePlayerStore } from '../store/usePlayerStore';
import { music } from '../api/music';
import SongItem from '../components/SongItem';

const hotTags = ['周杰伦', '林俊杰', '陈奕迅', 'Taylor Swift', '告五人', '周杰伦', '薛之谦', '邓紫棋'];

function formatPlatform(p) {
  const map = { netease: '网易云', kugou: '酷狗', qq: 'QQ音乐' };
  return map[p] || p;
}

export default function Search() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const playTrack = usePlayerStore((s) => s.playTrack);

  const doSearch = async (kw) => {
    if (!kw.trim()) return;
    setSearching(true);
    setError('');
    setResults([]);
    try {
      const res = await music.search(kw, 'netease,kugou', 20);
      const list = (res.data || []).map((item) => ({
        ...item,
        cover: item.cover || `https://picsum.photos/seed/${item.id}/400/400`,
      }));
      setResults(list);
      if (list.length === 0) setError('未找到相关声波');
    } catch (err) {
      setError('搜索失败，请稍后重试');
      console.error(err);
    } finally {
      setSearching(false);
    }
  };

  const handlePlay = (track) => {
    playTrack(track);
  };

  return (
    <div style={{ padding: 'calc(12px + env(safe-area-inset-top)) 20px 140px' }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 20 }}>探索</h1>

      {/* Search Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        background: 'var(--bg-secondary)',
        borderRadius: 14,
        padding: '10px 14px',
        marginBottom: 24,
        border: '1px solid var(--border)',
      }}>
        <SearchIcon size={18} color="var(--text-muted)" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && doSearch(query)}
          placeholder="搜索声波、艺术家..."
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            fontSize: 15,
            color: 'var(--text-primary)',
          }}
        />
        {query && (
          <button onClick={() => { setQuery(''); setResults([]); setError(''); }}>
            <X size={18} color="var(--text-muted)" />
          </button>
        )}
      </div>

      {/* Hot Tags */}
      {results.length === 0 && !searching && !error && (
        <div className="animate-fadeIn">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <TrendingUp size={18} color="var(--accent)" />
            <h2 style={{ fontSize: 17, fontWeight: 700 }}>热门搜索</h2>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {hotTags.map((tag) => (
              <button
                key={tag}
                onClick={() => { setQuery(tag); doSearch(tag); }}
                style={{
                  padding: '8px 16px',
                  borderRadius: 20,
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border)',
                  fontSize: 13,
                  color: 'var(--text-secondary)',
                  fontWeight: 500,
                }}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="animate-slideUp">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <h2 style={{ fontSize: 17, fontWeight: 700 }}>搜索结果</h2>
            <button onClick={() => setResults([])} style={{ fontSize: 12, color: 'var(--text-muted)' }}>清除</button>
          </div>
          <div style={{ background: 'var(--bg-secondary)', borderRadius: 16, padding: '8px 16px' }}>
            {results.map((track, i) => (
              <div key={track.id}>
                <SongItem track={track} index={i} onPlay={handlePlay} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 66, paddingBottom: 4 }}>
                  <Music size={10} color="var(--text-muted)" />
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    {formatPlatform(track.platform)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {searching && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 13 }}>
          正在搜寻声波...
        </div>
      )}

      {error && !searching && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 13 }}>
          {error}
        </div>
      )}
    </div>
  );
}
