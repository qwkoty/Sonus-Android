import { useEffect, useRef, useState } from 'react';

// 中央歌词：只显示当前正在唱的一句，切换时有上下滑动 + 淡入淡出动画
export default function LyricScroll({ currentLyric = '', accent = '#4FC3F7' }) {
  const [display, setDisplay] = useState(currentLyric);
  const [phase, setPhase] = useState('in'); // 'in' | 'out'
  const prevRef = useRef('');

  useEffect(() => {
    if (currentLyric === display) return;
    // 先淡出旧歌词，再换新歌词淡入
    setPhase('out');
    const t = setTimeout(() => {
      setDisplay(currentLyric);
      setPhase('in');
    }, 200);
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
      padding: '0 32px',
      zIndex: 5,
      pointerEvents: 'none',
    }}>
      <p style={{
        fontSize: 18,
        fontWeight: 700,
        color: '#fff',
        textAlign: 'center',
        lineHeight: 1.5,
        maxWidth: '88vw',
        opacity: phase === 'in' ? 1 : 0,
        transform: phase === 'in' ? 'translateY(0)' : 'translateY(12px)',
        transition: 'opacity .3s ease, transform .3s ease',
        textShadow: '0 2px 12px rgba(0,0,0,0.9)',
      }}>
        {display || ' '}
      </p>
    </div>
  );
}
