import { useEffect, useState } from 'react';

// 估算当前行演唱进度（标准 LRC 只有行时间戳，按行时长线性分配）
function estimateLineProgress(lyrics, currentTime) {
  if (!lyrics?.length || currentTime == null) return 0;
  let lineIndex = -1;
  for (let i = 0; i < lyrics.length; i++) {
    if (lyrics[i].time <= currentTime) lineIndex = i;
    else break;
  }
  if (lineIndex < 0) return 0;

  const line = lyrics[lineIndex];
  const nextTime = lyrics[lineIndex + 1]?.time ?? (line.time + 5);
  const duration = Math.max(0.5, nextTime - line.time);
  return Math.max(0, Math.min(1, (currentTime - line.time) / duration));
}

// 中央歌词：一行大字，主题色；已唱部分被一道白色高光从左到右平滑扫过
export default function LyricScroll({ currentLyric = '', lyrics = [], currentTime = 0, accent = '#00F5D4' }) {
  const [display, setDisplay] = useState(currentLyric);
  const [phase, setPhase] = useState('in');

  useEffect(() => {
    if (currentLyric === display) return;
    setPhase('out');
    const t = setTimeout(() => {
      setDisplay(currentLyric);
      setPhase('in');
    }, 140);
    return () => clearTimeout(t);
  }, [currentLyric, display]);

  const progress = estimateLineProgress(lyrics, currentTime);
  const pct = Math.round(progress * 100);
  const isEmpty = !display || display.trim() === '';

  // 已唱部分白色 + 微光，未唱部分主题色，过渡带 4% 制造扫过感
  const gradient = `linear-gradient(90deg, #fff ${pct}%, ${accent} ${Math.min(100, pct + 4)}%)`;

  return (
    <div style={{
      position: 'absolute',
      top: '50%',
      left: 0,
      right: 0,
      transform: 'translateY(-50%)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      padding: '0 44px',
      zIndex: 5,
      pointerEvents: 'none',
    }}>
      <p style={{
        fontSize: 24,
        fontWeight: 800,
        lineHeight: 1.55,
        textAlign: 'center',
        maxWidth: 'min(720px, 88vw)',
        opacity: phase === 'in' ? 1 : 0,
        transform: phase === 'in' ? 'translateY(0) scale(1)' : 'translateY(14px) scale(0.98)',
        transition: 'opacity .24s cubic-bezier(.16,1,.3,1), transform .24s cubic-bezier(.16,1,.3,1)',
        background: isEmpty ? accent : gradient,
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
        textShadow: `0 2px 18px rgba(0,0,0,0.9)`,
        whiteSpace: 'pre-wrap',
        margin: 0,
        filter: phase === 'in' ? 'none' : 'blur(2px)',
      }}>
        {display || ' '}
      </p>
      {/* 扫过高光层，增强氛围 */}
      {!isEmpty && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: '50%',
            left: `${pct}%`,
            transform: 'translate(-50%, -50%)',
            width: 60,
            height: 60,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${accent}40 0%, transparent 70%)`,
            opacity: phase === 'in' ? 0.8 : 0,
            transition: 'left 0.08s linear, opacity 0.24s ease',
            pointerEvents: 'none',
            zIndex: -1,
          }}
        />
      )}
    </div>
  );
}
