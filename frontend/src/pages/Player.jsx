import { useState, useRef, useEffect, lazy, Suspense } from 'react';
import { Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, ListMusic, Volume2, Search, X, Loader2, SlidersHorizontal } from 'lucide-react';
import { usePlayerStore } from '../store/usePlayerStore';
import { useAuthStore } from '../store/useAuthStore';
import { music } from '../api/music';
import Visualizer from '../components/Visualizer';
import FloatingLyrics from '../components/FloatingLyrics';
import LyricScroll from '../components/LyricScroll';

const Visualizer3D = lazy(() => import('../components/Visualizer3D'));

function fmt(s) { if (!s || isNaN(s)) return '0:00'; const m = Math.floor(s / 60), sec = Math.floor(s % 60); return `${m}:${sec.toString().padStart(2, '0')}`; }

const VIZ_MODES = [
  { key: 'ring', label: '环', icon: '◯' },
  { key: 'wave', label: '波', icon: '〜' },
  { key: '3d', label: '3D', icon: '◆' }
];

const PRESETS = [
  '#00F5D4', // Mineradio 青绿
  '#f4d28a', // 香槟金
  '#2442ff', // 蓝
  '#f8f4ee', // 暖白
  '#ff5367', // 玫红
  '#7ad7c2', // 薄荷
  '#A78BFA',
  '#FF6B9D',
  '#4ADE80',
  '#FB923C'
];

function hexToHsl(hex) {
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16) / 255;
  const g = parseInt(c.substring(2, 4), 16) / 255;
  const b = parseInt(c.substring(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min; s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = ((b - r) / d + 2);
    else h = ((r - g) / d + 4);
    h /= 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}
function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = v => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function ColorPicker({ value, onChange }) {
  const [h, s, l] = hexToHsl(value);
  const update = (nh, ns, nl) => {
    const hex = hslToHex(nh, Math.max(0, Math.min(100, ns)), Math.max(5, Math.min(95, nl)));
    onChange(hex);
    try { localStorage.setItem('sonus_accent', hex); } catch { }
  };
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 760, letterSpacing: '.14em', color: 'var(--fc-muted)', textTransform: 'uppercase', marginBottom: 10 }}>主题色</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        {PRESETS.map(c => (
          <button key={c} onClick={() => { onChange(c); try { localStorage.setItem('sonus_accent', c); } catch { } }}
            style={{ width: 28, height: 28, borderRadius: '50%', background: c, border: value === c ? '2px solid #fff' : '2px solid rgba(255,255,255,0.12)', cursor: 'pointer', boxShadow: value === c ? `0 0 10px ${c}, 0 4px 14px rgba(0,0,0,0.3)` : '0 2px 6px rgba(0,0,0,0.2)', transition: 'all .18s' }} />
        ))}
        <label style={{ width: 28, height: 28, borderRadius: '50%', cursor: 'pointer', background: 'conic-gradient(red,orange,yellow,green,cyan,blue,purple,red)', border: '2px solid rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
          <input type="color" value={value} onChange={e => { const c = e.target.value; onChange(c); try { localStorage.setItem('sonus_accent', c); } catch { } }} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
          <span style={{ fontSize: 9, color: '#fff', pointerEvents: 'none', textShadow: '0 0 2px #000', fontWeight: 800 }}>+</span>
        </label>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Slider label="色相" value={h} min={0} max={360} gradient={`linear-gradient(90deg, ${Array.from({ length: 8 }, (_, i) => `hsl(${i * 45}, ${s}%, ${l}%)`).join(',')})`} onChange={v => update(v, s, l)} />
        <Slider label="饱和度" value={s} min={0} max={100} gradient={`linear-gradient(90deg, hsl(${h},0%,${l}%), hsl(${h},100%,${l}%))`} onChange={v => update(h, v, l)} />
        <Slider label="亮度" value={l} min={5} max={95} gradient={`linear-gradient(90deg, hsl(${h},${s}%,5%), hsl(${h},${s}%,50%), hsl(${h},${s}%,95%))`} onChange={v => update(h, s, v)} />
      </div>
    </div>
  );
}

