import { useState, useRef, useEffect, lazy, Suspense } from 'react';
import {
  Play, Pause, SkipBack, SkipForward,
  Heart, Shuffle, Repeat, ListMusic, Volume2,
  Search, X, Plus, Music, Loader2,
  User, Palette, Check, SlidersHorizontal
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
  { key: 'ring', label: '环', icon: '◯' },
  { key: 'wave', label: '波', icon: '〜' },
  { key: '3d', label: '3D', icon: '◆' },
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
    error, clearError, setError,
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
  const [showVizPanel, setShowVizPanel] = useState(false);
  const [viz3DReady, setViz3DReady] = useState(false);
  const [seeking, setSeeking] = useState(false);
  const progressRef = useRef(null);
  const searchInputRef = useRef(null);

  const changeVizMode = (m) => {
    setVizMode(m);
    if (m === '3d') setViz3DReady(false);
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

  // 每次打开搜索面板都清空上次的搜索词与结果，保证全新状态
  useEffect(() => {
    if (searchOpen) {
      setQuery('');
      setResults([]);
      setAddMenuTrack(null);
    }
  }, [searchOpen]);

  // 提示自动消失（成功提示 2.5s，错误提示 5s）
  useEffect(() => {
    if (error) {
      const isSuccess = error.includes('已添加');
      const timer = setTimeout(() => clearError(), isSuccess ? 2500 : 5000);
      return () => clearTimeout(timer);
    }
  }, [error, clearError]);

  // 同步 DIY 主色到全局 CSS 变量（背景光晕、滑块等跟随）
  useEffect(() => {
    document.documentElement.style.setProperty('--accent-dynamic', accentColor);
  }, [accentColor]);

  // 3D 粒子采样的封面：走同源代理绕过 CORS（picsum 等已支持 CORS 的可直连）
  const coverFor3D = currentTrack?.cover
    ? (currentTrack.cover.startsWith('https://picsum.photos')
        ? currentTrack.cover
        : music.cover(currentTrack.cover))
    : '';

  // 键盘快捷键
  useEffect(() => {
    const onKey = (e) => {
      // Escape 关闭搜索/面板（输入框中也生效）
      if (e.code === 'Escape') {
        if (searchOpen) { setSearchOpen(false); setResults([]); setQuery(''); setAddMenuTrack(null); }
        else if (showExtra) setShowExtra(false);
        else if (showVizPanel) setShowVizPanel(false);
        return;
      }
      // 输入框中不触发其余快捷键
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
  }, [togglePlay, next, prev, seek, setVolume, toggleMode, toggleLike, currentTrack, duration, currentTime, volume, searchOpen, showExtra, showVizPanel]);

  const isLiked = currentTrack ? liked.has(currentTrack.id) : false;
  const progress = duration ? (currentTime / duration) * 100 : 0;

  const doSearch = async (kw) => {
    if (!kw.trim()) return;
    setSearching(true);
    try {
      const searchPlatforms = platform === 'none' ? 'netease,qq' : platform;
      const res = await music.search(kw, searchPlatforms, 15);
      // res.data 现在是 { netease: [...], qq: [...] } 分组结构
      const groups = res.data || {};
      const list = [
        ...(groups.netease || []).map((item) => ({ ...item, cover: item.cover || `https://picsum.photos/seed/${item.id}/400/400` })),
        ...(groups.qq || []).map((item) => ({ ...item, cover: item.cover || `https://picsum.photos/seed/${item.id}/400/400` })),
      ];
      setResults(list);
      preloadUrls(list);
    } catch (err) {
      console.error(err);
      setError('搜索失败，请稍后重试');
    } finally {
      setSearching(false);
    }
  };

  // 搜索防抖
  const searchTimerRef = useRef(null);
  const onQueryChange = (val) => {
    setQuery(val);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!val.trim()) { setResults([]); return; }
    searchTimerRef.current = setTimeout(() => doSearch(val), 400);
  };

  const handlePlaySearch = (track) => {
    playTrack(track);
    setSearchOpen(false);
    setResults([]);
    setQuery('');
  };

  // 进度条交互：支持拖动
  const handleProgressDown = (e) => {
    if (!progressRef.current || !duration) return;
    setSeeking(true);
    const update = (clientX) => {
      if (!progressRef.current) return;
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
          ? <Suspense fallback={null}>
              <Visualizer3D
                accent={accentColor}
                cover={coverFor3D}
                onReady={() => setViz3DReady(true)}
              />
            </Suspense>
          : <Visualizer isPlaying={isPlaying} mode={vizMode} accent={accentColor} />
        }
      </div>

      {/* ====== 封面缩略图（右上角搜索下方，不挡底部进度条） ====== */}
      {vizMode !== '3d' && currentTrack && (
        <div style={{
          position: 'absolute',
          top: 'calc(64px + env(safe-area-inset-top))',
          right: 16,
          zIndex: 50,
          width: 48, height: 48,
          borderRadius: 10,
          overflow: 'hidden',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
          flexShrink: 0,
        }}>
          <img src={currentTrack.cover} alt={currentTrack.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
      )}

      {/* ====== 加载指示器（屏幕居中） ====== */}
      {(isLoadingUrl || (vizMode === '3d' && !viz3DReady)) && (
        <div style={{
          position: 'absolute',
          top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 10,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'rgba(0,0,0,0.5)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Loader2 size={24} color="#fff" style={{ animation: 'spin 1s linear infinite' }} />
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', textShadow: '0 2px 8px rgba(0,0,0,0.8)' }}>
            {vizMode === '3d' && !viz3DReady ? '正在构建粒子封面…' : '正在加载音源…'}
          </span>
        </div>
      )}

      {/* ====== 歌曲信息（顶部居中浮层） ====== */}
      <div style={{
        position: 'absolute',
        top: 'calc(16px + env(safe-area-inset-top))',
        left: '50%',
        transform: 'translateX(-50%)',
        textAlign: 'center',
        zIndex: 9,
        maxWidth: 'calc(100vw - 200px)',
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

      {/* ====== 左上角：可展开浮窗（导航 / 可视化模式 / 调色盘） ====== */}
      <div style={{
        position: 'absolute',
        top: 'calc(12px + env(safe-area-inset-top))',
        left: 16,
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        alignItems: 'flex-start',
      }}>
        {/* 顶部一行：导航 + 展开/收起切换 */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => onNavigate?.('profile')}
            style={floatBtn}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(50,50,56,0.8)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(30,30,36,0.7)'}
            title="个人中心"
          >
            <User size={18} />
          </button>
          <button
            onClick={() => { setShowVizPanel(!showVizPanel); setShowPalette(false); }}
            style={{
              ...floatBtn,
              background: showVizPanel ? 'rgba(50,50,56,0.9)' : 'rgba(30,30,36,0.7)',
              position: 'relative',
            }}
            onMouseEnter={(e) => { if (!showVizPanel) e.currentTarget.style.background = 'rgba(50,50,56,0.8)'; }}
            onMouseLeave={(e) => { if (!showVizPanel) e.currentTarget.style.background = 'rgba(30,30,36,0.7)'; }}
            title="可视化与颜色"
          >
            <SlidersHorizontal size={18} />
            <span style={{
              position: 'absolute', bottom: 5, right: 5,
              width: 8, height: 8, borderRadius: '50%',
              background: accentColor,
              border: '1px solid rgba(255,255,255,0.3)',
              boxShadow: `0 0 6px ${accentColor}`,
            }} />
          </button>
        </div>

        {/* 展开面板：可视化模式 + 调色盘 */}
        {showVizPanel && (
          <div className="animate-slideUp" style={{
            background: 'linear-gradient(180deg, rgba(26,26,32,0.96), rgba(16,16,20,0.96))',
            backdropFilter: 'blur(32px) saturate(160%)',
            WebkitBackdropFilter: 'blur(32px) saturate(160%)',
            borderRadius: 20,
            border: '1px solid rgba(255,255,255,0.12)',
            padding: 14,
            boxShadow: '0 16px 48px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.08)',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            width: 220,
          }}>
            {/* 头部：标题 + 关闭 */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 2px' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: 0.6 }}>
                可视化设置
              </span>
              <button
                onClick={() => setShowVizPanel(false)}
                aria-label="关闭"
                style={{
                  width: 22, height: 22, borderRadius: 7,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  transition: 'all 0.18s ease',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = '#fff'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
              >
                <X size={14} />
              </button>
            </div>

            {/* 可视化模式：分段控件样式（内嵌深色轨道，激活态主色填充） */}
            <div style={{
              display: 'flex',
              gap: 4,
              padding: 4,
              background: 'rgba(0,0,0,0.28)',
              borderRadius: 14,
              border: '1px solid rgba(255,255,255,0.05)',
            }}>
              {VIZ_MODES.map((m) => {
                const active = vizMode === m.key;
                return (
                  <button
                    key={m.key}
                    onClick={() => changeVizMode(m.key)}
                    style={{
                      flex: 1, height: 46, borderRadius: 10,
                      background: active
                        ? `linear-gradient(135deg, ${accentColor}, ${accentColor}cc)`
                        : 'transparent',
                      border: 'none',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      gap: 3,
                      color: active ? '#0A0A0A' : 'var(--text-muted)',
                      fontSize: 11, fontWeight: 700,
                      boxShadow: active
                        ? `0 4px 14px ${accentColor}55, inset 0 1px 0 rgba(255,255,255,0.3)`
                        : 'none',
                      transition: 'all 0.2s ease',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = 'var(--text-secondary)'; }}
                    onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = 'var(--text-muted)'; }}
                  >
                    <span style={{ fontSize: 16, lineHeight: 1 }}>{m.icon}</span>
                    <span>{m.label}</span>
                  </button>
                );
              })}
            </div>

            <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent)' }} />

            {/* 主题色标题行 */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '0 2px',
            }}>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600, letterSpacing: 0.4 }}>
                主题色
              </span>
              <span style={{
                width: 14, height: 14, borderRadius: '50%',
                background: accentColor,
                boxShadow: `0 0 8px ${accentColor}, inset 0 0 0 1px rgba(255,255,255,0.3)`,
              }} />
            </div>

            {/* 预设色（4列网格，圆角方形，选中态环形高亮） */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 8,
              padding: '2px 0',
            }}>
              {ACCENT_PRESETS.map((c) => {
                const active = accentColor.toLowerCase() === c.toLowerCase();
                // 判断颜色明度决定 Check 颜色
                const rgb = c.match(/\w\w/g).map(x => parseInt(x, 16));
                const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
                const checkColor = lum > 0.6 ? '#000' : '#fff';
                return (
                  <button
                    key={c}
                    onClick={() => changeAccent(c)}
                    aria-label={`选择颜色 ${c}`}
                    style={{
                      width: '100%', aspectRatio: '1', borderRadius: 10,
                      background: c,
                      border: active
                        ? `2px solid ${accentColor}`
                        : '1px solid rgba(255,255,255,0.12)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer',
                      boxShadow: active
                        ? `0 0 0 2px rgba(0,0,0,0.4), 0 0 12px ${c}88`
                        : 'none',
                      transition: 'all 0.18s ease',
                      transform: active ? 'scale(1.08)' : 'scale(1)',
                    }}
                    onMouseEnter={(e) => { if (!active) e.currentTarget.style.transform = 'scale(1.06)'; }}
                    onMouseLeave={(e) => { if (!active) e.currentTarget.style.transform = 'scale(1)'; }}
                  >
                    {active && <Check size={13} color={checkColor} strokeWidth={3} />}
                  </button>
                );
              })}
            </div>

            {/* 自定义拾色器 */}
            <label style={{
              height: 34, borderRadius: 12,
              background: 'linear-gradient(90deg, #ff0080, #ff8c00, #ffd700, #00ff7f, #00bfff, #8a2be2, #ff0080)',
              border: '1px solid rgba(255,255,255,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
              position: 'relative',
              overflow: 'hidden',
              boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.2)',
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
              <span style={{
                fontSize: 11, color: '#fff', fontWeight: 700,
                textShadow: '0 1px 3px rgba(0,0,0,0.7)',
                letterSpacing: 0.3,
              }}>
                自定义颜色
              </span>
            </label>
          </div>
        )}
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
          padding: '8px 4px',
        }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 34, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            {formatTime(currentTime)}
          </span>
          <div
            ref={progressRef}
            style={{
              flex: 1, height: seeking ? 6 : 3,
              background: 'rgba(255,255,255,0.12)', borderRadius: 4,
              cursor: 'pointer',
              transition: 'height 0.15s ease',
              position: 'relative',
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
            aria-label={showExtra ? '收起扩展' : '展开扩展'}
            style={{
              width: 38, height: 38, borderRadius: '50%',
              background: 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: showExtra ? accentColor : 'var(--text-muted)',
              transition: 'all 0.2s ease',
              cursor: 'pointer',
            }}
          >
            <ListMusic size={16} />
          </button>
          <button
            onClick={prev}
            aria-label="上一首"
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
            aria-label={isPlaying ? '暂停' : '播放'}
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
            aria-label="下一首"
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
          {/* 收藏：高频操作提至主控制条 */}
          <button
            onClick={() => currentTrack && toggleLike(currentTrack.id)}
            aria-label={isLiked ? '取消收藏' : '收藏'}
            aria-pressed={isLiked}
            style={{
              width: 38, height: 38, borderRadius: '50%',
              background: 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: isLiked ? accentColor : 'var(--text-muted)',
              transition: 'all 0.2s ease',
              cursor: 'pointer',
            }}
          >
            <Heart size={16} fill={isLiked ? 'currentColor' : 'none'} />
          </button>
          {/* 播放模式：选中态用 accent 色 + 强提示 */}
          <button
            onClick={toggleMode}
            aria-label={
              playMode === 'random' ? '随机播放（当前）' :
              playMode === 'single' ? '单曲循环（当前）' : '列表循环（当前）'
            }
            style={{
              width: 38, height: 38, borderRadius: '50%',
              background: playMode !== 'list' ? `${accentColor}22` : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: playMode !== 'list' ? accentColor : 'var(--text-muted)',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            {playMode === 'random' ? <Shuffle size={16} /> : playMode === 'single' ? <Repeat size={16} /> : <ListMusic size={16} />}
          </button>
        </div>

        {/* 扩展控制（点击列表按钮展开） */}
        {showExtra && (
          <div className="animate-slideUp" style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'var(--glass-2)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            borderRadius: 20,
            border: '1px solid var(--border)',
            padding: '8px 14px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          }}>
            <button
              onClick={() => currentTrack && toggleLike(currentTrack.id)}
              aria-label={isLiked ? '取消收藏' : '收藏'}
              style={{
                width: 34, height: 34, borderRadius: '50%',
                background: isLiked ? `${accentColor}22` : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: isLiked ? accentColor : 'var(--text-muted)',
                transition: 'all 0.2s ease',
                cursor: 'pointer',
              }}
            >
              <Heart size={15} fill={isLiked ? 'currentColor' : 'none'} />
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: 120 }}>
              <Volume2 size={14} color="var(--text-muted)" />
              <input type="range" min={0} max={1} step={0.01} value={volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                style={{ flex: 1, cursor: 'pointer' }} />
            </div>
            <button
              onClick={() => setShowPlaylist(!showPlaylist)}
              aria-label="播放列表"
              style={{
                width: 34, height: 34, borderRadius: '50%',
                background: showPlaylist ? `${accentColor}22` : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: showPlaylist ? accentColor : 'var(--text-muted)',
                transition: 'all 0.2s ease',
                cursor: 'pointer',
              }}
            >
              <ListMusic size={15} />
            </button>
          </div>
        )}

        {/* 播放列表浮层 */}
        {showPlaylist && (
          <div className="animate-slideUp" style={{
            width: '100%',
            maxHeight: 200, overflowY: 'auto',
            background: 'var(--glass-2)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            borderRadius: 16,
            border: '1px solid var(--border)',
            padding: '8px 12px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          }}>
            {playlist.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)', fontSize: 12 }}>
                <ListMusic size={28} style={{ marginBottom: 8, opacity: 0.4 }} />
                <div>播放列表为空</div>
                <button
                  onClick={() => { setShowPlaylist(false); setSearchOpen(true); }}
                  style={{
                    marginTop: 10, padding: '6px 14px', fontSize: 12,
                    color: accentColor, background: `${accentColor}1a`,
                    borderRadius: 14, border: '1px solid var(--border)', cursor: 'pointer',
                  }}
                >
                  去搜索添加
                </button>
              </div>
            ) : playlist.map((track, i) => (
              <div
                key={track.id}
                onClick={() => playTrack(track)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px',
                  cursor: 'pointer', position: 'relative',
                  borderBottom: i < playlist.length - 1 ? '1px solid var(--border)' : 'none',
                  color: currentTrack?.id === track.id ? '#fff' : 'var(--text-primary)',
                  opacity: currentTrack?.id === track.id ? 1 : 0.7,
                  transition: 'opacity 0.2s ease',
                  paddingLeft: currentTrack?.id === track.id ? 8 : 4,
                }}
                onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                onMouseLeave={(e) => e.currentTarget.style.opacity = currentTrack?.id === track.id ? '1' : '0.7'}
              >
                {currentTrack?.id === track.id && (
                  <span style={{
                    position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)',
                    width: 3, height: 16, borderRadius: 2,
                    background: accentColor, boxShadow: `0 0 6px ${accentColor}`,
                  }} />
                )}
                <img src={track.cover} alt={track.title} style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'cover' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {track.title}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{track.artist}</div>
                </div>
                {currentTrack?.id === track.id && isPlaying && (
                  <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 14 }}>
                    {[3, 7, 5].map((h, idx) => (
                      <div key={idx} style={{
                        width: 2, height: h,
                        background: accentColor, borderRadius: 1,
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
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && doSearch(query)}
              placeholder="搜索歌曲、艺术家..."
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 15, color: 'var(--text-primary)' }}
            />
            {query && (
              <button onClick={() => { setQuery(''); setResults([]); }} aria-label="清除" style={{ cursor: 'pointer', padding: 4 }}>
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

          {/* 空状态：搜过但无结果 */}
          {!searching && query.trim() && results.length === 0 && (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 13 }}>
              <Search size={32} style={{ marginBottom: 12, opacity: 0.3 }} />
              <div>未找到相关结果</div>
              <div style={{ fontSize: 11, marginTop: 4 }}>试试其他关键词</div>
            </div>
          )}

          {/* 初始引导：未输入时 */}
          {!searching && !query.trim() && (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 13 }}>
              <Search size={32} style={{ marginBottom: 12, opacity: 0.3 }} />
              <div>输入歌名或歌手开始搜索</div>
            </div>
          )}

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {/* 网易云分区 */}
            {results.filter((t) => t.platform === 'netease').length > 0 && (
              <>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', padding: '8px 0 4px', letterSpacing: 1 }}>网易云</div>
                {results.filter((t) => t.platform === 'netease').map((track) => (
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
                    {track.artist}
                  </div>
                </div>
                <button onClick={() => setAddMenuTrack(addMenuTrack === track.id ? null : track.id)}
                  aria-label="添加到歌单"
                  style={{
                    width: 36, height: 36, borderRadius: '50%',
                    background: addMenuTrack === track.id ? '#fff' : 'var(--surface)',
                    color: addMenuTrack === track.id ? '#0A0A0A' : 'var(--text-secondary)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    cursor: 'pointer',
                  }}>
                  <Plus size={16} />
                </button>
                <button onClick={() => handlePlaySearch(track)} aria-label="播放"
                  style={{
                    width: 36, height: 36, borderRadius: '50%',
                    background: 'rgba(255,255,255,0.1)', color: '#fff', flexShrink: 0, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                  <Play size={18} fill="currentColor" />
                </button>

                {addMenuTrack === track.id && (
                  <div className="animate-scaleIn" style={{
                    position: 'absolute', right: 8, top: 48,
                    background: 'var(--bg-elevated)', borderRadius: 12,
                    border: '1px solid var(--border)', padding: '8px 0', minWidth: 160,
                    boxShadow: '0 8px 32px rgba(0,0,0,0.5)', zIndex: 300,
                  }}>
                    <div style={{ padding: '4px 12px 8px', fontSize: 11, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
                      添加到歌单
                    </div>
                    {playlists.length === 0 ? (
                      <div style={{ padding: '12px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
                        暂无歌单<br />请先在个人中心创建
                      </div>
                    ) : (
                      playlists.map((pl) => (
                        <button key={pl.id} onClick={() => { addToPlaylist(pl.id, track); setAddMenuTrack(null); setError('已添加到「' + pl.name + '」'); }}
                          style={{ display: 'block', width: '100%', padding: '8px 12px', fontSize: 13, textAlign: 'left', color: 'var(--text-primary)', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
                          {pl.name}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            ))}
              </>
            )}
            {/* QQ音乐分区 */}
            {results.filter((t) => t.platform === 'qq').length > 0 && (
              <>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', padding: '8px 0 4px', letterSpacing: 1 }}>QQ音乐</div>
                {results.filter((t) => t.platform === 'qq').map((track) => (
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
                    {track.artist}
                  </div>
                </div>
                <button onClick={() => setAddMenuTrack(addMenuTrack === track.id ? null : track.id)}
                  aria-label="添加到歌单"
                  style={{
                    width: 36, height: 36, borderRadius: '50%',
                    background: addMenuTrack === track.id ? '#fff' : 'var(--surface)',
                    color: addMenuTrack === track.id ? '#0A0A0A' : 'var(--text-secondary)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    cursor: 'pointer',
                  }}>
                  <Plus size={16} />
                </button>
                <button onClick={() => handlePlaySearch(track)} aria-label="播放"
                  style={{
                    width: 36, height: 36, borderRadius: '50%',
                    background: 'rgba(255,255,255,0.1)', color: '#fff', flexShrink: 0, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                  <Play size={18} fill="currentColor" />
                </button>

                {addMenuTrack === track.id && (
                  <div className="animate-scaleIn" style={{
                    position: 'absolute', right: 8, top: 48,
                    background: 'var(--bg-elevated)', borderRadius: 12,
                    border: '1px solid var(--border)', padding: '8px 0', minWidth: 160,
                    boxShadow: '0 8px 32px rgba(0,0,0,0.5)', zIndex: 300,
                  }}>
                    <div style={{ padding: '4px 12px 8px', fontSize: 11, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
                      添加到歌单
                    </div>
                    {playlists.length === 0 ? (
                      <div style={{ padding: '12px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
                        暂无歌单<br />请先在个人中心创建
                      </div>
                    ) : (
                      playlists.map((pl) => (
                        <button key={pl.id} onClick={() => { addToPlaylist(pl.id, track); setAddMenuTrack(null); setError('已添加到「' + pl.name + '」'); }}
                          style={{ display: 'block', width: '100%', padding: '8px 12px', fontSize: 13, textAlign: 'left', color: 'var(--text-primary)', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
                          {pl.name}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            ))}
              </>
            )}
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
                  aria-label="添加到歌单"
                  style={{
                    width: 36, height: 36, borderRadius: '50%',
                    background: addMenuTrack === track.id ? '#fff' : 'var(--surface)',
                    color: addMenuTrack === track.id ? '#0A0A0A' : 'var(--text-secondary)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    cursor: 'pointer',
                  }}>
                  <Plus size={16} />
                </button>
                <button onClick={() => handlePlaySearch(track)} aria-label="播放"
                  style={{
                    width: 36, height: 36, borderRadius: '50%',
                    background: 'rgba(255,255,255,0.1)', color: '#fff', flexShrink: 0, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                  <Play size={18} fill="currentColor" />
                </button>

                {addMenuTrack === track.id && (
                  <div className="animate-scaleIn" style={{
                    position: 'absolute', right: 8, top: 48,
                    background: 'var(--bg-elevated)', borderRadius: 12,
                    border: '1px solid var(--border)', padding: '8px 0', minWidth: 160,
                    boxShadow: '0 8px 32px rgba(0,0,0,0.5)', zIndex: 300,
                  }}>
                    <div style={{ padding: '4px 12px 8px', fontSize: 11, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
                      添加到歌单
                    </div>
                    {playlists.length === 0 ? (
                      <div style={{ padding: '12px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
                        暂无歌单<br />请先在个人中心创建
                      </div>
                    ) : (
                      playlists.map((pl) => (
                        <button key={pl.id} onClick={() => { addToPlaylist(pl.id, track); setAddMenuTrack(null); setError('已添加到「' + pl.name + '」'); }}
                          style={{ display: 'block', width: '100%', padding: '8px 12px', fontSize: 13, textAlign: 'left', color: 'var(--text-primary)', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
                          {pl.name}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ====== Toast 提示（成功/错误分级，位置避开歌名） ====== */}
      {error && (
        <div className="animate-slideUp" style={{
          position: 'absolute',
          top: 'calc(70px + env(safe-area-inset-top))',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 500,
          background: error.includes('已添加') ? `${accentColor}e6` : 'rgba(180,40,40,0.92)',
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
          <button onClick={clearError} aria-label="关闭提示" style={{ cursor: 'pointer', opacity: 0.8, marginLeft: 4, display: 'flex' }}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
