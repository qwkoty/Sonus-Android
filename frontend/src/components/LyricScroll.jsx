import { useEffect, useState } from 'react';

// 中央歌词：只显示当前正在唱的一句，切换时淡入淡出并轻微缩放
export default function LyricScroll({ currentLyric = '', accent = '#00F5D4' }) {
  const [display, setDisplay] = useState(currentLyric);
  const [phase, setPhase] = useState('in');

  useEffect(() => {
    if (currentLyric === display) return;
    setPhase('out');
    const t = setTimeout(() => {
      setDisplay(currentLyric);
      setPhase('in');
    }, 160);
    return () => clearTimeout(t);
  }, [currentLyric, display]);

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
        fontSize: 23,
        fontWeight: 800,
        lineHeight: 1.6,
        textAlign: 'center',
        maxWidth: 'min(720px, 88vw)',
        color: accent,
        textShadow: `0 2px 24px rgba(0,0,0,0.85), 0 0 40px ${accent}22`,
        whiteSpace: 'pre-wrap',
        margin: 0,
        opacity: phase === 'in' ? 1 : 0,
        transform: phase === 'in' ? 'translateY(0) scale(1)' : 'translateY(14px) scale(0.96)',
        transition: 'opacity .28s cubic-bezier(.16, 1, .3, 1), transform .28s cubic-bezier(.16, 1, .3, 1)',
        willChange: 'opacity, transform',
      }}>
        {display || ' '}
      </p>
    </div>
  );
}
