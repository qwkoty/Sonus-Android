import { useState, useRef, useEffect, lazy, Suspense } from 'react';
import { Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, ListMusic, Volume2, Search, X, Loader2, SlidersHorizontal } from 'lucide-react';
import { usePlayerStore } from '../store/usePlayerStore';
import { useAuthStore } from '../store/useAuthStore';
import { music } from '../api/music';
import Visualizer from '../components/Visualizer';
import LyricBackground from '../components/LyricBackground';

const Visualizer3D = lazy(() => import('../components/Visualizer3D'));

function fmt(s) { if (!s||isNaN(s)) return '0:00'; const m=Math.floor(s/60), sec=Math.floor(s%60); return `${m}:${sec.toString().padStart(2,'0')}`; }

const VIZ_MODES = [{ key:'ring',label:'环',icon:'◯'},{ key:'wave',label:'波',icon:'〜'},{ key:'3d',label:'3D',icon:'◆'}];
const PRESETS = ['#4FC3F7','#A78BFA','#FF6B9D','#4ADE80','#FB923C','#FACC15','#C0C0C0','#FFFFFF','#EF4444','#22D3EE'];

// 完整 DIY 调色盘：预设 + 色相/饱和度/亮度三轴
function ColorPicker({ value, onChange }) {
  const [h, s, l] = hexToHsl(value);
  const update = (nh, ns, nl) => {
    const hex = hslToHex(nh, Math.max(0, Math.min(100, ns)), Math.max(5, Math.min(95, nl)));
    onChange(hex);
    try { localStorage.setItem('sonus_accent', hex); } catch {}
  };
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>主题色</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        {PRESETS.map(c => <button key={c} onClick={() => { onChange(c); try { localStorage.setItem('sonus_accent', c); } catch {} }} style={{ width: 26, height: 26, borderRadius: '50%', background: c, border: value === c ? '2px solid #fff' : '2px solid rgba(255,255,255,0.15)', cursor: 'pointer', boxShadow: value === c ? `0 0 8px ${c}` : 'none', transition: '.2s' }} />)}
        <label style={{ width: 26, height: 26, borderRadius: '50%', cursor: 'pointer', background: 'conic-gradient(red,orange,yellow,green,cyan,blue,purple,red)', border: '2px solid rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
          <input type="color" value={value} onChange={e => { const c = e.target.value; onChange(c); try { localStorage.setItem('sonus_accent', c); } catch {} }} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
          <span style={{ fontSize: 8, color: '#fff', pointerEvents: 'none', textShadow: '0 0 2px #000' }}>+</span>
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
      <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{label}</span>
      <button
        onClick={() => onChange(!value)}
        style={{
          width: 44, height: 24, borderRadius: 12, border: 'none', padding: 2,
          background: value ? 'var(--accent-dynamic)' : 'rgba(255,255,255,0.15)',
          display: 'flex', alignItems: 'center', justifyContent: value ? 'flex-end' : 'flex-start',
          transition: 'background .2s ease',
          cursor: 'pointer',
        }}
      >
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
        <input
          type="range" min={min} max={max} value={value} step={1}
          onChange={e => onChange(parseInt(e.target.value))}
          style={{
            width: '100%', margin: 0, appearance: 'none', WebkitAppearance: 'none', background: 'transparent', position: 'relative', zIndex: 2,
          }}
        />
        <div style={{
          position: 'absolute', left: 0, right: 0, top: '50%', transform: 'translateY(-50%)', height: 5, borderRadius: 3,
          background: gradient,
          pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', height: 5, borderRadius: 3,
          width: `${pct}%`, background: 'rgba(255,255,255,0.25)', pointerEvents: 'none',
        }} />
      </div>
    </div>
  );
}

function Row({ track, active, onPlay }) {
  const c = track.cover || `https://picsum.photos/seed/${track.id}/400/400`;
  return (
    <div className={`glass-row ${active?'is-active':''}`} onClick={()=>onPlay(track)}>
      <div style={{width:42,height:42,borderRadius:8,overflow:'hidden',flexShrink:0,background:active?'#222':'#111'}}>
        <img src={c} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}} />
      </div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:13,fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',color:active?'var(--accent-dynamic)':'var(--text-primary)'}}>{track.title}</div>
        <div style={{fontSize:11,color:'var(--text-secondary)',marginTop:1}}>{track.artist}{track.album?` · ${track.album}`:''}</div>
      </div>
      <span style={{fontSize:11,color:'var(--text-muted)',flexShrink:0}}>{track.duration?fmt(track.duration):''}</span>
    </div>
  );
}

