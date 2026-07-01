import { useState, useRef } from 'react';
import {
  Play, Pause, SkipBack, SkipForward,
  Heart, Shuffle, Repeat, ListMusic, Volume2,
  Search, X, Plus
} from 'lucide-react';
import { usePlayerStore } from '../store/usePlayerStore';
import { music } from '../api/music';
import Visualizer from '../components/Visualizer';

function formatTime(s) {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function formatPlatform(p) {
  const map = { netease: '网易云', qq: 'QQ音乐', demo: '示例' };
  return map[p] || p;
}

export default function Player() {
  const store = usePlayerStore();
  const {
    currentTrack, isPlaying, currentTime, duration,
    volume, playMode, playlist, liked, playlists,
    togglePlay, next, prev, seek, setVolume,
    toggleMode, toggleLike, playTrack, addToPlaylist,
    platform,
  } = store;

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showPlaylist, setShowPlaylist] = useState(false);
  const [addMenuTrack, setAddMenuTrack] = useState(null);
  const progressRef = useRef(null);

  const isLiked = currentTrack ? liked.has(currentTrack.id) : false;
  const progress = duration ? (currentTime / duration) * 100 : 0;

  const doSearch = async (kw) => {
    if (!kw.trim()) return;
    setSearching(true);
    try {
      const searchPlatforms = platform === 'none' ? 'netease,qq' : platform;
      const res = await music.search(kw, searchPlatforms, 15);
      const list = (res.data || []).map((item) => ({
        ...item,
        cover: item.cover || `https://picsum.photos/seed/${item.id}/400/400`,
      }));
      setResults(list);
    } catch (err) {
      console.error(err);
    } finally {
      setSearching(false);
    }
  };

  const handlePlaySearch = (track) => {
    playTrack(track);
    setSearchOpen(false);
    setResults([]);
    setQuery('');
  };

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: 'linear-gradient(180deg, #111 0%, #0A0A0A 100%)',
      overflowY: 'auto',
      overflowX: 'hidden',
    }}>
      {/* 右上角悬浮搜索按钮 */}
      <div style={{
        position: 'fixed',
        top: 'calc(12px + env(safe-area-inset-top))',
        right: 16,
        zIndex: 200,
      }}>
        <button
          onClick={() => { setSearchOpen(!searchOpen); setResults([]); setQuery(''); setAddMenuTrack(null); }}
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#0A0A0A',
            boxShadow: '0 4px 16px rgba(255,255,255,0.15)',
          }}
        >
          {searchOpen ? <X size={18} /> : <Search size={18} />}
        </button>
      </div>

      {/* 搜索面板 */}
      {searchOpen && (
        <div className="animate-fadeIn" style={{
          position: 'fixed',
          inset: 0,
          zIndex: 150,
          background: 'rgba(10,10,10,0.97)',
          backdropFilter: 'blur(20px)',
          display: 'flex',
          flexDirection: 'column',
          padding: 'calc(64px + env(safe-area-inset-top)) 20px 20px',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: 'var(--bg-secondary)',
            borderRadius: 14,
            padding: '10px 14px',
            marginBottom: 16,
            border: '1px solid var(--border)',
          }}>
            <Search size={18} color="var(--text-muted)" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && doSearch(query)}
              placeholder="搜索歌曲、艺术家..."
              autoFocus
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                fontSize: 15,
                color: 'var(--text-primary)',
              }}
            />
            {query && (
              <button onClick={() => { setQuery(''); setResults([]); }}>
                <X size={18} color="var(--text-muted)" />
              </button>
            )}
          </div>



          {searching && (
            <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)', fontSize: 13 }}>
              正在搜寻...
            </div>
          )}

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {results.map((track) => (
              <div
                key={track.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 0',
                  borderBottom: '1px solid var(--border)',
                  position: 'relative',
                }}
              >
                <img
                  src={track.cover}
                  alt=""
                  onClick={() => handlePlaySearch(track)}
                  style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', flexShrink: 0, cursor: 'pointer' }}
                />
                <div style={{ flex: 1, minWidth: 0 }} onClick={() => handlePlaySearch(track)}>
                  <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer' }}>
                    {track.title}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {track.artist} · {formatPlatform(track.platform)}
                  </div>
                </div>
                <button
                  onClick={() => setAddMenuTrack(addMenuTrack === track.id ? null : track.id)}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    background: addMenuTrack === track.id ? '#fff' : 'var(--surface)',
                    color: addMenuTrack === track.id ? '#0A0A0A' : 'var(--text-secondary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Plus size={14} />
                </button>
                <button onClick={() => handlePlaySearch(track)} style={{ color: '#fff', flexShrink: 0 }}>
                  <Play size={18} />
                </button>

                {/* 添加到歌单浮层 */}
                {addMenuTrack === track.id && playlists.length > 0 && (
                  <div className="animate-scaleIn" style={{
                    position: 'absolute',
                    right: 8,
                    top: 44,
                    background: 'var(--bg-elevated)',
                    borderRadius: 12,
                    border: '1px solid var(--border)',
                    padding: '8px 0',
                    minWidth: 140,
                    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                    zIndex: 300,
                  }}>
                    <div style={{ padding: '4px 12px 8px', fontSize: 11, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
                      添加到歌单
                    </div>
                    {playlists.map((pl) => (
                      <button
                        key={pl.id}
                        onClick={() => { addToPlaylist(pl.id, track); setAddMenuTrack(null); }}
                        style={{
                          display: 'block',
                          width: '100%',
                          padding: '8px 12px',
                          fontSize: 13,
                          textAlign: 'left',
                          color: 'var(--text-primary)',
                          borderBottom: '1px solid var(--border)',
                        }}
                      >
                        {pl.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 播放器主体 */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 28px',
        gap: 20,
        paddingTop: 'calc(56px + env(safe-area-inset-top))',
      }}>
        {/* 封面 */}
        <div style={{ position: 'relative', width: 'min(65vw, 280px)', aspectRatio: '1' }}>
          {currentTrack ? (
            <>
              <img
                src={currentTrack.cover}
                alt=""
                className="cover-shadow"
                style={{
                  width: '100%',
                  height: '100%',
                  borderRadius: '24px',
                  objectFit: 'cover',
                  animation: isPlaying ? 'spin 20s linear infinite' : 'none',
                }}
              />
              <div style={{
                position: 'absolute',
                inset: -20,
                zIndex: -1,
                opacity: 0.25,
                filter: 'blur(40px)',
                background: `url(${currentTrack.cover}) center/cover`,
              }} />
            </>
          ) : (
            <div style={{
              width: '100%',
              height: '100%',
              borderRadius: '24px',
              background: 'var(--bg-elevated)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted)',
            }}>
              <Music size={48} />
            </div>
          )}
        </div>

        <Visualizer isPlaying={isPlaying} />

        {/* 歌曲信息 */}
        <div style={{ width: '100%', textAlign: 'center' }}>
          <h2 style={{ fontSize: 22, fontWeight: 700 }}>
            {currentTrack?.title || '未播放'}
          </h2>
          <p style={{ fontSize: 15, color: 'var(--text-secondary)', marginTop: 6 }}>
            {currentTrack?.artist || '选择一首歌开始'}
          </p>
          {currentTrack?.platform && (
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              来源: {formatPlatform(currentTrack.platform)}
            </p>
          )}
        </div>
      </div>

      {/* 底部控制区 */}
      <div style={{ padding: '0 28px 24px' }}>
        {/* 进度 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 36, textAlign: 'right' }}>
            {formatTime(currentTime)}
          </span>
          <div
            ref={progressRef}
            style={{ flex: 1, height: 4, background: 'var(--surface)', borderRadius: 4, cursor: 'pointer' }}
            onClick={(e) => {
              const rect = progressRef.current.getBoundingClientRect();
              const ratio = (e.clientX - rect.left) / rect.width;
              seek(ratio * duration);
            }}
          >
            <div style={{
              width: `${progress}%`,
              height: '100%',
              background: '#fff',
              borderRadius: 4,
              transition: 'width 0.1s linear',
            }} />
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 36 }}>
            {formatTime(duration)}
          </span>
        </div>

        {/* 控制按钮 */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}>
          <button onClick={() => currentTrack && toggleLike(currentTrack.id)} style={{ color: isLiked ? '#fff' : 'var(--text-secondary)' }}>
            <Heart size={22} fill={isLiked ? 'currentColor' : 'none'} />
          </button>
          <button onClick={prev} style={{ color: 'var(--text-primary)' }}>
            <SkipBack size={28} fill="currentColor" />
          </button>
          <button
            onClick={togglePlay}
            style={{
              width: 68,
              height: 68,
              borderRadius: '50%',
              background: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#0A0A0A',
              boxShadow: '0 8px 24px rgba(255,255,255,0.15)',
            }}
          >
            {isPlaying
              ? <Pause size={32} fill="currentColor" />
              : <Play size={32} fill="currentColor" style={{ marginLeft: 4 }} />}
          </button>
          <button onClick={next} style={{ color: 'var(--text-primary)' }}>
            <SkipForward size={28} fill="currentColor" />
          </button>
          <button onClick={toggleMode} style={{ color: playMode !== 'list' ? '#fff' : 'var(--text-secondary)' }}>
            {playMode === 'random' ? <Shuffle size={22} /> : playMode === 'single' ? <Repeat size={22} /> : <ListMusic size={22} />}
          </button>
        </div>

        {/* 音量 + 播放列表切换 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Volume2 size={16} color="var(--text-muted)" />
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            style={{ flex: 1, accentColor: '#fff', height: 3 }}
          />
          <button
            onClick={() => setShowPlaylist(!showPlaylist)}
            style={{ color: showPlaylist ? '#fff' : 'var(--text-muted)', fontSize: 12 }}
          >
            列表 ({playlist.length})
          </button>
        </div>

        {/* 播放列表 */}
        {showPlaylist && (
          <div className="animate-slideUp" style={{
            marginTop: 12,
            maxHeight: 180,
            overflowY: 'auto',
            background: 'var(--bg-secondary)',
            borderRadius: 12,
            padding: '8px 12px',
          }}>
            {playlist.map((track, i) => (
              <div
                key={track.id}
                onClick={() => playTrack(track)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 0',
                  cursor: 'pointer',
                  borderBottom: i < playlist.length - 1 ? '1px solid var(--border)' : 'none',
                  color: currentTrack?.id === track.id ? '#fff' : 'var(--text-primary)',
                }}
              >
                <img src={track.cover} alt="" style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'cover' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {track.title}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    {track.artist}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