function Toggle({ label, value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}</span>
      <button onClick={() => onChange(!value)} style={{ width: 46, height: 24, borderRadius: 12, border: 'none', padding: 2, background: value ? 'var(--accent-dynamic)' : 'rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: value ? 'flex-end' : 'flex-start', transition: 'background .2s ease', cursor: 'pointer' }}>
        <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
      </button>
    </div>
  );
}

function Slider({ label, value, min, max, gradient, onChange }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 10, color: 'var(--text-secondary)', width: 40 }}>{label}</span>
      <div style={{ flex: 1, position: 'relative', height: 16, display: 'flex', alignItems: 'center' }}>
        <input type="range" min={min} max={max} value={value} step={1} onChange={e => onChange(parseInt(e.target.value))} style={{ width: '100%', margin: 0, appearance: 'none', WebkitAppearance: 'none', background: 'transparent', position: 'relative', zIndex: 2 }} />
        <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', transform: 'translateY(-50%)', height: 5, borderRadius: 3, background: gradient, pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', height: 5, borderRadius: 3, width: `${pct}%`, background: 'rgba(255,255,255,0.22)', pointerEvents: 'none' }} />
      </div>
    </div>
  );
}

function Row({ track, active, onPlay }) {
  const c = track.cover || `https://picsum.photos/seed/${track.id}/400/400`;
  return (
    <div className={`glass-row ${active ? 'is-active' : ''}`} onClick={() => onPlay(track)}>
      <div style={{ width: 44, height: 44, borderRadius: 10, overflow: 'hidden', flexShrink: 0, background: 'rgba(0,0,0,0.35)' }}>
        <img src={c} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: active ? 'var(--accent-dynamic)' : 'var(--text-primary)' }}>{track.title}</div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{track.artist}{track.album ? ` · ${track.album}` : ''}</div>
      </div>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{track.duration ? fmt(track.duration) : ''}</span>
    </div>
  );
}