function Sheet({ open, onClose, title, children, h='78vh' }) {
  if(!open) return null;
  return (
    <div style={{position:'absolute',inset:0,zIndex:200,background:'rgba(0,0,0,0.6)',backdropFilter:'blur(4px)',animation:'fadeIn .2s ease both',display:'flex',alignItems:'flex-end'}} onClick={onClose}>
      <div className="glass-panel animate-slideUp" onClick={e=>e.stopPropagation()} style={{width:'100%',maxHeight:h,borderRadius:'20px 20px 0 0',borderBottom:'none',display:'flex',flexDirection:'column',overflow:'hidden',background:'rgba(0,0,0,0.85)'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'14px 16px 12px',borderBottom:'1px solid rgba(255,255,255,0.06)'}}>
          <span style={{fontSize:14,fontWeight:700}}>{title}</span>
          <button onClick={onClose} className="glass-button" style={{width:30,height:30,borderRadius:9,display:'flex',alignItems:'center',justifyContent:'center'}}><X size={15} color="var(--text-secondary)"/></button>
        </div>
        <div style={{flex:1,overflowY:'auto',padding:'6px 10px 24px'}}>{children}</div>
      </div>
    </div>
  );
}

export default function Player({ onProfile }) {
  const { currentTrack, isPlaying, currentTime, duration, volume, playMode, playlist, togglePlay, next, prev, seek, setVolume, toggleMode, playTrack, lyrics, currentLyric, isLoadingUrl, error, clearError, setError } = usePlayerStore();
  const { userInfo, isLoggedIn } = useAuthStore();
  const [sq, setSq] = useState(false); const [qo, setQo] = useState(false); const [viz, setViz] = useState(false);
  const [query, setQuery] = useState(''); const [results, setResults] = useState([]); const [searching, setSearching] = useState(false); const st = useRef(null);
  const [vm, setVm] = useState(()=>{try{return localStorage.getItem('sonus_viz_mode')||'ring'}catch{return'ring'}});
  const [ac, setAc] = useState(()=>{try{return localStorage.getItem('sonus_accent')||'#4FC3F7'}catch{return'#4FC3F7'}});
  const [lyricBg, setLyricBg] = useState(()=>{try{return localStorage.getItem('sonus_lyric_bg')!=='false'}catch{return true}});
  const [v3r, setV3r] = useState(false);
  const pr = useRef(null); const [sk, setSk] = useState(false);

  const pct = duration? (currentTime/duration)*100 : 0;
  const mi = playMode==='single'?<Repeat1 size={16}/>:playMode==='random'?<Shuffle size={16}/>:<Repeat size={16}/>;
  const mc = playMode==='list'?'var(--text-secondary)':'var(--accent-dynamic)';
  const av = userInfo?.avatar;

  useEffect(()=>{ document.documentElement.style.setProperty('--accent-dynamic',ac); },[ac]);
  useEffect(()=>{ if(error){ const t=setTimeout(clearError,5000); return ()=>clearTimeout(t); } },[error,clearError]);

  const doSearch = async kw => { if(!kw.trim()){setResults([]);return;} setSearching(true); try{setResults(await music.search(kw,30)||[])}catch(e){setError('搜索失败')} finally{setSearching(false)}; };
  const onQ = v => { setQuery(v); if(st.current)clearTimeout(st.current); if(!v.trim()){setResults([]);return;} st.current=setTimeout(()=>doSearch(v),350); };

  const hp = (e) => { if(!pr.current||!duration||!isFinite(duration))return; setSk(true); const up=cx=>{const r=pr.current.getBoundingClientRect();seek(Math.max(0,Math.min(1,(cx-r.left)/r.width))*duration)}; up(e.clientX); const mv=ev=>up(ev.touches?ev.touches[0].clientX:ev.clientX); const uu=()=>{setSk(false);document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',uu);document.removeEventListener('touchmove',mv);document.removeEventListener('touchend',uu)}; document.addEventListener('mousemove',mv);document.addEventListener('mouseup',uu);document.addEventListener('touchmove',mv);document.addEventListener('touchend',uu); };

  return (
    <div style={{height:'100%',position:'relative',overflow:'hidden',background:'#000'}}>
      {/* 背景歌词 + 可视化 */}
      <div style={{position:'absolute',inset:0}}>
        {lyricBg && <LyricBackground lyric={currentLyric || ''} />}
        {vm==='3d'?<Suspense><Visualizer3D accent={ac} cover={currentTrack?.cover||''} onReady={()=>setV3r(true)}/></Suspense>:<Visualizer isPlaying={isPlaying} mode={vm} accent={ac}/>}
      </div>

      {/* 加载 */}
      {isLoadingUrl && <div style={{position:'absolute',top:'50%',left:'50%',transform:'translate(-50%,-50%)',zIndex:10,display:'flex',alignItems:'center',gap:10}}><Loader2 size={20} className="spin-icon" color="var(--accent-dynamic)"/><span style={{fontSize:12,color:'var(--text-secondary)'}}>加载音源…</span></div>}

      {/* 顶部栏 */}
      <div style={{position:'absolute',top:0,left:0,right:0,padding:'calc(12px + var(--safe-top)) 14px 10px',display:'flex',alignItems:'center',justifyContent:'space-between',zIndex:50,gap:8}}>
        <button onClick={onProfile} className="glass-button" style={{width:36,height:36,borderRadius:10,display:'flex',alignItems:'center',justifyContent:'center',overflow:'hidden'}}>
          {isLoggedIn&&av?<img src={av} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>:<span style={{fontSize:12,fontWeight:700,color:'var(--text-secondary)'}}>{isLoggedIn?'我':'登'}</span>}
        </button>
        <div style={{flex:1,textAlign:'center',minWidth:0}}>
          <div style={{fontSize:13,fontWeight:700,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{currentTrack?.title||'Sonus'}</div>
          <div style={{fontSize:10,color:'var(--text-secondary)',marginTop:1}}>{currentTrack?.artist||'搜索开始播放'}</div>
        </div>
        <div style={{display:'flex',gap:6}}>
          <button onClick={()=>setSq(true)} className="glass-button" style={{width:36,height:36,borderRadius:10,display:'flex',alignItems:'center',justifyContent:'center'}}><Search size={16}/></button>
          <button onClick={()=>setViz(true)} className="glass-button" style={{width:36,height:36,borderRadius:10,display:'flex',alignItems:'center',justifyContent:'center',position:'relative'}}>
            <SlidersHorizontal size={16}/>
            <span style={{position:'absolute',bottom:4,right:4,width:7,height:7,borderRadius:'50%',background:ac,boxShadow:`0 0 4px ${ac}`}}/>
          </button>
        </div>
      </div>

      {/* 底部控制 */}
      <div className="glass-panel" style={{position:'absolute',bottom:0,left:0,right:0,zIndex:50,padding:'10px 14px calc(10px + var(--safe-bottom))',borderRadius:'18px 18px 0 0',borderBottom:'none',background:'rgba(0,0,0,0.82)'}}>
        {/* 进度 */}
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
          <span style={{fontSize:10,color:'var(--text-secondary)',minWidth:30,textAlign:'right'}}>{fmt(currentTime)}</span>
          <div ref={pr} onMouseDown={hp} onTouchStart={hp} style={{flex:1,height:14,display:'flex',alignItems:'center',cursor:'pointer',touchAction:'none'}}>
            <div style={{width:'100%',height:3,borderRadius:3,background:'rgba(255,255,255,0.1)',position:'relative',overflow:'visible'}}>
              <div style={{width:`${pct}%`,height:'100%',borderRadius:3,background:ac,boxShadow:`0 0 6px ${ac}`,transition:sk?'none':'width .15s linear'}}/>
              <div style={{position:'absolute',left:`calc(${pct}% - 4px)`,top:'50%',transform:'translateY(-50%)',width:9,height:9,borderRadius:'50%',background:'#fff',opacity:sk?1:0.4,transition:'opacity .2s'}}/>
            </div>
          </div>
          <span style={{fontSize:10,color:'var(--text-secondary)',minWidth:30}}>{fmt(duration)}</span>
        </div>
        {/* 按钮 */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:6}}>
          <button onClick={toggleMode} className="glass-button" style={{width:34,height:34,borderRadius:9,display:'flex',alignItems:'center',justifyContent:'center',color:mc}}>{mi}</button>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <button onClick={prev} className="glass-button" style={{width:38,height:38,borderRadius:10,display:'flex',alignItems:'center',justifyContent:'center'}}><SkipBack size={20} fill="currentColor"/></button>
            <button onClick={togglePlay} className="glass-button-accent" style={{width:50,height:50,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',background:ac,boxShadow:`0 0 20px ${ac}40`}}>
              {isPlaying?<Pause size={22} fill="#000"/>:<Play size={22} fill="#000" style={{marginLeft:2}}/>}
            </button>
            <button onClick={next} className="glass-button" style={{width:38,height:38,borderRadius:10,display:'flex',alignItems:'center',justifyContent:'center'}}><SkipForward size={20} fill="currentColor"/></button>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:4,minWidth:80,justifyContent:'flex-end'}}>
            <Volume2 size={14} color="var(--text-secondary)"/>
            <input type="range" min="0" max="1" step="0.01" value={volume} onChange={e=>setVolume(parseFloat(e.target.value))} style={{width:50,accentColor:ac}}/>
            <button onClick={()=>setQo(true)} className="glass-button" style={{width:32,height:32,borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center'}}><ListMusic size={16} color="var(--text-secondary)"/></button>
          </div>
        </div>
      </div>

      {/* 错误 */}
      {error && <div className="glass-panel" style={{position:'absolute',top:'calc(56px + var(--safe-top))',left:'50%',transform:'translateX(-50%)',zIndex:300,padding:'8px 16px',borderRadius:12,fontSize:12,color:'#FCA5A5',background:'rgba(180,40,40,0.2)',borderColor:'rgba(248,113,113,0.3)'}}>{error}</div>}

      {/* 搜索 Sheet */}
      <Sheet open={sq} onClose={()=>setSq(false)} title="搜索">
        <div style={{padding:'0 2px 8px'}}>
          <div className="glass-input-wrap" style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px'}}>
            <Search size={14} color="var(--text-secondary)"/>
            <input value={query} onChange={e=>onQ(e.target.value)} placeholder="歌曲、歌手…" autoFocus style={{flex:1,fontSize:13}}/>
            {query&&<button onClick={()=>{setQuery('');setResults([]);}}><X size={14} color="var(--text-secondary)"/></button>}
          </div>
        </div>
        {searching&&results.length===0?<div style={{display:'flex',justifyContent:'center',padding:24}}><Loader2 size={16} className="spin-icon" color="var(--text-secondary)"/></div>
        :results.length===0?<div style={{textAlign:'center',padding:24,color:'var(--text-muted)',fontSize:12}}>{query?'无结果':'输入关键词'}</div>
        :results.map(t=><Row key={t.id} track={t} active={currentTrack?.id===t.id} onPlay={tr=>{playTrack(tr);setSq(false);}}/>)}
      </Sheet>

      {/* 队列 Sheet */}
      <Sheet open={qo} onClose={()=>setQo(false)} title={`队列 · ${playlist.length}`}>
        {playlist.length===0?<div style={{textAlign:'center',padding:24,color:'var(--text-muted)',fontSize:12}}>搜索添加歌曲</div>
        :playlist.map(t=><Row key={t.id} track={t} active={currentTrack?.id===t.id} onPlay={tr=>{playTrack(tr);setQo(false);}}/>)}
      </Sheet>

      {/* 可视化设置 Sheet */}
      <Sheet open={viz} onClose={()=>setViz(false)} title="设置" h="auto">
        <div style={{display:'flex',flexDirection:'column',gap:16,padding:'4px 2px'}}>
          <div>
            <div style={{fontSize:11,color:'var(--text-secondary)',marginBottom:8}}>可视化</div>
            <div style={{display:'flex',gap:8}}>
              {VIZ_MODES.map(m=><button key={m.key} onClick={()=>{setVm(m.key);try{localStorage.setItem('sonus_viz_mode',m.key)}catch{}}} className={`glass-button${vm===m.key?' is-active':''}`} style={{flex:1,padding:'12px 4px',borderRadius:12,display:'flex',flexDirection:'column',alignItems:'center',gap:4,fontSize:11}}><span style={{fontSize:18}}>{m.icon}</span>{m.label}</button>)}
            </div>
          </div>
          <ColorPicker value={ac} onChange={setAc}/>
          <Toggle label="歌词背景" value={lyricBg} onChange={v=>{setLyricBg(v);try{localStorage.setItem('sonus_lyric_bg',String(v))}catch{}}}/>
        </div>
      </Sheet>
    </div>
  );
}
