import { useEffect, useState } from 'react';

// 中央歌词：只显示当前正在唱的一句，切换时淡入淡出
export default function LyricScroll({ currentLyric = '', accent = '#00F5D4' }) {
  const [display, setDisplay] = useState(currentLyric);
  const [phase, setPhase] = useState('in');

  useEffect(() => {
    if (currentLyric === display) return;
    setPhase('out');
    const t = setTimeout(() => {
      setDisplay(currentLyric);
      setPhase('in');
    }, 180);
    return () => clearTimeout(t);
  }, [currentLyric, display]);

  const show = display || ' ';
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
        fontSize: 22,
        fontWeight: 800,
        lineHeight: 1.45,
        textAlign: 'center',
        maxWidth: 'min(720px, 88vw)',
        opacity: phase === 'in' ? 1 : 0,
        transform: phase === 'in' ? 'translateY(0) scale(1)' : 'translateY(14px) scale(0.985)',
        transition: 'opacity .32s cubic-bezier(.16,1,.3,1), transform .32s cubic-bezier(.16,1,.3,1)',
        textShadow: `0 2px 18px rgba(0,0,0,0.95), 0 0 34px ${accent}22`,
        background: 'linear-gradient(180deg, #fff 0%, rgba(255,255,255,0.88) 100%)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
      }}>
        {show}
      </p>
    </div>
  );
}
