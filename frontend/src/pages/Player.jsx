import { useState, useRef, useEffect, lazy, Suspense } from 'react';
import {
  Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1,
  ListMusic, Volume2, Search, X, Loader2, SlidersHorizontal,
  User, Palette,
} from 'lucide-react';
import { usePlayerStore } from '../store/usePlayerStore';
import { useAuthStore } from '../store/useAuthStore';
import { music } from '../api/music';
import Visualizer from '../components/Visualizer';
import FloatingLyrics from '../components/FloatingLyrics';

const Visualizer3D = lazy(() => import('../components/Visualizer3D'));
const Visualizer3DPulse = lazy(() => import('../components/Visualizer3DPulse'));

function formatTime(s) {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

const VIZ_MODES = [
  { key: 'ring', label: '环', icon: '◯' },
  { key: 'wave', label: '波', icon: '〜' },
  { key: '3d', label: '3D', icon: '◆' },
  { key: 'pulse', label: '脉冲', icon: '✦' },
];

const ACCENT_PRESETS = [
  '#4FC3F7', '#A78BFA', '#FF6B9D', '#4ADE80',
  '#FB923C', '#FFFFFF',
];

function TrackRow({ track, active, onPlay }) {
  const cover = track.cover
    ? (track.cover.startsWith('http') ? music.cover(track.cover) : track.cover)
    : `https://picsum.photos/seed/${track.id}/400/400`;
  return (
    <div className={`glass-row ${active ? 'is-active' : ''}`} onClick={() => onPlay(track)} style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
    }}>
      <div style={{ position: 'relative', width: 44, height: 44, borderRadius: 8, overflow: 'hidden', flexShrink: 0 }}>
        <img src={cover} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        {active && (
          <div style={{
            position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Play size={16} color="#fff" fill="currentColor" />
          </div>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          color: active ? 'var(--accent-dynamic)' : 'var(--text-primary)',
        }}>
          {track.title}
        </div>
        <div style={{
          fontSize: 12, color: 'var(--text-secondary)', marginTop: 2,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {track.artist}{track.album ? ` · ${track.album}` : ''}
        </div>
      </div>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
        {track.duration ? formatTime(track.duration) : ''}
      </span>
    </div>
  );
}

function Sheet({ open, onClose, title, children, height = '78vh' }) {
  if (!open) return null;
  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(6px)',
      WebkitBackdropFilter: 'blur(6px)',
      animation: 'fadeIn 0.2s ease both',
      display: 'flex', alignItems: 'flex-end',
    }} onClick={onClose}>
      <div
        className="glass-panel-strong animate-slideUp"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxHeight: height, borderRadius: '24px 24px 0 0',
          borderBottom: 'none',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 18px 12px', borderBottom: '1px solid var(--glass-border-light)',
        }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{title}</span>
          <button onClick={onClose} aria-label="关闭" className="glass-button" style={{
            width: 30, height: 30, borderRadius: 9,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-secondary)',
          }}>
            <X size={16} />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px 24px' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

