import { useState, useRef, useEffect, lazy, Suspense } from 'react';
import {
  Play, Pause, SkipBack, SkipForward,
  Heart, Shuffle, Repeat, ListMusic, Volume2,
  Search, X, Plus, Music, Loader2,
  User, Palette, Check
} from 'lucide-react';
import { usePlayerStore } from '../store/usePlayerStore';
import { music } from '../api/music';
import Visualizer from '../components/Visualizer';
import FloatingLyrics from '../components/FloatingLyrics';

const Visualizer3D = lazy(() => import('../components/Visualizer3D'));

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

const VIZ_MODES = [
  { key: 'ring', label: '环' },
  { key: 'wave', label: '波' },
  { key: '3d', label: '3D' },
];

// DIY 颜色预设
const ACCENT_PRESETS = [
  '#4FC3F7', // 青蓝
  '#9F87C0', // 紫
  '#FF6B9D', // 粉
  '#4ADE80', // 绿
  '#FB923C', // 橙
  '#F87171', // 红
  '#A78BFA', // 薰衣草
  '#FFFFFF', // 白
];

export default function Player({ onNavigate }) {
  const store = usePlayerStore();
  const {
    currentTrack, isPlaying, currentTime, duration,
    volume, playMode, playlist, liked, playlists,
    togglePlay, next, prev, seek, setVolume,
    toggleMode, toggleLike, playTrack, addToPlaylist,
    platform, preloadUrls,
    lyrics, currentLyric, isLoadingUrl,
    error, clearError,
  } = store;

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showPlaylist, setShowPlaylist] = useState(false);
  const [addMenuTrack, setAddMenuTrack] = useState(null);
  const [showExtra, setShowExtra] = useState(false);
  const [vizMode, setVizMode] = useState(() => {
    try { return localStorage.getItem('sonus_viz_mode') || 'ring'; } catch { return 'ring'; }
  });
  const [accentColor, setAccentColor] = useState(() => {
    try { return localStorage.getItem('sonus_accent_color') || '#4FC3F7'; } catch { return '#4FC3F7'; }
  });
  const [showPalette, setShowPalette] = useState(false);
  const [seeking, setSeeking] = useState(false);
  const progressRef = useRef(null);
  const searchInputRef = useRef(null);

  const changeVizMode = (m) => {
    setVizMode(m);
    try { localStorage.setItem('sonus_viz_mode', m); } catch {}
  };

  const changeAccent = (c) => {
    setAccentColor(c);
    try { localStorage.setItem('sonus_accent_color', c); } catch {}
  };

  // 搜索面板打开时自动聚焦
  useEffect(() => {
    if (searchOpen && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [searchOpen]);

  // 错误提示自动消失
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => clearError(), 4000);
      return () => clearTimeout(timer);
    }
  }, [error, clearError]);

  // 同步 DIY 主色到全局 CSS 变量（背景光晕、滑块等跟随）
  useEffect(() => {
    document.documentElement.style.setProperty('--accent-dynamic', accentColor);
  }, [accentColor]);

  // 键盘快捷键
  useEffect(() => {
    const onKey = (e) => {
      // 输入框中不触发快捷键
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (searchOpen) return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowRight':
          if (e.shiftKey) { e.preventDefault(); next(); }
          else if (duration) { e.preventDefault(); seek(Math.min(currentTime + 5, duration)); }
          break;
        case 'ArrowLeft':
          if (e.shiftKey) { e.preventDefault(); prev(); }
          else if (duration) { e.preventDefault(); seek(Math.max(currentTime - 5, 0)); }
          break;
        case 'ArrowUp':
          e.preventDefault();
          setVolume(Math.min(volume + 0.05, 1));
          break;
        case 'ArrowDown':
          e.preventDefault();
          setVolume(Math.max(volume - 0.05, 0));
          break;
        case 'KeyM':
          e.preventDefault();
          toggleMode();
          break;
        case 'KeyL':
          e.preventDefault();
          if (currentTrack) toggleLike(currentTrack.id);
          break;
        case 'KeyF':
          e.preventDefault();
          setSearchOpen(true);
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, next, prev, seek, setVolume, toggleMode, toggleLike, currentTrack, duration, currentTime, volume, searchOpen]);

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

  // 进度条交互：支持拖动
  const handleProgressDown = (e) => {
    setSeeking(true);
    const update = (clientX) => {
      const rect = progressRef.current.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      seek(ratio * duration);
    };
    update(e.clientX);

    const onMove = (ev) => update(ev.touches ? ev.touches[0].clientX : ev.clientX);
    const onUp = () => {
      setSeeking(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onMove);
    document.addEventListener('touchend', onUp);
  };

  const floatBtn = {
    width: 38, height: 38, borderRadius: 12,
    background: 'rgba(30,30,36,0.7)',
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    border: '1px solid var(--border)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: 'var(--text-primary)',
    boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
    transition: 'all 0.2s ease',
    cursor: 'pointer',
  };

  return (
    <div style={{
      height: '100%',
      background: 'var(--bg-primary)',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* ====== 全屏可视化 ====== */}
      <div style={{
        position: 'absolute',
        inset: 0,
      }}>
        <FloatingLyrics lyrics={lyrics} isPlaying={isPlaying} />
        {vizMode === '3d'
          ? <Suspense fallback={null}><Visualizer3D accent={accentColor} /></Suspense>
          : <Visualizer isPlaying={isPlaying} mode={vizMode} accent={accentColor} />
        }
      </div>

      {/* ====== 封面缩略图（左下角，不挡视野） ====== */}
      {vizMode !== '3d' && currentTrack && (
        <div style={{
          position: 'absolute',
          bottom: 'calc(90px + var(--safe-bottom))',
          left: 16,
          zIndex: 50,
          width: 48, height: 48,
          borderRadius: 10,
          overflow: 'hidden',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
          flexShrink: 0,
        }}>
          <img src={currentTrack.cover} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
      )}

      {/* ====== 加载指示器（屏幕居中） ====== */}
      {isLoadingUrl && (
        <div style={{
          position: 'absolute',
          top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 10,
          width: 56, height: 56,
          borderRadius: '50%',
          background: 'rgba(0,0,0,0.5)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Loader2 size={24} color="#fff" style={{ animation: 'spin 1s linear infinite' }} />
        </div>
      )}

      {/* ====== 歌曲信息（顶部居中浮层） ====== */}
      <div style={{
        position: 'absolute',
        top: 'calc(16px + env(safe-area-inset-top))',
        left: '50%',
        transform: 'translateX(-50%)',
        textAlign: 'center',
        zIndex: 10,
        maxWidth: '50vw',
        pointerEvents: 'none',
      }}>
        <div style={{
          fontSize: 14, fontWeight: 700,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          textShadow: '0 2px 8px rgba(0,0,0,0.6)',
        }}>
          {currentTrack?.title || ''}
        </div>
        <div style={{
          fontSize: 11, color: 'var(--text-secondary)', marginTop: 2,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {currentTrack?.artist || ''}
        </div>
      </div>

      {/* ====== 当前歌词浮层 ====== */}
      <div style={{
        position: 'absolute',
        bottom: 150,
        left: 0, right: 0,
        display: 'flex', justifyContent: 'center',
        padding: '0 32px',
        zIndex: 10,
        pointerEvents: 'none',
      }}>
        <p style={{
          fontSize: 15, fontWeight: 600, color: '#fff',
          textAlign: 'center',
          opacity: currentLyric ? 1 : 0,
          transition: 'opacity 0.4s ease',
          textShadow: '0 2px 12px rgba(0,0,0,0.8)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          maxWidth: '85vw',
        }}>
          {currentLyric || ' '}
        </p>
      </div>

      {/* ====== 左上角：导航 ====== */}
      <div style={{
        position: 'absolute',
        top: 'calc(12px + env(safe-area-inset-top))',
        left: 16,
        zIndex: 100,
      }}>
        <button
          onClick={() => onNavigate?.('profile')}
          style={floatBtn}
          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(50,50,56,0.8)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(30,30,36,0.7)'}
        >
          <User size={18} />
        </button>
      </div>

      {/* ====== 右上角：搜索 ====== */}
      <div style={{
        position: 'absolute',
        top: 'calc(12px + env(safe-area-inset-top))',
        right: 16,
        zIndex: 100,
      }}>
        <button
          onClick={() => { setSearchOpen(!searchOpen); setResults([]); setQuery(''); setAddMenuTrack(null); }}
          style={floatBtn}
          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(50,50,56,0.8)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(30,30,36,0.7)'}
        >
          {searchOpen ? <X size={18} /> : <Search size={18} />}
        </button>
      </div>

      {/* ====== 右侧浮动：可视化模式切换（竖排） ====== */}
      <div style={{
        position: 'absolute',
        right: 12,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        zIndex: 100,
      }}>
        {VIZ_MODES.map((m) => (
          <button
            key={m.key}
            onClick={() => changeVizMode(m.key)}
            style={{
              width: 36, height: 36, borderRadius: 10,
              background: vizMode === m.key ? '#fff' : 'rgba(30,30,36,0.7)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              border: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: vizMode === m.key ? '#0A0A0A' : 'var(--text-muted)',
              fontSize: 12, fontWeight: 700,
              boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
              transition: 'all 0.2s ease',
              cursor: 'pointer',
            }}
          >
            {m.label}
          </button>
        ))}

        {/* 分隔线 */}
        <div style={{ height: 1, background: 'var(--border)', margin: '4px 6px' }} />

        {/* DIY 颜色按钮 */}
        <button
          onClick={() => setShowPalette(!showPalette)}
          style={{
            width: 36, height: 36, borderRadius: 10,
            background: showPalette ? 'rgba(50,50,56,0.9)' : 'rgba(30,30,36,0.7)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-muted)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
            transition: 'all 0.2s ease',
            cursor: 'pointer',
            position: 'relative',
          }}
          title="自定义颜色"
        >
          <Palette size={16} />
          <span style={{
            position: 'absolute', bottom: 4, right: 4,
            width: 8, height: 8, borderRadius: '50%',
            background: accentColor,
            border: '1px solid rgba(255,255,255,0.3)',
            boxShadow: `0 0 6px ${accentColor}`,
          }} />
        </button>

        {/* 颜色选择面板 */}
        {showPalette && (
          <div className="animate-scaleIn" style={{
            marginTop: 4,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            padding: 8,
            background: 'rgba(20,20,24,0.92)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            borderRadius: 14,
            border: '1px solid var(--border)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          }}>
            {ACCENT_PRESETS.map((c) => (
              <button
                key={c}
                onClick={() => changeAccent(c)}
                style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: c,
                  border: accentColor.toLowerCase() === c.toLowerCase()
                    ? '2px solid #fff'
                    : '1px solid rgba(255,255,255,0.15)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer',
                  boxShadow: accentColor.toLowerCase() === c.toLowerCase()
                    ? `0 0 10px ${c}`
                    : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                {accentColor.toLowerCase() === c.toLowerCase() && (
                  <Check size={13} color={c === '#FFFFFF' || c === '#4ADE80' || c === '#FB923C' ? '#000' : '#fff'} />
                )}
              </button>
            ))}
            {/* 自定义拾色器 */}
            <label style={{
              width: 28, height: 28, borderRadius: '50%',
              background: 'conic-gradient(from 0deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)',
              border: '1px solid rgba(255,255,255,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
              position: 'relative',
              overflow: 'hidden',
            }} title="自定义颜色">
              <input
                type="color"
                value={accentColor}
                onChange={(e) => changeAccent(e.target.value)}
                style={{
                  position: 'absolute', inset: 0,
                  width: '100%', height: '100%',
                  opacity: 0, cursor: 'pointer', border: 'none',
                }}
              />
            </label>
          </div>
        )}
      </div>

      {/* ====== 底部浮动播放胶囊 ====== */}
      <div style={{
        position: 'absolute',
        bottom: 'calc(20px + var(--safe-bottom))',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 80,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
        width: 'min(92vw, 380px)',
      }}>
        {/* 进度条 */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          width: '100%',
          padding: '0 4px',
        }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', width: 32, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            {formatTime(currentTime)}
          </span>
          <div
            ref={progressRef}
            style={{
              flex: 1, height: seeking ? 6 : 3,
              background: 'rgba(255,255,255,0.12)', borderRadius: 4,
              cursor: 'pointer',
              transition: 'height 0.15s ease',
            }}
            onMouseDown={handleProgressDown}
            onTouchStart={handleProgressDown}
          >
            <div style={{
              width: `${progress}%`, height: '100%',
              background: accentColor, borderRadius: 4,
              boxShadow: `0 0 8px ${accentColor}`,
            }} />
          </div>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', width: 32, fontVariantNumeric: 'tabular-nums' }}>
            {formatTime(duration)}
          </span>
        </div>

        {/* 主控制胶囊 */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4,
          background: 'rgba(20,20,24,0.8)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderRadius: 40,
          border: '1px solid var(--border)',
          padding: '6px 8px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}>
          <button
            onClick={() => setShowExtra(!showExtra)}
            style={{
              width: 38, height: 38, borderRadius: '50%',
              background: 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: showExtra ? '#fff' : 'var(--text-muted)',
              transition: 'all 0.2s ease',
              cursor: 'pointer',
            }}
          >
            <ListMusic size={16} />
          </button>
          <button
            onClick={prev}
            style={{
              width: 38, height: 38, borderRadius: '50%',
              background: 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-primary)',
              cursor: 'pointer',
            }}
          >
            <SkipBack size={20} fill="currentColor" />
          </button>
          <button
            onClick={togglePlay}
            style={{
              width: 48, height: 48, borderRadius: '50%',
              background: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#0A0A0A',
              boxShadow: `0 4px 20px ${accentColor}66`,
              transition: 'transform 0.15s ease',
              cursor: 'pointer',
            }}
            onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.92)'}
            onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
            onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
          >
            {isPlaying
              ? <Pause size={22} fill="currentColor" />
              : <Play size={22} fill="currentColor" style={{ marginLeft: 2 }} />}
          </button>
          <button
            onClick={next}
            style={{
              width: 38, height: 38, borderRadius: '50%',
              background: 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-primary)',
              cursor: 'pointer',
            }}
          >
            <SkipForward size={20} fill="currentColor" />
          </button>
          <button
            onClick={toggleMode}
            style={{
              width: 38, height: 38, borderRadius: '50%',
              background: 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: playMode !== 'list' ? '#fff' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
            title={playMode === 'random' ? '随机播放' : playMode === 'single' ? '单曲循环' : '列表循环'}
          >
            {playMode === 'random' ? <Shuffle size={16} /> : playMode === 'single' ? <Repeat size={16} /> : <ListMusic size={16} />}
          </button>
        </div>

        {/* 扩展控制（点击列表按钮展开） */}
        {showExtra && (
          <div className="animate-slideUp" style={{
            display: 'flex', alignItems: 'center', gap: 12,
            background: 'rgba(20,20,24,0.8)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            borderRadius: 20,
            border: '1px solid var(--border)',
            padding: '8px 16px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          }}>
            <button
              onClick={() => currentTrack && toggleLike(currentTrack.id)}
              style={{
                color: isLiked ? '#fff' : 'var(--text-muted)',
                display: 'flex', alignItems: 'center',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              <Heart size={16} fill={isLiked ? 'currentColor' : 'none'} />
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: 100 }}>
              <Volume2 size={13} color="var(--text-muted)" />
              <input type="range" min={0} max={1} step={0.01} value={volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                style={{ flex: 1, accentColor: '#fff', height: 2, cursor: 'pointer' }} />
            </div>
            <button
              onClick={() => setShowPlaylist(!showPlaylist)}
              style={{
                color: showPlaylist ? '#fff' : 'var(--text-muted)',
                fontSize: 11, fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              列表
            </button>
          </div>
        )}

        {/* 播放列表浮层 */}
        {showPlaylist && (
          <div className="animate-slideUp" style={{
            width: '100%',
            maxHeight: 200, overflowY: 'auto',
            background: 'rgba(20,20,24,0.9)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            borderRadius: 16,
            border: '1px solid var(--border)',
            padding: '8px 12px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          }}>
            {playlist.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 12 }}>
                播放列表为空
              </div>
            ) : playlist.map((track, i) => (
              <div
                key={track.id}
                onClick={() => playTrack(track)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
                  cursor: 'pointer',
                  borderBottom: i < playlist.length - 1 ? '1px solid var(--border)' : 'none',
                  color: currentTrack?.id === track.id ? '#fff' : 'var(--text-primary)',
                  opacity: currentTrack?.id === track.id ? 1 : 0.7,
                  transition: 'opacity 0.2s ease',
                }}
                onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                onMouseLeave={(e) => e.currentTarget.style.opacity = currentTrack?.id === track.id ? '1' : '0.7'}
              >
                <img src={track.cover} alt="" style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'cover' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {track.title}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{track.artist}</div>
                </div>
                {currentTrack?.id === track.id && isPlaying && (
                  <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 14 }}>
                    {[3, 7, 5].map((h, idx) => (
                      <div key={idx} style={{
                        width: 2, height: h,
                        background: '#fff', borderRadius: 1,
                        animation: `eqBar 0.8s ease-in-out ${idx * 0.15}s infinite alternate`,
                      }} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ====== 搜索面板 ====== */}
      {searchOpen && (
        <div className="animate-fadeIn" style={{
          position: 'absolute', inset: 0, zIndex: 200,
          background: 'rgba(10,10,10,0.98)',
          backdropFilter: 'blur(20px)',
          display: 'flex', flexDirection: 'column',
          padding: 'calc(64px + env(safe-area-inset-top)) 20px 20px',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'var(--bg-secondary)', borderRadius: 14,
            padding: '10px 14px', marginBottom: 16,
            border: '1px solid var(--border)',
          }}>
            <Search size={18} color="var(--text-muted)" />
            <input
              ref={searchInputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && doSearch(query)}
              placeholder="搜索歌曲、艺术家..."
              style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 15, color: 'var(--text-primary)' }}
            />
            {query && (
              <button onClick={() => { setQuery(''); setResults([]); }} style={{ cursor: 'pointer' }}>
                <X size={18} color="var(--text-muted)" />
              </button>
            )}
          </div>

          {searching && (
            <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
              正在搜寻...
            </div>
          )}

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {results.map((track) => (
              <div key={track.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 0', borderBottom: '1px solid var(--border)', position: 'relative',
              }}>
                <img src={track.cover} alt="" onClick={() => handlePlaySearch(track)}
                  style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', flexShrink: 0, cursor: 'pointer' }} />
                <div style={{ flex: 1, minWidth: 0 }} onClick={() => handlePlaySearch(track)}>
                  <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer' }}>
                    {track.title}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {track.artist} · {formatPlatform(track.platform)}
                  </div>
                </div>
                <button onClick={() => setAddMenuTrack(addMenuTrack === track.id ? null : track.id)}
                  style={{
                    width: 28, height: 28, borderRadius: '50%',
                    background: addMenuTrack === track.id ? '#fff' : 'var(--surface)',
                    color: addMenuTrack === track.id ? '#0A0A0A' : 'var(--text-secondary)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    cursor: 'pointer',
                  }}>
                  <Plus size={14} />
                </button>
                <button onClick={() => handlePlaySearch(track)} style={{ color: '#fff', flexShrink: 0, cursor: 'pointer' }}>
                  <Play size={18} />
                </button>

                {addMenuTrack === track.id && playlists.length > 0 && (
                  <div className="animate-scaleIn" style={{
                    position: 'absolute', right: 8, top: 44,
                    background: 'var(--bg-elevated)', borderRadius: 12,
                    border: '1px solid var(--border)', padding: '8px 0', minWidth: 140,
                    boxShadow: '0 8px 32px rgba(0,0,0,0.5)', zIndex: 300,
                  }}>
                    <div style={{ padding: '4px 12px 8px', fontSize: 11, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
                      添加到歌单
                    </div>
                    {playlists.map((pl) => (
                      <button key={pl.id} onClick={() => { addToPlaylist(pl.id, track); setAddMenuTrack(null); }}
                        style={{ display: 'block', width: '100%', padding: '8px 12px', fontSize: 13, textAlign: 'left', color: 'var(--text-primary)', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
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

      {/* ====== Toast 错误提示 ====== */}
      {error && (
        <div className="animate-slideUp" style={{
          position: 'absolute',
          top: 'calc(60px + env(safe-area-inset-top))',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 500,
          background: 'rgba(180,40,40,0.9)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          color: '#fff',
          padding: '10px 20px',
          borderRadius: 20,
          fontSize: 13,
          fontWeight: 500,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          maxWidth: '80vw',
          textAlign: 'center',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <span>{error}</span>
          <button onClick={clearError} style={{ cursor: 'pointer', opacity: 0.7, marginLeft: 4 }}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