function Sheet({ open, onClose, title, children, h = '78vh' }) {
  if (!open) return null;
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', animation: 'fadeIn .2s ease both', display: 'flex', alignItems: 'flex-end' }} onClick={onClose}>
      <div className="glass-panel animate-slideUp" onClick={e => e.stopPropagation()} style={{ width: '100%', maxHeight: h, borderRadius: '24px 24px 0 0', borderBottom: 'none', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'rgba(5,6,8,0.88)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <span style={{ fontSize: 14, fontWeight: 760, letterSpacing: '.04em' }}>{title}</span>
          <button onClick={onClose} className="glass-button" style={{ width: 30, height: 30, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={15} color="var(--text-secondary)" /></button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px 24px' }}>{children}</div>
      </div>
    </div>
  );
}

export default function Player({ onProfile }) {
  const { currentTrack, isPlaying, currentTime, duration, volume, playMode, playlist, togglePlay, next, prev, seek, setVolume, toggleMode, playTrack, lyrics, currentLyric, isLoadingUrl, error, clearError, setError } = usePlayerStore();
  const { userInfo, isLoggedIn } = useAuthStore();
  const [sq, setSq] = useState(false); const [qo, setQo] = useState(false); const [viz, setViz] = useState(false);
  const [query, setQuery] = useState(''); const [results, setResults] = useState([]); const [searching, setSearching] = useState(false); const st = useRef(null);
  const [vm, setVm] = useState(() => { try { return localStorage.getItem('sonus_viz_mode') || 'ring' } catch { return 'ring' } });
  const [ac, setAc] = useState(() => { try { return localStorage.getItem('sonus_accent') || '#00F5D4' } catch { return '#00F5D4' } });
  const [lyricPanel, setLyricPanel] = useState(() => { try { return localStorage.getItem('sonus_lyric_panel') !== 'false' } catch { return true } });
  const pr = useRef(null); const [sk, setSk] = useState(false);

  const pct = duration ? (currentTime / duration) * 100 : 0;
  const mi = playMode === 'single' ? <Repeat1 size={16} /> : playMode === 'random' ? <Shuffle size={16} /> : <Repeat size={16} />;
  const av = userInfo?.avatar;

  useEffect(() => { document.documentElement.style.setProperty('--accent-dynamic', ac); }, [ac]);
  useEffect(() => { if (error) { const t = setTimeout(clearError, 5000); return () => clearTimeout(t); } }, [error, clearError]);

  const doSearch = async kw => {
    if (!kw.trim()) { setResults([]); return; }
    setSearching(true);
    try { setResults(await music.search(kw, 30) || []) } catch (e) { setError('搜索失败') } finally { setSearching(false); }
  };
  const onQ = v => { setQuery(v); if (st.current) clearTimeout(st.current); if (!v.trim()) { setResults([]); return; } st.current = setTimeout(() => doSearch(v), 350); };

  const hp = (e) => {
    if (!pr.current || !duration || !isFinite(duration)) return;
    setSk(true);
    const up = cx => { const r = pr.current.getBoundingClientRect(); seek(Math.max(0, Math.min(1, (cx - r.left) / r.width)) * duration); };
    up(e.clientX);
    const mv = ev => up(ev.touches ? ev.touches[0].clientX : ev.clientX);
    const uu = () => { setSk(false); document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', uu); document.removeEventListener('touchmove', mv); document.removeEventListener('touchend', uu); };
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', uu); document.addEventListener('touchmove', mv); document.addEventListener('touchend', uu);
  };

  return (
    <div style={{ height: '100%', position: 'relative', overflow: 'hidden', background: '#000' }}>
      {/* 可视化背景层 */}
      <div style={{ position: 'absolute', inset: 0 }}>
        <FloatingLyrics lyrics={lyrics} isPlaying={isPlaying} />
        {vm === '3d' ? <Suspense><Visualizer3D accent={ac} cover={currentTrack?.cover || ''} /></Suspense> : <Visualizer isPlaying={isPlaying} mode={vm} accent={ac} />}
        {lyricPanel && <LyricScroll currentLyric={currentLyric || ''} accent={ac} />}
      </div>

      {/* 暗角遮罩 */}
      <div className="vignette-overlay" />

      {/* 加载 */}
      {isLoadingUrl && (
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 10, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderRadius: 14, background: 'rgba(5,6,8,0.72)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(16px)' }}>
          <Loader2 size={18} className="spin-icon" color="var(--accent-dynamic)" />
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>加载音源…</span>
        </div>
      )}

      {/* 顶部栏 */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: 'calc(12px + var(--safe-top)) 14px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 50, gap: 10 }}>
        <button onClick={onProfile} className="glass-button" style={{ width: 40, height: 40, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          {isLoggedIn && av ? <img src={av} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 12, fontWeight: 760, color: 'var(--text-secondary)' }}>{isLoggedIn ? '我' : '登'}</span>}
        </button>
        <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 760, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'rgba(255,255,255,0.95)' }}>{currentTrack?.title || 'Sonus'}</div>
          <div style={{ fontSize: 10.5, color: 'var(--text-secondary)', marginTop: 2, letterSpacing: '.3px' }}>{currentTrack?.artist || '搜索开始播放'}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setSq(true)} className="glass-button" style={{ width: 40, height: 40, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Search size={18} /></button>
          <button onClick={() => setViz(true)} className="glass-button" style={{ width: 40, height: 40, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
            <SlidersHorizontal size={18} />
            <span style={{ position: 'absolute', bottom: 5, right: 5, width: 7, height: 7, borderRadius: '50%', background: ac, boxShadow: `0 0 6px ${ac}` }} />
          </button>
        </div>
      </div>

      {/* 底部进度条（独立） */}
      <div style={{ position: 'absolute', left: '50%', bottom: 'calc(86px + var(--safe-bottom))', transform: 'translateX(-50%)', width: 'min(720px, calc(100% - 48px))', zIndex: 50, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 10.5, color: 'var(--text-muted)', minWidth: 34, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(currentTime)}</span>
        <div ref={pr} onMouseDown={hp} onTouchStart={hp} style={{ flex: 1, height: 18, display: 'flex', alignItems: 'center', cursor: 'pointer', touchAction: 'none' }}>
          <div style={{ width: '100%', height: 4, borderRadius: 999, background: 'rgba(255,255,255,0.09)', position: 'relative', overflow: 'visible', boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.12), inset 0 -1px 1px rgba(0,0,0,0.25)', transition: 'height .2s, background .2s' }}>
            <div style={{ width: `${pct}%`, height: '100%', borderRadius: 999, background: `linear-gradient(90deg, rgba(255,255,255,0.92), ${ac})`, boxShadow: `0 0 14px ${ac}44`, transition: sk ? 'none' : 'width .12s linear' }} />
            <div style={{ position: 'absolute', left: `${pct}%`, top: '50%', transform: 'translate(-50%,-50%)', width: 12, height: 12, borderRadius: '50%', background: 'radial-gradient(circle at 34% 28%, #fff 0, #fff 28%, rgba(194,235,255,0.86) 74%)', boxShadow: '0 0 0 1px rgba(255,255,255,0.34), 0 0 18px rgba(178,229,255,0.28)', opacity: sk ? 1 : 0, transition: 'opacity .16s, transform .16s', pointerEvents: 'none' }} />
          </div>
        </div>
        <span style={{ fontSize: 10.5, color: 'var(--text-muted)', minWidth: 34, fontVariantNumeric: 'tabular-nums' }}>{fmt(duration)}</span>
      </div>

      {/* 底部控制胶囊 */}
      <div className="glass-panel" style={{ position: 'absolute', bottom: 'calc(14px + var(--safe-bottom))', left: '50%', transform: 'translateX(-50%)', zIndex: 50, width: 'min(920px, calc(100% - 32px))', padding: '10px 16px', borderRadius: 50, display: 'grid', gridTemplateColumns: 'minmax(0, 1.1fr) auto minmax(0, 1.1fr)', alignItems: 'center', gap: 14 }}>
        {/* 左侧：歌曲信息 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, overflow: 'hidden' }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, overflow: 'hidden', flexShrink: 0, background: 'rgba(255,255,255,0.06)', boxShadow: '0 10px 28px rgba(0,0,0,0.24), inset 0 1px 0 rgba(255,255,255,0.16), inset 0 0 0 1px rgba(255,255,255,0.06)' }}>
            {currentTrack?.cover ? <img src={currentTrack.cover} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ width: '100%', height: '100%', background: 'linear-gradient(135deg, rgba(0,245,212,0.25), rgba(36,66,255,0.18))' }} />}
          </div>
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.92)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentTrack?.title || 'Sonus'}</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentTrack?.artist || '等待播放'}</div>
          </div>
        </div>

        {/* 中部：播放控制 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <button onClick={prev} className="glass-button" style={{ width: 38, height: 38, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.78)' }}><SkipBack size={20} fill="currentColor" /></button>
          <button onClick={togglePlay} className="glass-button-accent" style={{ width: 54, height: 54, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: ac, boxShadow: `0 0 24px ${ac}44, 0 8px 28px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.25)` }}>
            {isPlaying ? <Pause size={24} fill="#050608" /> : <Play size={24} fill="#050608" style={{ marginLeft: 2 }} />}
          </button>
          <button onClick={next} className="glass-button" style={{ width: 38, height: 38, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.78)' }}><SkipForward size={20} fill="currentColor" /></button>
        </div>

        {/* 右侧：模式/音量/队列 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, minWidth: 0 }}>
          <button onClick={toggleMode} className={`glass-button ${playMode !== 'list' ? 'is-active' : ''}`} style={{ width: 34, height: 34, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{mi}</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, position: 'relative' }}>
            <Volume2 size={14} color="var(--text-secondary)" />
            <input type="range" min="0" max="1" step="0.01" value={volume} onChange={e => setVolume(parseFloat(e.target.value))} style={{ width: 56, accentColor: ac }} />
          </div>
          <button onClick={() => setQo(true)} className={`glass-button ${qo ? 'is-active' : ''}`} style={{ width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ListMusic size={17} /></button>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="glass-panel" style={{ position: 'absolute', top: 'calc(60px + var(--safe-top))', left: '50%', transform: 'translateX(-50%)', zIndex: 300, padding: '9px 18px', borderRadius: 14, fontSize: 12, color: '#ff9fa6', background: 'rgba(120,30,30,0.25)', borderColor: 'rgba(255,100,100,0.35)' }}>
          {error}
        </div>
      )}

      {/* 搜索 Sheet */}
      <Sheet open={sq} onClose={() => setSq(false)} title="搜索">
        <div style={{ padding: '0 2px 12px' }}>
          <div className="glass-input-wrap" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', height: 54, borderRadius: 22 }}>
            <Search size={16} color="var(--text-secondary)" />
            <input value={query} onChange={e => onQ(e.target.value)} placeholder="歌曲、歌手、专辑…" autoFocus style={{ flex: 1, fontSize: 14, background: 'transparent', border: 'none', outline: 'none', color: '#fff' }} />
            {query && <button onClick={() => { setQuery(''); setResults([]); }} className="glass-button" style={{ width: 24, height: 24, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={14} /></button>}
          </div>
        </div>
        {searching && results.length === 0 ? <div style={{ display: 'flex', justifyContent: 'center', padding: 28 }}><Loader2 size={18} className="spin-icon" color="var(--text-secondary)" /></div>
          : results.length === 0 ? <div style={{ textAlign: 'center', padding: 28, color: 'var(--text-muted)', fontSize: 12, letterSpacing: '.3px' }}>{query ? '无结果' : '输入关键词开始搜索'}</div>
            : results.map(t => <Row key={t.id} track={t} active={currentTrack?.id === t.id} onPlay={tr => { playTrack(tr); setSq(false); }} />)}
      </Sheet>

      {/* 队列 Sheet */}
      <Sheet open={qo} onClose={() => setQo(false)} title={`队列 · ${playlist.length}`}>
        {playlist.length === 0 ? <div style={{ textAlign: 'center', padding: 28, color: 'var(--text-muted)', fontSize: 12 }}>搜索添加歌曲</div>
          : playlist.map(t => <Row key={t.id} track={t} active={currentTrack?.id === t.id} onPlay={tr => { playTrack(tr); setQo(false); }} />)}
      </Sheet>

      {/* 可视化设置 Sheet */}
      <Sheet open={viz} onClose={() => setViz(false)} title="视觉设置" h="auto">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '4px 2px' }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 760, letterSpacing: '.14em', color: 'var(--fc-muted)', textTransform: 'uppercase', marginBottom: 10 }}>可视化</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {VIZ_MODES.map(m => <button key={m.key} onClick={() => { setVm(m.key); try { localStorage.setItem('sonus_viz_mode', m.key); } catch { } }} className={`glass-button${vm === m.key ? ' is-active' : ''}`} style={{ flex: 1, padding: '14px 4px', borderRadius: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, fontSize: 11, transition: 'all .2s' }}><span style={{ fontSize: 20 }}>{m.icon}</span>{m.label}</button>)}
            </div>
          </div>
          <ColorPicker value={ac} onChange={setAc} />
          <Toggle label="歌词面板" value={lyricPanel} onChange={v => { setLyricPanel(v); try { localStorage.setItem('sonus_lyric_panel', String(v)); } catch { } }} />
        </div>
      </Sheet>
    </div>
  );
}
