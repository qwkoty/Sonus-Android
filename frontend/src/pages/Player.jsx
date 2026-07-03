import { useState, useRef, useEffect, lazy, Suspense } from 'react';
import { Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, ListMusic, Volume2, Search, Maximize2, User, MoreHorizontal } from 'lucide-react';
import { usePlayerStore } from '../store/usePlayerStore';
import { useAuthStore } from '../store/useAuthStore';
import { music } from '../api/music';
import Visualizer from '../components/Visualizer';
import FloatingLyrics from '../components/FloatingLyrics';

const Visualizer3D = lazy(() => import('../components/Visualizer3D'));

function fmt(s) { if (!s || isNaN(s)) return '0:00'; const m = Math.floor(s / 60), sec = Math.floor(s % 60); return `${m}:${sec.toString().padStart(2, '0')}`; }

const VIZ_MODES = [{ key: 'ring', label: '环', icon: '◯' }, { key: 'wave', label: '波', icon: '〜' }, { key: '3d', label: '3D', icon: '◆' }];
const PRESETS = ['#4FC3F7', '#A78BFA', '#FF6B9D', '#4ADE80', '#FB923C', '#C0C0C0'];

function Row({ track, active, onPlay }) {
  const c = track.cover || `https://picsum.photos/seed/${track.id}/400/400`;
  return (
    <div className={`glass-row ${active ? 'is-active' : ''}`} onClick={() => onPlay(track)}>
      <div style={{ width: 42, height: 42, borderRadius: 8, overflow: 'hidden', flexShrink: 0, background: active ? '#222' : '#111' }}>
        <img src={c} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: active ? 'var(--accent-dynamic)' : 'var(--text-primary)' }}>{track.title}</div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 }}>{track.artist}{track.album ? ` · ${track.album}` : ''}</div>
      </div>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{track.duration ? fmt(track.duration) : ''}</span>
    </div>
  );
}

function Sheet({ open, onClose, title, children, h = '80vh' }) {
  if (!open) return null;
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.25)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', animation: 'fadeIn .2s ease both', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div className="glass-panel-strong" onClick={e => e.stopPropagation()} style={{ width: '70%', maxWidth: 520, maxHeight: h, borderRadius: 20, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px 10px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>{title}</span>
          <button onClick={onClose} className="glass-button" style={{ width: 30, height: 30, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><MoreHorizontal size={15} color="var(--text-secondary)" /></button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 10px 20px' }}>{children}</div>
      </div>
    </div>
  );
}

// 小圆按钮
function RoundBtn({ children, onClick, title, active, accent, style }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="glass-button"
      style={{
        width: 34, height: 34, borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, transition: 'all .2s ease',
        color: active ? (accent || 'var(--accent-dynamic)') : 'var(--text-primary)',
        borderColor: active ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.08)',
        background: active ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.05)',
        ...style,
      }}
    >{children}</button>
  );
}