export default function Player({ onProfile }) {
  const {
    currentTrack, isPlaying, currentTime, duration,
    volume, playMode, playlist,
    togglePlay, next, prev, seek, setVolume,
    toggleMode, playTrack,
    lyrics, currentLyric, isLoadingUrl, error, clearError, setError,
  } = usePlayerStore();

  const { userInfo, isLoggedIn } = useAuthStore();

  const [searchOpen, setSearchOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [vizOpen, setVizOpen] = useState(false);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchTimerRef = useRef(null);

  const [vizMode, setVizMode] = useState(() => {
    try { return localStorage.getItem('sonus_viz_mode') || 'ring'; } catch { return 'ring'; }
  });
  const [accentColor, setAccentColor] = useState(() => {
    try { return localStorage.getItem('sonus_accent_color') || '#4FC3F7'; } catch { return '#4FC3F7'; }
  });
  const [viz3DReady, setViz3DReady] = useState(false);

  const progressRef = useRef(null);
  const [seeking, setSeeking] = useState(false);

  const changeVizMode = (m) => {
    setVizMode(m);
    if (m === '3d' || m === 'pulse') setViz3DReady(false);
    try { localStorage.setItem('sonus_viz_mode', m); } catch {}
  };
  const changeAccent = (c) => {
    setAccentColor(c);
    try { localStorage.setItem('sonus_accent_color', c); } catch {}
  };

  useEffect(() => {
    document.documentElement.style.setProperty('--accent-dynamic', accentColor);
  }, [accentColor]);

  useEffect(() => {
    if (error) {
      const t = setTimeout(() => clearError(), 5000);
      return () => clearTimeout(t);
    }
  }, [error, clearError]);

  const doSearch = async (kw) => {
    if (!kw.trim()) { setResults([]); return; }
    setSearching(true);
    try {
      const list = await music.search(kw, 30);
      setResults(list || []);
    } catch (e) {
      setError('搜索失败，请稍后重试');
    } finally {
      setSearching(false);
    }
  };
  const onQueryChange = (val) => {
    setQuery(val);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!val.trim()) { setResults([]); return; }
    searchTimerRef.current = setTimeout(() => doSearch(val), 400);
  };

  const handlePlaySearch = (track) => {
    playTrack(track);
    setSearchOpen(false);
  };

  const handleProgressDown = (e) => {
    if (!progressRef.current || !duration || !isFinite(duration)) return;
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

  useEffect(() => {
    const onKey = (e) => {
      if (e.code === 'Escape') {
        if (searchOpen) setSearchOpen(false);
        else if (queueOpen) setQueueOpen(false);
        else if (vizOpen) setVizOpen(false);
        return;
      }
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (searchOpen || queueOpen || vizOpen) return;
      switch (e.code) {
        case 'Space': e.preventDefault(); togglePlay(); break;
        case 'ArrowRight':
          if (e.shiftKey) { e.preventDefault(); next(); }
          else if (duration) { e.preventDefault(); seek(Math.min(currentTime + 5, duration)); }
          break;
        case 'ArrowLeft':
          if (e.shiftKey) { e.preventDefault(); prev(); }
          else if (duration) { e.preventDefault(); seek(Math.max(currentTime - 5, 0)); }
          break;
        case 'ArrowUp': e.preventDefault(); setVolume(Math.min(volume + 0.05, 1)); break;
        case 'ArrowDown': e.preventDefault(); setVolume(Math.max(volume - 0.05, 0)); break;
        case 'KeyM': e.preventDefault(); toggleMode(); break;
        case 'KeyF': e.preventDefault(); setSearchOpen(true); break;
        default: break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, next, prev, seek, setVolume, toggleMode, duration, currentTime, volume, searchOpen, queueOpen, vizOpen]);

  const progress = duration ? (currentTime / duration) * 100 : 0;
  const coverFor3D = currentTrack?.cover
    ? (currentTrack.cover.startsWith('http') ? music.cover(currentTrack.cover) : currentTrack.cover)
    : '';
  const avatar = userInfo?.avatar;

  const modeIcon = playMode === 'single' ? <Repeat1 size={18} /> : playMode === 'random' ? <Shuffle size={18} /> : <Repeat size={18} />;
  const modeColor = playMode === 'list' ? 'var(--text-secondary)' : 'var(--accent-dynamic)';

  return (
    <div style={{ height: '100%', background: 'transparent', position: 'relative', overflow: 'hidden' }}>
      {/* 全屏可视化 */}
      <div style={{ position: 'absolute', inset: 0 }}>
        <FloatingLyrics lyrics={lyrics} isPlaying={isPlaying} />
        {vizMode === '3d'
          ? <Suspense fallback={null}>
              <Visualizer3D accent={accentColor} cover={coverFor3D} onReady={() => setViz3DReady(true)} />
            </Suspense>
          : vizMode === 'pulse'
          ? <Suspense fallback={null}>
              <Visualizer3DPulse accent={accentColor} onReady={() => setViz3DReady(true)} />
            </Suspense>
          : <Visualizer isPlaying={isPlaying} mode={vizMode} accent={accentColor} />
        }
      </div>

      {/* 加载指示 */}
      {(isLoadingUrl || ((vizMode === '3d' || vizMode === 'pulse') && !viz3DReady)) && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 10,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
        }}>
          <div className="glass-panel" style={{
            width: 56, height: 56, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Loader2 size={24} color="#fff" style={{ animation: 'spin 1s linear infinite' }} />
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', textShadow: '0 2px 8px rgba(0,0,0,0.8)' }}>
            {(vizMode === '3d' || vizMode === 'pulse') && !viz3DReady ? '正在加载可视化…' : '正在加载音源…'}
          </span>
        </div>
      )}

      {/* 顶部栏 */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        padding: 'calc(12px + env(safe-area-inset-top)) 16px 12px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        zIndex: 100, gap: 10,
      }}>
        <button
          onClick={onProfile}
          className="glass-button"
          style={{ width: 40, height: 40, borderRadius: 12, padding: 0, overflow: 'hidden' }}
          title={isLoggedIn ? '我的音乐' : '登录 QQ 音乐'}
        >
          {isLoggedIn && avatar
            ? <img src={music.cover(avatar)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <User size={18} />
          }
        </button>

        <div style={{ flex: 1, textAlign: 'center', minWidth: 0, pointerEvents: 'none' }}>
          <div style={{
            fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            textShadow: '0 2px 8px rgba(0,0,0,0.6)',
          }}>
            {currentTrack?.title || 'Sonus'}
          </div>
          <div style={{
            fontSize: 11, color: 'var(--text-secondary)', marginTop: 2,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {currentTrack?.artist || '点击搜索开始播放'}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setSearchOpen(true)} className="glass-button" style={{ width: 40, height: 40, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="搜索 (F)">
            <Search size={18} />
          </button>
          <button onClick={() => setVizOpen(true)} className={`glass-button ${vizOpen ? 'is-active' : ''}`} style={{ width: 40, height: 40, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }} title="可视化设置">
            <SlidersHorizontal size={18} />
            <span style={{
              position: 'absolute', bottom: 5, right: 5, width: 8, height: 8, borderRadius: '50%',
              background: accentColor, border: '1px solid rgba(255,255,255,0.3)', boxShadow: `0 0 6px ${accentColor}`,
            }} />
          </button>
        </div>
      </div>

      {/* 当前歌词 */}
      <div style={{
        position: 'absolute', bottom: 168, left: 0, right: 0,
        display: 'flex', justifyContent: 'center', padding: '0 32px', zIndex: 10, pointerEvents: 'none',
      }}>
        <p style={{
          fontSize: 15, fontWeight: 600, color: '#fff', textAlign: 'center',
          opacity: currentLyric ? 1 : 0, transition: 'opacity 0.4s ease',
          textShadow: '0 2px 12px rgba(0,0,0,0.8)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '85vw',
        }}>
          {currentLyric || ' '}
        </p>
      </div>

      {/* 底部控制栏 - 液态玻璃 */}
      <div className="glass-panel" style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 50,
        padding: '12px 18px calc(14px + env(safe-area-inset-bottom))',
        borderRadius: '24px 24px 0 0',
        borderTop: '1px solid var(--glass-border)',
        borderLeft: 'none', borderRight: 'none', borderBottom: 'none',
      }}>
        {/* 进度条 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)', minWidth: 34, textAlign: 'right' }}>
            {formatTime(currentTime)}
          </span>
          <div
            ref={progressRef}
            onMouseDown={handleProgressDown}
            onTouchStart={handleProgressDown}
            style={{ flex: 1, height: 16, display: 'flex', alignItems: 'center', cursor: 'pointer', touchAction: 'none' }}
          >
            <div style={{
              width: '100%', height: 4, borderRadius: 4,
              background: 'rgba(255,255,255,0.12)', position: 'relative', overflow: 'visible',
            }}>
              <div style={{
                width: `${progress}%`, height: '100%', borderRadius: 4,
                background: 'var(--accent-dynamic)',
                boxShadow: `0 0 8px var(--accent-dynamic)`,
                transition: seeking ? 'none' : 'width 0.15s linear',
              }} />
              <div style={{
                position: 'absolute', left: `calc(${progress}% - 6px)`, top: '50%', transform: 'translateY(-50%)',
                width: 12, height: 12, borderRadius: '50%', background: '#fff',
                boxShadow: `0 0 8px var(--accent-dynamic)`,
                opacity: seeking ? 1 : 0.6, transition: 'opacity 0.2s ease',
              }} />
            </div>
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)', minWidth: 34 }}>
            {formatTime(duration)}
          </span>
        </div>

        {/* 控制按钮 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <button onClick={toggleMode} className="glass-button" style={{
            width: 38, height: 38, borderRadius: 10,
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: modeColor,
          }} title="播放模式 (M)">
            {modeIcon}
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={prev} className="glass-button" style={{
              width: 44, height: 44, borderRadius: 12,
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-primary)',
            }} title="上一首">
              <SkipBack size={22} fill="currentColor" />
            </button>
            <button onClick={togglePlay} className="glass-button-accent" style={{
              width: 58, height: 58, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }} title="播放/暂停 (空格)">
              {isPlaying ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" style={{ marginLeft: 2 }} />}
            </button>
            <button onClick={next} className="glass-button" style={{
              width: 44, height: 44, borderRadius: 12,
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-primary)',
            }} title="下一首">
              <SkipForward size={22} fill="currentColor" />
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 96, justifyContent: 'flex-end' }}>
            <Volume2 size={16} color="var(--text-secondary)" />
            <input
              type="range" min="0" max="1" step="0.01" value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              style={{ width: 64, accentColor: 'var(--accent-dynamic)' }}
            />
            <button onClick={() => setQueueOpen(true)} className="glass-button" style={{
              width: 38, height: 38, borderRadius: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)',
            }} title="播放队列">
              <ListMusic size={20} />
            </button>
          </div>
        </div>
      </div>

      {/* 错误提示 - 玻璃危险卡片 */}
      {error && (
        <div className="glass-panel" style={{
          position: 'absolute', top: 'calc(64px + env(safe-area-inset-top))', left: '50%',
          transform: 'translateX(-50%)', zIndex: 300,
          padding: '10px 18px', borderRadius: 14,
          background: 'var(--glass-danger-bg)', borderColor: 'var(--glass-danger-border)',
          color: '#FCA5A5', fontSize: 13, maxWidth: '80vw',
        }}>
          {error}
        </div>
      )}

      {/* 搜索面板 */}
      <Sheet open={searchOpen} onClose={() => setSearchOpen(false)} title="搜索 · QQ音乐">
        <div style={{ position: 'sticky', top: 0, padding: '4px 4px 10px', zIndex: 2 }}>
          <div className="glass-input-wrap" style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
          }}>
            <Search size={16} color="var(--text-secondary)" />
            <input
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="搜索歌曲、歌手…"
              autoFocus
              style={{ flex: 1, fontSize: 14, color: 'var(--text-primary)' }}
            />
            {query && (
              <button onClick={() => { setQuery(''); setResults([]); }} style={{ color: 'var(--text-secondary)' }}>
                <X size={15} />
              </button>
            )}
          </div>
        </div>
        {searching && results.length === 0 ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 30 }}>
            <Loader2 size={22} className="spin-icon" style={{ color: 'var(--text-secondary)' }} />
          </div>
        ) : results.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)', fontSize: 13 }}>
            {query ? '没有找到结果' : '输入关键词开始搜索'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {results.map((t) => (
              <TrackRow key={t.id} track={t}
                active={currentTrack?.id === t.id}
                onPlay={handlePlaySearch} />
            ))}
          </div>
        )}
      </Sheet>

      {/* 播放队列 */}
      <Sheet open={queueOpen} onClose={() => setQueueOpen(false)} title={`播放队列 · ${playlist.length}`}>
        {playlist.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)', fontSize: 13 }}>
            队列为空，去搜索添加歌曲吧
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {playlist.map((t) => (
              <TrackRow key={t.id} track={t}
                active={currentTrack?.id === t.id}
                onPlay={(track) => { playTrack(track); setQueueOpen(false); }} />
            ))}
          </div>
        )}
      </Sheet>

      {/* 可视化设置 */}
      <Sheet open={vizOpen} onClose={() => setVizOpen(false)} title="设置" height="auto">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '8px 4px' }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>可视化</div>
            <div style={{ display: 'flex', gap: 10 }}>
              {VIZ_MODES.map((m) => (
                <button key={m.key} onClick={() => changeVizMode(m.key)} className={`glass-button ${vizMode === m.key ? 'is-active' : ''}`} style={{
                  flex: 1, padding: '14px 8px', borderRadius: 14,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                  color: vizMode === m.key ? 'var(--accent-dynamic)' : 'var(--text-secondary)',
                }}>
                  <span style={{ fontSize: 20 }}>{m.icon}</span>
                  <span style={{ fontSize: 12 }}>{m.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Palette size={13} /> 主题色
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              {ACCENT_PRESETS.map((c) => (
                <button key={c} onClick={() => changeAccent(c)} style={{
                  width: 30, height: 30, borderRadius: '50%', cursor: 'pointer',
                  background: c, border: accentColor === c ? '3px solid #fff' : '2px solid rgba(255,255,255,0.15)',
                  boxShadow: accentColor === c ? `0 0 12px ${c}` : 'none', transition: 'all 0.2s ease',
                }} />
              ))}
              {/* 调色盘 */}
              <label style={{
                width: 30, height: 30, borderRadius: '50%', cursor: 'pointer',
                background: 'conic-gradient(red, orange, yellow, green, cyan, blue, purple, red)',
                border: '2px solid rgba(255,255,255,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                position: 'relative', overflow: 'hidden',
              }}>
                <input
                  type="color"
                  value={accentColor}
                  onChange={(e) => changeAccent(e.target.value)}
                  style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
                />
                <span style={{ fontSize: 10, color: '#fff', textShadow: '0 0 2px rgba(0,0,0,0.8)', pointerEvents: 'none' }}>+</span>
              </label>
            </div>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
