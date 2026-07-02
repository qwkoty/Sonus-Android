import { useState, useRef, useEffect, lazy, Suspense } from 'react';
import {
  Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1,
  ListMusic, Volume2, Search, X, Loader2, SlidersHorizontal,
  User, Music2, Crown, Users, ChevronRight, ArrowLeft, LogOut, LogIn,
} from 'lucide-react';
import { usePlayerStore } from '../store/usePlayerStore';
import { useAuthStore } from '../store/useAuthStore';
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

const VIZ_MODES = [
  { key: 'ring', label: '环', icon: '◯' },
  { key: 'wave', label: '波', icon: '〜' },
  { key: '3d', label: '3D', icon: '◆' },
];

const ACCENT_PRESETS = [
  '#4FC3F7', '#9F87C0', '#FF6B9D', '#4ADE80',
  '#FB923C', '#F87171', '#A78BFA', '#FFFFFF',
];

function TrackRow({ track, active, onPlay, index }) {
  const cover = track.cover
    ? (track.cover.startsWith('http') ? music.cover(track.cover) : track.cover)
    : `https://picsum.photos/seed/${track.id}/400/400`;
  return (
    <div onClick={() => onPlay(track)} style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
      borderRadius: 12, cursor: 'pointer',
      background: active ? 'rgba(255,255,255,0.06)' : 'transparent',
      transition: 'background 0.15s ease',
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
      background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
      animation: 'fadeIn 0.2s ease both',
      display: 'flex', alignItems: 'flex-end',
    }} onClick={onClose}>
      <div
        className="animate-slideUp"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxHeight: height, borderRadius: '24px 24px 0 0',
          background: 'linear-gradient(180deg, rgba(28,28,34,0.98), rgba(16,16,20,0.99))',
          border: '1px solid rgba(255,255,255,0.1)', borderBottom: 'none',
          boxShadow: '0 -16px 48px rgba(0,0,0,0.6)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 18px 12px', borderBottom: '1px solid var(--border)',
        }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{title}</span>
          <button onClick={onClose} aria-label="关闭" style={{
            width: 30, height: 30, borderRadius: 9, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            background: 'rgba(255,255,255,0.06)', color: 'var(--text-secondary)',
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

export default function Player() {
  const {
    currentTrack, isPlaying, currentTime, duration,
    volume, playMode, playlist,
    togglePlay, next, prev, seek, setVolume,
    toggleMode, playTrack, playTrackFromList,
    lyrics, currentLyric, isLoadingUrl, error, clearError, setError,
  } = usePlayerStore();

  const { isLoggedIn, userInfo, nickname, logout } = useAuthStore();
  const setShowLogin = useAuthStore((s) => s.setShowLogin);

  // 面板状态
  const [searchOpen, setSearchOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [vizOpen, setVizOpen] = useState(false);

  // 搜索
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchTimerRef = useRef(null);

  // 用户歌单
  const [playlists, setPlaylists] = useState([]);
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);
  const [playlistDetail, setPlaylistDetail] = useState(null); // { name, tracks }
  const [loadingDetail, setLoadingDetail] = useState(false);

  // 可视化
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
    if (m === '3d') setViz3DReady(false);
    try { localStorage.setItem('sonus_viz_mode', m); } catch {}
  };
  const changeAccent = (c) => {
    setAccentColor(c);
    try { localStorage.setItem('sonus_accent_color', c); } catch {}
  };

  useEffect(() => {
    document.documentElement.style.setProperty('--accent-dynamic', accentColor);
  }, [accentColor]);

  // 错误自动消失
  useEffect(() => {
    if (error) {
      const t = setTimeout(() => clearError(), 5000);
      return () => clearTimeout(t);
    }
  }, [error, clearError]);

  // ===== 搜索（仅 QQ 音乐，单列） =====
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

  // ===== 用户歌单 =====
  const openUserPanel = async () => {
    setUserOpen(true);
    setPlaylistDetail(null);
    if (playlists.length === 0) {
      const { cookie, uin } = useAuthStore.getState();
      setLoadingPlaylists(true);
      try {
        const list = await music.userPlaylists(cookie, uin);
        setPlaylists(list || []);
      } catch (e) {
        setError('歌单加载失败');
      } finally {
        setLoadingPlaylists(false);
      }
    }
  };
  const openPlaylistDetail = async (pl) => {
    const { cookie } = useAuthStore.getState();
    setLoadingDetail(true);
    setPlaylistDetail({ name: pl.name, tracks: [] });
    try {
      const detail = await music.playlist(pl.id, cookie);
      setPlaylistDetail({ name: detail?.name || pl.name, tracks: detail?.tracks || [] });
    } catch (e) {
      setError('歌单详情加载失败');
    } finally {
      setLoadingDetail(false);
    }
  };
  const playFromPlaylist = (track) => {
    if (playlistDetail?.tracks?.length) {
      playTrackFromList(track, playlistDetail.tracks);
    } else {
      playTrack(track);
    }
    setUserOpen(false);
  };

  // ===== 进度条 =====
  const handleProgressDown = (e) => {
    if (!progressRef.current || !duration) return;
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

  // ===== 键盘快捷键 =====
  useEffect(() => {
    const onKey = (e) => {
      if (e.code === 'Escape') {
        if (searchOpen) setSearchOpen(false);
        else if (queueOpen) setQueueOpen(false);
        else if (userOpen) { playlistDetail ? setPlaylistDetail(null) : setUserOpen(false); }
        else if (vizOpen) setVizOpen(false);
        return;
      }
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (searchOpen || userOpen || queueOpen || vizOpen) return;
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
  }, [togglePlay, next, prev, seek, setVolume, toggleMode, duration, currentTime, volume, searchOpen, userOpen, queueOpen, vizOpen, playlistDetail]);

  const progress = duration ? (currentTime / duration) * 100 : 0;
  const coverFor3D = currentTrack?.cover
    ? (currentTrack.cover.startsWith('http') ? music.cover(currentTrack.cover) : currentTrack.cover)
    : '';
  const avatar = userInfo?.avatar;

  const floatBtn = {
    width: 40, height: 40, borderRadius: 12,
    background: 'var(--glass-1)', backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)', border: '1px solid var(--border)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: 'var(--text-primary)', boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
    transition: 'all 0.2s ease', cursor: 'pointer',
  };

  const modeIcon = playMode === 'single' ? <Repeat1 size={18} /> : playMode === 'random' ? <Shuffle size={18} /> : <Repeat size={18} />;
  const modeColor = playMode === 'list' ? 'var(--text-secondary)' : 'var(--accent-dynamic)';

  return (
    <div style={{ height: '100%', background: 'var(--bg-primary)', position: 'relative', overflow: 'hidden' }}>
      {/* ====== 全屏可视化 ====== */}
      <div style={{ position: 'absolute', inset: 0 }}>
        <FloatingLyrics lyrics={lyrics} isPlaying={isPlaying} />
        {vizMode === '3d'
          ? <Suspense fallback={null}>
              <Visualizer3D accent={accentColor} cover={coverFor3D} onReady={() => setViz3DReady(true)} />
            </Suspense>
          : <Visualizer isPlaying={isPlaying} mode={vizMode} accent={accentColor} />
        }
      </div>

      {/* ====== 加载指示 ====== */}
      {(isLoadingUrl || (vizMode === '3d' && !viz3DReady)) && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 10,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%', background: 'rgba(0,0,0,0.5)',
            backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Loader2 size={24} color="#fff" style={{ animation: 'spin 1s linear infinite' }} />
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', textShadow: '0 2px 8px rgba(0,0,0,0.8)' }}>
            {vizMode === '3d' && !viz3DReady ? '正在构建粒子封面…' : '正在加载音源…'}
          </span>
        </div>
      )}

      {/* ====== 顶部栏 ====== */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        padding: 'calc(12px + env(safe-area-inset-top)) 16px 12px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        zIndex: 100, gap: 10,
      }}>
        {/* 左：用户（未登录→进登录页，已登录→用户面板） */}
        <button
          onClick={() => isLoggedIn ? openUserPanel() : setShowLogin(true)}
          style={{ ...floatBtn, padding: 0, overflow: 'hidden' }}
          title={isLoggedIn ? '我的音乐' : '登录 QQ 音乐'}
        >
          {isLoggedIn && avatar
            ? <img src={music.cover(avatar)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : (isLoggedIn ? <User size={18} /> : <LogIn size={18} />)
          }
        </button>

        {/* 中：歌曲信息 */}
        <div style={{
          flex: 1, textAlign: 'center', minWidth: 0, pointerEvents: 'none',
        }}>
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
            {currentTrack?.artist || (isLoggedIn ? 'QQ音乐 · 点击搜索开始播放' : '请在左上方登录')}
          </div>
        </div>

        {/* 右：搜索 + 可视化 */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setSearchOpen(true)} style={floatBtn} title="搜索 (F)">
            <Search size={18} />
          </button>
          <button onClick={() => setVizOpen(true)} style={{
            ...floatBtn,
            background: vizOpen ? 'rgba(50,50,56,0.9)' : 'var(--glass-1)',
            position: 'relative',
          }} title="可视化设置">
            <SlidersHorizontal size={18} />
            <span style={{
              position: 'absolute', bottom: 5, right: 5, width: 8, height: 8, borderRadius: '50%',
              background: accentColor, border: '1px solid rgba(255,255,255,0.3)', boxShadow: `0 0 6px ${accentColor}`,
            }} />
          </button>
        </div>
      </div>

      {/* ====== 当前歌词 ====== */}
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

      {/* ====== 底部控制 ====== */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 50,
        padding: '12px 18px calc(14px + env(safe-area-inset-bottom))',
        background: 'linear-gradient(180deg, transparent, rgba(0,0,0,0.55))',
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
            style={{
              flex: 1, height: 16, display: 'flex', alignItems: 'center', cursor: 'pointer', touchAction: 'none',
            }}
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
                boxShadow: '0 0 8px var(--accent-dynamic)',
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
          <button onClick={toggleMode} style={{
            width: 38, height: 38, borderRadius: 10, display: 'flex',
            alignItems: 'center', justifyContent: 'center', color: modeColor, cursor: 'pointer',
          }} title="播放模式 (M)">
            {modeIcon}
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={prev} style={{
              width: 44, height: 44, borderRadius: 12, display: 'flex',
              alignItems: 'center', justifyContent: 'center', color: 'var(--text-primary)', cursor: 'pointer',
            }} title="上一首">
              <SkipBack size={22} fill="currentColor" />
            </button>
            <button onClick={togglePlay} style={{
              width: 58, height: 58, borderRadius: '50%',
              background: 'var(--accent-dynamic)', color: '#000',
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
              boxShadow: `0 6px 24px color-mix(in srgb, var(--accent-dynamic) 45%, transparent)`,
            }} title="播放/暂停 (空格)">
              {isPlaying ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" style={{ marginLeft: 2 }} />}
            </button>
            <button onClick={next} style={{
              width: 44, height: 44, borderRadius: 12, display: 'flex',
              alignItems: 'center', justifyContent: 'center', color: 'var(--text-primary)', cursor: 'pointer',
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
            <button onClick={() => setQueueOpen(true)} style={{
              width: 38, height: 38, borderRadius: 10, display: 'flex',
              alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', cursor: 'pointer',
            }} title="播放队列">
              <ListMusic size={20} />
            </button>
          </div>
        </div>
      </div>

      {/* ====== 错误提示 ====== */}
      {error && (
        <div style={{
          position: 'absolute', top: 'calc(64px + env(safe-area-inset-top))', left: '50%',
          transform: 'translateX(-50%)', zIndex: 300,
          padding: '10px 18px', borderRadius: 14,
          background: 'var(--danger)', color: '#fff', fontSize: 13,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)', maxWidth: '80vw',
        }}>
          {error}
        </div>
      )}

      {/* ====== 搜索面板（仅 QQ 音乐） ====== */}
      <Sheet open={searchOpen} onClose={() => setSearchOpen(false)} title="搜索 · QQ音乐">
        <div style={{ position: 'sticky', top: 0, padding: '4px 4px 10px', background: 'rgba(28,28,34,0.98)', zIndex: 2 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
            borderRadius: 14, background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)',
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
            <Loader2 size={22} style={{ animation: 'spin 1s linear infinite', color: 'var(--text-secondary)' }} />
          </div>
        ) : results.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)', fontSize: 13 }}>
            {query ? '没有找到结果' : '输入关键词开始搜索'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {results.map((t, i) => (
              <TrackRow key={t.id} track={t} index={i}
                active={currentTrack?.id === t.id}
                onPlay={handlePlaySearch} />
            ))}
          </div>
        )}
      </Sheet>

      {/* ====== 播放队列 ====== */}
      <Sheet open={queueOpen} onClose={() => setQueueOpen(false)} title={`播放队列 · ${playlist.length}`}>
        {playlist.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)', fontSize: 13 }}>
            队列为空，去搜索添加歌曲吧
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {playlist.map((t, i) => (
              <TrackRow key={t.id} track={t} index={i}
                active={currentTrack?.id === t.id}
                onPlay={(track) => { playTrack(track); setQueueOpen(false); }} />
            ))}
          </div>
        )}
      </Sheet>

      {/* ====== 用户面板（个人信息 + 歌单） ====== */}
      <Sheet open={userOpen} onClose={() => { setUserOpen(false); setPlaylistDetail(null); }}
        title={playlistDetail ? playlistDetail.name : '我的音乐'}>
        {playlistDetail ? (
          <>
            <button onClick={() => setPlaylistDetail(null)} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 10,
              fontSize: 13, color: 'var(--text-secondary)', padding: '4px 8px',
            }}>
              <ArrowLeft size={15} /> 返回歌单
            </button>
            {loadingDetail ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 30 }}>
                <Loader2 size={22} style={{ animation: 'spin 1s linear infinite', color: 'var(--text-secondary)' }} />
              </div>
            ) : playlistDetail.tracks.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)', fontSize: 13 }}>
                歌单暂无歌曲
              </div>
            ) : (
              <>
                <button onClick={() => playTrackFromList(playlistDetail.tracks[0], playlistDetail.tracks)} style={{
                  width: '100%', marginBottom: 8, padding: '10px', borderRadius: 12,
                  background: 'var(--accent-dynamic)', color: '#000', fontSize: 13, fontWeight: 600,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer',
                }}>
                  <Play size={16} fill="currentColor" /> 播放全部 ({playlistDetail.tracks.length})
                </button>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {playlistDetail.tracks.map((t, i) => (
                    <TrackRow key={t.id} track={t} index={i}
                      active={currentTrack?.id === t.id}
                      onPlay={playFromPlaylist} />
                  ))}
                </div>
              </>
            )}
          </>
        ) : (
          <>
            {/* 用户信息卡 */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: '14px 12px', marginBottom: 8,
              borderRadius: 16, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)',
            }}>
              <div style={{
                width: 56, height: 56, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
                background: 'rgba(255,255,255,0.08)',
              }}>
                {avatar && <img src={music.cover(avatar)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 16, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {nickname}
                  </span>
                  {userInfo?.vipLevel > 0 && (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10,
                      padding: '2px 7px', borderRadius: 6,
                      background: 'linear-gradient(135deg, #FFD700, #FFA500)', color: '#3a2200', fontWeight: 700,
                    }}>
                      <Crown size={11} /> VIP {userInfo.vipLevel}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 14, marginTop: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Users size={12} /> 关注 {userInfo?.follow ?? 0}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Users size={12} /> 粉丝 {userInfo?.fans ?? 0}
                  </span>
                </div>
              </div>
            </div>

            {/* 歌单列表 */}
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '6px 12px', marginTop: 6 }}>
              我的歌单
            </div>
            {loadingPlaylists ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 30 }}>
                <Loader2 size={22} style={{ animation: 'spin 1s linear infinite', color: 'var(--text-secondary)' }} />
              </div>
            ) : playlists.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)', fontSize: 13 }}>
                暂无歌单
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {playlists.map((pl) => (
                  <button key={pl.id} onClick={() => openPlaylistDetail(pl)} style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                    borderRadius: 12, cursor: 'pointer', textAlign: 'left',
                    background: 'transparent', transition: 'background 0.15s ease',
                  }}>
                    <div style={{
                      width: 48, height: 48, borderRadius: 10, overflow: 'hidden', flexShrink: 0,
                      background: 'rgba(255,255,255,0.06)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {pl.cover
                        ? <img src={music.cover(pl.cover)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <Music2 size={18} color="var(--text-secondary)" />
                      }
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {pl.name}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                        {pl.songCount ?? 0} 首
                      </div>
                    </div>
                    <ChevronRight size={16} color="var(--text-muted)" />
                  </button>
                ))}
              </div>
            )}

            {/* 退出登录 */}
            <button onClick={() => { logout(); }} style={{
              marginTop: 16, width: '100%', padding: '12px', borderRadius: 14,
              background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)',
              color: '#F87171', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              <LogOut size={15} /> 退出登录
            </button>
          </>
        )}
      </Sheet>

      {/* ====== 可视化设置 ====== */}
      <Sheet open={vizOpen} onClose={() => setVizOpen(false)} title="可视化设置" height="auto">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '8px 4px' }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>可视化模式</div>
            <div style={{ display: 'flex', gap: 10 }}>
              {VIZ_MODES.map((m) => (
                <button key={m.key} onClick={() => changeVizMode(m.key)} style={{
                  flex: 1, padding: '14px 8px', borderRadius: 14, cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                  background: vizMode === m.key ? 'rgba(79,195,247,0.15)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${vizMode === m.key ? 'var(--accent-dynamic)' : 'var(--border)'}`,
                  color: vizMode === m.key ? 'var(--accent-dynamic)' : 'var(--text-secondary)',
                }}>
                  <span style={{ fontSize: 20 }}>{m.icon}</span>
                  <span style={{ fontSize: 12 }}>{m.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>主题色</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, padding: '4px 2px' }}>
              {ACCENT_PRESETS.map((c) => (
                <button key={c} onClick={() => changeAccent(c)} style={{
                  width: 30, height: 30, borderRadius: '50%', cursor: 'pointer',
                  background: c, border: accentColor === c ? '3px solid #fff' : '2px solid rgba(255,255,255,0.15)',
                  boxShadow: accentColor === c ? `0 0 12px ${c}` : 'none', transition: 'all 0.2s ease',
                }} />
              ))}
            </div>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
