import { useState, useRef, useEffect, lazy, Suspense } from 'react';
import { Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, ListMusic, Volume2, Search, X, Loader2, SlidersHorizontal, ChevronDown, ChevronUp } from 'lucide-react';
import { usePlayerStore } from '../store/usePlayerStore';
import { useAuthStore } from '../store/useAuthStore';
import { music } from '../api/music';
import Visualizer from '../components/Visualizer';
import FloatingLyrics from '../components/FloatingLyrics';

const Visualizer3D = lazy(() => import('../components/Visualizer3D'));

function fmt(s) { if (!s||isNaN(s)) return '0:00'; const m=Math.floor(s/60), sec=Math.floor(s%60); return `${m}:${sec.toString().padStart(2,'0')}`; }

const VIZ_MODES = [{ key:'ring',label:'环',icon:'◯'},{ key:'wave',label:'波',icon:'〜'},{ key:'3d',label:'3D',icon:'◆'}];
const PRESETS = ['#4FC3F7','#A78BFA','#FF6B9D','#4ADE80','#FB923C','#C0C0C0'];

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

// 居中弹层（毛玻璃）
function Sheet({ open, onClose, title, children, h='80vh' }) {
  if(!open) return null;
  return (
    <div style={{position:'absolute',inset:0,zIndex:200,background:'rgba(0,0,0,0.2)',backdropFilter:'blur(10px)',WebkitBackdropFilter:'blur(10px)',animation:'fadeIn .2s ease both',display:'flex',alignItems:'center',justifyContent:'center'}} onClick={onClose}>
      <div className="glass-panel-strong animate-slideUp" onClick={e=>e.stopPropagation()} style={{width:'70%',maxWidth:520,maxHeight:h,borderRadius:'20px',display:'flex',flexDirection:'column',overflow:'hidden'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 16px 10px',borderBottom:'1px solid rgba(255,255,255,0.08)'}}>
          <span style={{fontSize:14,fontWeight:700}}>{title}</span>
          <button onClick={onClose} className="glass-button" style={{width:30,height:30,borderRadius:9,display:'flex',alignItems:'center',justifyContent:'center'}}><X size={15} color="var(--text-secondary)"/></button>
        </div>
        <div style={{flex:1,overflowY:'auto',padding:'6px 10px 20px'}}>{children}</div>
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
  const [panelOpen, setPanelOpen] = useState(true);  // 控制面板展开/收起
  const pr = useRef(null); const [sk, setSk] = useState(false);

  const pct = duration? (currentTime/duration)*100 : 0;
  const mi = playMode==='single'?<Repeat1 size={15}/>:playMode==='random'?<Shuffle size={15}/>:<Repeat size={15}/>;
  const mc = playMode==='list'?'var(--text-secondary)':'var(--accent-dynamic)';
  const av = userInfo?.avatar;

  useEffect(()=>{ document.documentElement.style.setProperty('--accent-dynamic',ac); },[ac]);
  useEffect(()=>{ if(error){ const t=setTimeout(clearError,5000); return ()=>clearTimeout(t); } },[error,clearError]);

  const doSearch = async kw => { if(!kw.trim()){setResults([]);return;} setSearching(true); try{setResults(await music.search(kw,30)||[])}catch(e){setError('搜索失败')} finally{setSearching(false)}; };
  const onQ = v => { setQuery(v); if(st.current)clearTimeout(st.current); if(!v.trim()){setResults([]);return;} st.current=setTimeout(()=>doSearch(v),350); };

  const hp = (e) => { if(!pr.current||!duration||!isFinite(duration))return; setSk(true); const up=cx=>{const r=pr.current.getBoundingClientRect();seek(Math.max(0,Math.min(1,(cx-r.left)/r.width))*duration)}; up(e.clientX); const mv=ev=>up(ev.touches?ev.touches[0].clientX:ev.clientX); const uu=()=>{setSk(false);document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',uu);document.removeEventListener('touchmove',mv);document.removeEventListener('touchend',uu)}; document.addEventListener('mousemove',mv);document.addEventListener('mouseup',uu);document.addEventListener('touchmove',mv);document.addEventListener('touchend',uu); };

  return (
    <div style={{height:'100%',position:'relative',overflow:'hidden',background:'#000'}}>
      {/* ===== 可视化区（撑满） ===== */}
      <div style={{position:'absolute',inset:0,overflow:'hidden'}}>
        <FloatingLyrics lyrics={lyrics} isPlaying={isPlaying}/>
        {vm==='3d'?<Suspense><Visualizer3D accent={ac} cover={currentTrack?.cover||''} onReady={()=>{}}/></Suspense>:<Visualizer isPlaying={isPlaying} mode={vm} accent={ac}/>}
      </div>

      {isLoadingUrl && <div style={{position:'absolute',top:'50%',left:'50%',transform:'translate(-50%,-50%)',zIndex:10,display:'flex',alignItems:'center',gap:10}}><Loader2 size={20} className="spin-icon" color="var(--accent-dynamic)"/><span style={{fontSize:12,color:'var(--text-secondary)'}}>加载音源…</span></div>}

      {/* 顶部栏（毛玻璃） */}
      <div className="glass-panel" style={{position:'absolute',top:'calc(8px + var(--safe-top))',left:'calc(12px + var(--safe-left))',right:'calc(12px + var(--safe-right))',padding:'6px 10px',borderRadius:14,display:'flex',alignItems:'center',justifyContent:'space-between',zIndex:50,gap:8}}>
        <button onClick={onProfile} className="glass-button" style={{width:34,height:34,borderRadius:10,display:'flex',alignItems:'center',justifyContent:'center',overflow:'hidden'}}>
          {isLoggedIn&&av?<img src={av} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>:<span style={{fontSize:11,fontWeight:700,color:'var(--text-secondary)'}}>{isLoggedIn?'我':'登'}</span>}
        </button>
        <div style={{fontSize:13,fontWeight:700,flex:1,textAlign:'center',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:'#fff'}}>
          {currentTrack?`${currentTrack.title} · ${currentTrack.artist}`:'Sonus'}
        </div>
        <div style={{display:'flex',gap:5}}>
          <button onClick={()=>setSq(true)} className="glass-button" style={{width:34,height:34,borderRadius:10,display:'flex',alignItems:'center',justifyContent:'center'}}><Search size={15}/></button>
          <button onClick={()=>setViz(true)} className="glass-button" style={{width:34,height:34,borderRadius:10,display:'flex',alignItems:'center',justifyContent:'center',position:'relative'}}>
            <SlidersHorizontal size={15}/>
            <span style={{position:'absolute',bottom:4,right:4,width:6,height:6,borderRadius:'50%',background:ac,boxShadow:`0 0 4px ${ac}`}}/>
          </button>
        </div>
      </div>

      {/* 当前歌词 */}
      <div style={{position:'absolute',top:'42%',left:0,right:0,display:'flex',justifyContent:'center',padding:'0 24px',zIndex:10,pointerEvents:'none'}}>
        <p style={{fontSize:20,fontWeight:700,color:'#fff',textAlign:'center',opacity:currentLyric?1:0,transition:'opacity .3s',textShadow:'0 2px 16px rgba(0,0,0,0.95)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:'70%'}}>{currentLyric||' '}</p>
      </div>

      {/* 错误提示 */}
      {error && <div className="glass-panel" style={{position:'absolute',top:'calc(60px + var(--safe-top))',left:'50%',transform:'translateX(-50%)',zIndex:300,padding:'8px 16px',borderRadius:12,fontSize:12,color:'#FCA5A5',background:'rgba(180,40,40,0.2)',borderColor:'rgba(248,113,113,0.3)'}}>{error}</div>}

      {/* ===== 底部控制浮窗（超紧凑，可收起为右下角小圆按钮）===== */}
      {panelOpen ? (
        <div className="glass-panel-strong" style={{
          position:'absolute',
          bottom:'calc(10px + var(--safe-bottom))',
          left:'calc(16px + var(--safe-left))',
          right:'calc(16px + var(--safe-right))',
          borderRadius:16,
          padding:'8px 14px',
          zIndex:100,
        }}>
          {/* 第一行：进度条 */}
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
            <span style={{fontSize:9,color:'var(--text-secondary)',flexShrink:0,width:32,textAlign:'right'}}>{fmt(currentTime)}</span>
            <div ref={pr} onMouseDown={hp} onTouchStart={hp} style={{flex:1,height:12,display:'flex',alignItems:'center',cursor:'pointer',touchAction:'none'}}>
              <div style={{width:'100%',height:3,borderRadius:3,background:'rgba(255,255,255,0.12)',position:'relative',overflow:'visible'}}>
                <div style={{width:`${pct}%`,height:'100%',borderRadius:3,background:ac,boxShadow:`0 0 6px ${ac}`,transition:sk?'none':'width .15s linear'}}/>
                <div style={{position:'absolute',left:`calc(${pct}% - 4px)`,top:'50%',transform:'translateY(-50%)',width:8,height:8,borderRadius:'50%',background:'#fff',opacity:sk?1:0.4,transition:'opacity .2s'}}/>
              </div>
            </div>
            <span style={{fontSize:9,color:'var(--text-secondary)',flexShrink:0,width:32}}>{fmt(duration)}</span>
          </div>
          {/* 第二行：播放控制（紧凑横排） */}
          <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:6}}>
            <button onClick={toggleMode} className="glass-button" style={{width:30,height:30,borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',color:mc,flexShrink:0}} title="播放模式">{mi}</button>
            <button onClick={prev} className="glass-button" style={{width:34,height:34,borderRadius:9,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><SkipBack size={18} fill="currentColor"/></button>
            <button onClick={togglePlay} className="glass-button-accent" style={{width:42,height:42,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',background:ac,boxShadow:`0 0 16px ${ac}55`,flexShrink:0}}>
              {isPlaying?<Pause size={20} fill="#000"/>:<Play size={20} fill="#000" style={{marginLeft:2}}/>}
            </button>
            <button onClick={next} className="glass-button" style={{width:34,height:34,borderRadius:9,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><SkipForward size={18} fill="currentColor"/></button>
            <button onClick={()=>setQo(true)} className="glass-button" style={{width:30,height:30,borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}} title="队列"><ListMusic size={14} color="var(--text-secondary)"/></button>
            <button onClick={()=>setPanelOpen(false)} className="glass-button" style={{width:30,height:30,borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}} title="收起"><ChevronDown size={14}/></button>
          </div>
        </div>
      ) : (
        /* 收起态：右下角小圆播放按钮 */
        <div style={{position:'absolute',bottom:'calc(16px + var(--safe-bottom))',right:'calc(16px + var(--safe-right))',zIndex:100,display:'flex',gap:8}}>
          <button onClick={()=>setPanelOpen(true)} className="glass-panel-strong" style={{width:44,height:44,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',border:'none',cursor:'pointer',color:'var(--text-secondary)'}} title="展开">
            <ChevronUp size={18}/>
          </button>
          <button onClick={togglePlay} className="glass-button-accent" style={{width:44,height:44,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',background:ac,boxShadow:`0 0 16px ${ac}55`}} title="播放/暂停">
            {isPlaying?<Pause size={20} fill="#000"/>:<Play size={20} fill="#000" style={{marginLeft:2}}/>}
          </button>
        </div>
      )}

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

      {/* 设置 Sheet */}
      <Sheet open={viz} onClose={()=>setViz(false)} title="设置" h="auto">
        <div style={{display:'flex',flexDirection:'column',gap:16,padding:'4px 2px'}}>
          <div>
            <div style={{fontSize:11,color:'var(--text-secondary)',marginBottom:8}}>可视化</div>
            <div style={{display:'flex',gap:8}}>
              {VIZ_MODES.map(m=><button key={m.key} onClick={()=>{setVm(m.key);try{localStorage.setItem('sonus_viz_mode',m.key)}catch{}}} className={`glass-button${vm===m.key?' is-active':''}`} style={{flex:1,padding:'12px 4px',borderRadius:12,display:'flex',flexDirection:'column',alignItems:'center',gap:4,fontSize:11}}><span style={{fontSize:18}}>{m.icon}</span>{m.label}</button>)}
            </div>
            {vm==='3d' && <div style={{fontSize:10,color:'var(--text-muted)',marginTop:6,textAlign:'center',lineHeight:1.5}}>3D 模式：双指捏合缩放，双指划拉旋转</div>}
          </div>
          <div>
            <div style={{fontSize:11,color:'var(--text-secondary)',marginBottom:8,display:'flex',alignItems:'center',gap:6}}>
              <Volume2 size={12}/> 音量
            </div>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <input type="range" min="0" max="1" step="0.01" value={volume} onChange={e=>setVolume(parseFloat(e.target.value))} style={{flex:1,accentColor:ac,height:4}}/>
              <span style={{fontSize:11,color:'var(--text-secondary)',width:32}}>{Math.round(volume*100)}%</span>
            </div>
          </div>
          <div>
            <div style={{fontSize:11,color:'var(--text-secondary)',marginBottom:8}}>主题色</div>
            <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
              {PRESETS.map(c=><button key={c} onClick={()=>{setAc(c);try{localStorage.setItem('sonus_accent',c)}catch{}}} style={{width:26,height:26,borderRadius:'50%',background:c,border:ac===c?'2px solid #fff':'2px solid rgba(255,255,255,0.15)',cursor:'pointer',boxShadow:ac===c?`0 0 8px ${c}`:'none',transition:'.2s'}}/>)}
              <label style={{width:26,height:26,borderRadius:'50%',cursor:'pointer',background:'conic-gradient(red,orange,yellow,green,cyan,blue,purple,red)',border:'2px solid rgba(255,255,255,0.2)',display:'flex',alignItems:'center',justifyContent:'center',position:'relative',overflow:'hidden'}}>
                <input type="color" value={ac} onChange={e=>{setAc(e.target.value);try{localStorage.setItem('sonus_accent',e.target.value)}catch{}}} style={{position:'absolute',inset:0,opacity:0,cursor:'pointer'}}/>
                <span style={{fontSize:8,color:'#fff',pointerEvents:'none',textShadow:'0 0 2px #000'}}>+</span>
              </label>
            </div>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
