import { useState, useRef } from 'react';
import {
  Play, Pause, SkipBack, SkipForward,
  Heart, Shuffle, Repeat, ListMusic, Volume2,
  Search, X, Plus, Music
} from 'lucide-react';
import { usePlayerStore } from '../store/usePlayerStore';
import { music } from '../api/music';
import Visualizer from '../components/Visualizer';
import FloatingLyrics from '../components/FloatingLyrics';

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
    platform, preloadUrls,
    lyrics, currentLyric,
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
      preloadUrls(list);
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
      background: 'var(--bg-primary)',
      overflowY: 'auto',
      overflowX: 'hidden',
      position: 'relative',
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
          background: 'rgba(10,10,10,0.98)',
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

      {/* 封面 + 可视化 + 漂浮歌词 区域 */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 280,
        paddingTop: 'calc(56px + env(safe-area-inset-top))',
        gap: 12,
      }}>
        {/* 容器：歌词背景 + 环绕音浪 + 圆形封面 */}
        <div style={{
          position: 'relative',
          width: 'min(65vw, 260px)',
          height: 'min(65vw, 260px)',
        }}>
          <FloatingLyrics lyrics={lyrics} isPlaying={isPlaying} />
          <Visualizer isPlaying={isPlaying} coverRadius={80} />

          {/* 圆形封面 */}
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 'min(40vw, 160px)',
            height: 'min(40vw, 160px)',
            borderRadius: '50%',
            overflow: 'hidden',
            zIndex: 3,
            border: '2px solid rgba(255,255,255,0.1)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 20px rgba(255,255,255,0.04)',
            animation: isPlaying ? 'spin 24s linear infinite' : 'none',
          }}>
            {currentTrack ? (
              <img
                src={currentTrack.cover}
                alt=""
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                }}
              />
            ) : (
              <div style={{
                width: '100%',
                height: '100%',
                background: 'var(--bg-elevated)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-muted)',
              }}>
                <Music size={36} />
              </div>
            )}
          </div>
        </div>

        {/* 当前歌词 */}
        <div style={{
          minHeight: 28,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 28px',
        }}>
          <p style={{
            fontSize: 15,
            fontWeight: 500,
            color: '#fff',
            textAlign: 'center',
            opacity: currentLyric ? 1 : 0,
            transition: 'opacity 0.4s ease',
            textShadow: '0 2px 8px rgba(0,0,0,0.6)',
          }}>
            {currentLyric || ' '}
          </p>
        </div>
      </div>

      {/* 歌曲信息 */}
      <div style={{
        padding: '0 28px 12px',
        textAlign: 'center',
        zIndex: 2,
      }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, letterSpacing: 0.5 }}>
          {currentTrack?.title || '未播放'}
        </h2>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 3 }}>
          {currentTrack?.artist || '选择一首歌开始'}
        </p>
      </div>

      {/* 底部控制区 */}
      <div style={{ padding: '0 28px calc(20px + var(--safe-bottom))' }}>
        {/* 进度 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 36, textAlign: 'right' }}>
            {formatTime(currentTime)}
          </span>
          <div
            ref={progressRef}
            style={{ flex: 1, height: 3, background: 'var(--surface)', borderRadius: 4, cursor: 'pointer' }}
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
          justifyContent: 'center',
          gap: 32,
          marginBottom: 14,
        }}>
          <button onClick={prev} style={{ color: 'var(--text-primary)' }}>
            <SkipBack size={26} fill="currentColor" />
          </button>

          <button
            onClick={togglePlay}
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#0A0A0A',
              boxShadow: '0 8px 24px rgba(255,255,255,0.12)',
            }}
          >
            {isPlaying
              ? <Pause size={28} fill="currentColor" />
              : <Play size={28} fill="currentColor" style={{ marginLeft: 3 }} />}
          </button>

          <button onClick={next} style={{ color: 'var(--text-primary)' }}>
            <SkipForward size={26} fill="currentColor" />
          </button>
        </div>

        {/* 副控制行 */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <button onClick={() => currentTrack && toggleLike(currentTrack.id)} style={{ color: isLiked ? '#fff' : 'var(--text-secondary)' }}>
            <Heart size={18} fill={isLiked ? 'currentColor' : 'none'} />
          </button>

          <button onClick={toggleMode} style={{ color: playMode !== 'list' ? '#fff' : 'var(--text-secondary)' }}>
            {playMode === 'random' ? <Shuffle size={18} /> : playMode === 'single' ? <Repeat size={18} /> : <ListMusic size={18} />}
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, margin: '0 16px' }}>
            <Volume2 size={14} color="var(--text-muted)" />
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              style={{ flex: 1, accentColor: '#fff', height: 2 }}
            />
          </div>

          <button
            onClick={() => setShowPlaylist(!showPlaylist)}
            style={{ color: showPlaylist ? '#fff' : 'var(--text-muted)', fontSize: 12 }}
          >
            列表
          </button>
        </div>

        {/* 播放列表 */}
        {showPlaylist && (
          <div className="animate-slideUp" style={{
            marginTop: 12,
            maxHeight: 160,
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
                <img src={track.cover} alt="" style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'cover' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {track.title}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
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