export default function Player({ onProfile }) {
  const { currentTrack, isPlaying, currentTime, duration, volume, playMode, playlist, togglePlay, next, prev, seek, setVolume, toggleMode, playTrack, lyrics, currentLyric, isLoadingUrl, error, clearError, setError } = usePlayerStore();
  const { userInfo, isLoggedIn } = useAuthStore();
  const [sq, setSq] = useState(false); const [qo, setQo] = useState(false); const [viz, setViz] = useState(false);
  const [query, setQuery] = useState(''); const [results, setResults] = useState([]); const [searching, setSearching] = useState(false); const st = useRef(null);
  const [vm, setVm] = useState(() => { try { return localStorage.getItem('sonus_viz_mode') || 'ring' } catch { return 'ring' } });
  const [ac, setAc] = useState(() => { try { return localStorage.getItem('sonus_accent') || '#4FC3F7' } catch { return '#4FC3F7' } });
  const [expanded, setExpanded] = useState(false);
  const pr = useRef(null); const [sk, setSk] = useState(false);

  const pct = duration ? (currentTime / duration) * 100 : 0;
  const mi = playMode === 'single' ? <Repeat1 size={14} /> : playMode === 'random' ? <Shuffle size={14} /> : <Repeat size={14} />;
  const mc = playMode === 'list' ? 'var(--text-secondary)' : 'var(--accent-dynamic)';
  const av = userInfo?.avatar;

  useEffect(() => { document.documentElement.style.setProperty('--accent-dynamic', ac); }, [ac]);
  useEffect(() => { if (error) { const t = setTimeout(clearError, 5000); return () => clearTimeout(t); } }, [error, clearError]);

  const doSearch = async kw => { if (!kw.trim()) { setResults([]); return; } setSearching(true); try { setResults(await music.search(kw, 30) || []) } catch (e) { setError('搜索失败') } finally { setSearching(false) } };
  const onQ = v => { setQuery(v); if (st.current) clearTimeout(st.current); if (!v.trim()) { setResults([]); return; } st.current = setTimeout(() => doSearch(v), 350); };

  const hp = (e) => {
    if (!pr.current || !duration || !isFinite(duration)) return;
    setSk(true);
    const up = cx => { const r = pr.current.getBoundingClientRect(); seek(Math.max(0, Math.min(1, (cx - r.left) / r.width)) * duration) };
    up(e.clientX);
    const mv = ev => up(ev.touches ? ev.touches[0].clientX : ev.clientX);
    const uu = () => { setSk(false); document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', uu); document.removeEventListener('touchmove', mv); document.removeEventListener('touchend', uu) };
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', uu); document.addEventListener('touchmove', mv); document.addEventListener('touchend', uu);
  };

  // 封面
  const coverUrl = currentTrack?.cover || (currentTrack ? `https://picsum.photos/seed/${currentTrack.id}/120/120` : '');

  return (
    <div style={{ height: '100%', position: 'relative', overflow: 'hidden', background: '#000' }}>
      {/* 可视化全屏 */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
        <FloatingLyrics lyrics={lyrics} isPlaying={isPlaying} />
        {vm === '3d' ? <Suspense><Visualizer3D accent={ac} cover={currentTrack?.cover || ''} onReady={() => { }} /></Suspense> : <Visualizer isPlaying={isPlaying} mode={vm} accent={ac} />}
      </div>

      {isLoadingUrl && <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 10, display: 'flex', alignItems: 'center', gap: 10 }}><div className="spin-icon" style={{ width: 18, height: 18, border: '2px solid var(--accent-dynamic)', borderTopColor: 'transparent', borderRadius: '50%' }} /><span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>加载音源…</span></div>}

      {/* 顶部栏：左侧"我"，右侧搜索+设置 */}
      <div style={{ position: 'absolute', top: 'calc(8px + var(--safe-top))', left: 'calc(12px + var(--safe-left))', right: 'calc(12px + var(--safe-right))', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <RoundBtn onClick={onProfile} title="个人中心" style={{ overflow: 'hidden', padding: 0 }}>
          {isLoggedIn && av ? <img src={av} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <User size={15} color="var(--text-secondary)" />}
        </RoundBtn>
        <div style={{ display: 'flex', gap: 8 }}>
          <RoundBtn onClick={() => setSq(true)} title="搜索"><Search size={15} /></RoundBtn>
          <RoundBtn onClick={() => setViz(true)} title="更多"><MoreHorizontal size={15} /></RoundBtn>
        </div>
      </div>

      {/* 展开态：顶部中央歌曲信息 */}
      {expanded && currentTrack && (
        <div style={{ position: 'absolute', top: 'calc(52px + var(--safe-top))', left: '50%', transform: 'translateX(-50%)', zIndex: 40, textAlign: 'center', pointerEvents: 'none' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', textShadow: '0 2px 12px rgba(0,0,0,0.8)' }}>{currentTrack.title}</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, textShadow: '0 2px 8px rgba(0,0,0,0.8)' }}>{currentTrack.artist}</div>
        </div>
      )}

      {/* 中部歌词 */}
      <div style={{ position: 'absolute', top: '42%', left: 0, right: 0, display: 'flex', justifyContent: 'center', padding: '0 24px', zIndex: 10, pointerEvents: 'none' }}>
        <p style={{ fontSize: 18, fontWeight: 700, color: '#fff', textAlign: 'center', opacity: currentLyric ? 1 : 0, transition: 'opacity .3s', textShadow: '0 2px 16px rgba(0,0,0,0.95)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>{currentLyric || ' '}</p>
      </div>

      {/* 错误提示 */}
      {error && <div className="glass-panel" style={{ position: 'absolute', top: 'calc(60px + var(--safe-top))', left: '50%', transform: 'translateX(-50%)', zIndex: 300, padding: '8px 16px', borderRadius: 12, fontSize: 12, color: '#FCA5A5', background: 'rgba(180,40,40,0.2)', borderColor: 'rgba(248,113,113,0.3)' }}>{error}</div>}

      {/* ===== 未展开：左下角迷你卡片 ===== */}
      {!expanded && (
        <div
          className="glass-panel-strong"
          onClick={() => setExpanded(true)}
          style={{
            position: 'absolute',
            bottom: 'calc(14px + var(--safe-bottom))',
            left: 'calc(16px + var(--safe-left))',
            zIndex: 100,
            borderRadius: 18,
            padding: '6px 8px 6px 6px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            minWidth: 0,
            cursor: 'pointer',
          }}
        >
          {/* 封面 */}
          <div style={{ width: 38, height: 38, borderRadius: 10, overflow: 'hidden', flexShrink: 0, background: '#111' }}>
            {coverUrl ? <img src={coverUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ width: '100%', height: '100%', background: 'linear-gradient(135deg,#222,#333)' }} />}
          </div>
          {/* 歌曲信息 */}
          <div style={{ minWidth: 0, maxWidth: 160, paddingRight: 2 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentTrack?.title || 'Sonus'}</div>
            <div style={{ fontSize: 10, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentTrack?.artist || '点击展开'}</div>
          </div>
          {/* 播放按钮（阻止冒泡，避免点播放时展开） */}
          <button onClick={e => { e.stopPropagation(); togglePlay(); }} className="glass-button-accent" style={{ width: 34, height: 34, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: ac, flexShrink: 0 }}>
            {isPlaying ? <Pause size={16} fill="#000" /> : <Play size={16} fill="#000" style={{ marginLeft: 1 }} />}
          </button>
        </div>
      )}

      {/* ===== 展开态：底部中央完整控制面板 ===== */}
      {expanded && (
        <div className="glass-panel-strong" style={{
          position: 'absolute',
          bottom: 'calc(14px + var(--safe-bottom))',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(520px, calc(100% - 32px))',
          zIndex: 100,
          borderRadius: 22,
          padding: '14px 18px',
        }}>
          {/* 进度条 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 9, color: 'var(--text-secondary)', flexShrink: 0, width: 30, textAlign: 'right' }}>{fmt(currentTime)}</span>
            <div ref={pr} onMouseDown={hp} onTouchStart={hp} style={{ flex: 1, height: 14, display: 'flex', alignItems: 'center', cursor: 'pointer', touchAction: 'none' }}>
              <div style={{ width: '100%', height: 3, borderRadius: 3, background: 'rgba(255,255,255,0.12)', position: 'relative', overflow: 'visible' }}>
                <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: ac, boxShadow: `0 0 6px ${ac}`, transition: sk ? 'none' : 'width .15s linear' }} />
                <div style={{ position: 'absolute', left: `calc(${pct}% - 4px)`, top: '50%', transform: 'translateY(-50%)', width: 8, height: 8, borderRadius: '50%', background: '#fff', opacity: sk ? 1 : 0.5, transition: 'opacity .2s' }} />
              </div>
            </div>
            <span style={{ fontSize: 9, color: 'var(--text-secondary)', flexShrink: 0, width: 30 }}>{fmt(duration)}</span>
          </div>

          {/* 控制按钮行 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <RoundBtn onClick={toggleMode} title="播放模式" active={playMode !== 'list'} accent={mc} style={{ color: mc }}>{mi}</RoundBtn>
            <RoundBtn onClick={prev} title="上一首"><SkipBack size={16} fill="currentColor" /></RoundBtn>
            <button onClick={togglePlay} className="glass-button-accent" style={{ width: 52, height: 52, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: ac, boxShadow: `0 0 24px ${ac}55`, flexShrink: 0 }}>
              {isPlaying ? <Pause size={24} fill="#000" /> : <Play size={24} fill="#000" style={{ marginLeft: 2 }} />}
            </button>
            <RoundBtn onClick={next} title="下一首"><SkipForward size={16} fill="currentColor" /></RoundBtn>
            <RoundBtn onClick={() => setQo(true)} title="播放队列"><ListMusic size={15} color="var(--text-secondary)" /></RoundBtn>
          </div>

          {/* 底部工具行：音量 + 收起 + 可视化切换 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
            <Volume2 size={13} color="var(--text-secondary)" style={{ flexShrink: 0 }} />
            <input type="range" min="0" max="1" step="0.01" value={volume} onChange={e => setVolume(parseFloat(e.target.value))} style={{ flex: 1, accentColor: ac, height: 3 }} />
            <span style={{ fontSize: 9, color: 'var(--text-secondary)', width: 26, textAlign: 'right' }}>{Math.round(volume * 100)}%</span>
            <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />
            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              {VIZ_MODES.map(m => <button key={m.key} onClick={() => { setVm(m.key); try { localStorage.setItem('sonus_viz_mode', m.key) } catch { } }} className={`glass-button${vm === m.key ? ' is-active' : ''}`} style={{ width: 28, height: 24, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }} title={m.label}>{m.icon}</button>)}
            </div>
            <button onClick={() => setExpanded(false)} className="glass-button" style={{ width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'var(--text-secondary)' }} title="收起">
              <Maximize2 size={13} />
            </button>
          </div>
        </div>
      )}

      {/* 搜索 Sheet */}
      <Sheet open={sq} onClose={() => setSq(false)} title="搜索">
        <div style={{ padding: '0 2px 8px' }}>
          <div className="glass-input-wrap" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px' }}>
            <Search size={14} color="var(--text-secondary)" />
            <input value={query} onChange={e => onQ(e.target.value)} placeholder="歌曲、歌手…" autoFocus style={{ flex: 1, fontSize: 13 }} />
            {query && <button onClick={() => { setQuery(''); setResults([]); }} style={{ color: 'var(--text-secondary)' }}>✕</button>}
          </div>
        </div>
        {searching && results.length === 0 ? <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}><div className="spin-icon" style={{ width: 18, height: 18, border: '2px solid var(--text-secondary)', borderTopColor: 'transparent', borderRadius: '50%' }} /></div>
          : results.length === 0 ? <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)', fontSize: 12 }}>{query ? '无结果' : '输入关键词'}</div>
            : results.map(t => <Row key={t.id} track={t} active={currentTrack?.id === t.id} onPlay={tr => { playTrack(tr); setSq(false); }} />)}
      </Sheet>

      {/* 队列 Sheet */}
      <Sheet open={qo} onClose={() => setQo(false)} title={`队列 · ${playlist.length}`}>
        {playlist.length === 0 ? <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)', fontSize: 12 }}>搜索添加歌曲</div>
          : playlist.map(t => <Row key={t.id} track={t} active={currentTrack?.id === t.id} onPlay={tr => { playTrack(tr); setQo(false); }} />)}
      </Sheet>

      {/* 设置 Sheet */}
      <Sheet open={viz} onClose={() => setViz(false)} title="设置" h="auto">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '4px 2px' }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>可视化</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {VIZ_MODES.map(m => <button key={m.key} onClick={() => { setVm(m.key); try { localStorage.setItem('sonus_viz_mode', m.key) } catch { } }} className={`glass-button${vm === m.key ? ' is-active' : ''}`} style={{ flex: 1, padding: '12px 4px', borderRadius: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, fontSize: 11 }}><span style={{ fontSize: 18 }}>{m.icon}</span>{m.label}</button>)}
            </div>
            {vm === '3d' && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6, textAlign: 'center', lineHeight: 1.5 }}>3D 模式：双指捏合缩放，双指划拉旋转</div>}
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>主题色</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {PRESETS.map(c => <button key={c} onClick={() => { setAc(c); try { localStorage.setItem('sonus_accent', c) } catch { } }} style={{ width: 26, height: 26, borderRadius: '50%', background: c, border: ac === c ? '2px solid #fff' : '2px solid rgba(255,255,255,0.15)', cursor: 'pointer', boxShadow: ac === c ? `0 0 8px ${c}` : 'none', transition: '.2s' }} />)}
              <label style={{ width: 26, height: 26, borderRadius: '50%', cursor: 'pointer', background: 'conic-gradient(red,orange,yellow,green,cyan,blue,purple,red)', border: '2px solid rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
                <input type="color" value={ac} onChange={e => { setAc(e.target.value); try { localStorage.setItem('sonus_accent', e.target.value) } catch { } }} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
                <span style={{ fontSize: 8, color: '#fff', pointerEvents: 'none', textShadow: '0 0 2px #000' }}>+</span>
              </label>
            </div>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
