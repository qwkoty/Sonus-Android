import { useEffect, useRef } from 'react';

// 歌词滚动面板：当前演唱行固定在屏幕中央，用户可上下滑动浏览
export default function LyricScroll({ lyrics = [], currentTime = 0, accent = '#4FC3F7' }) {
  const containerRef = useRef(null);
  const activeRef = useRef(null);

  // 找到当前歌词索引
  const idx = lyrics.reduce((acc, line, i) => {
    if (line.time <= currentTime) return i;
    return acc;
  }, -1);

  // 当前行变化时自动滚动到中央
  useEffect(() => {
    const container = containerRef.current;
    const active = activeRef.current;
    if (!container || !active) return;
    const containerH = container.clientHeight;
    const activeTop = active.offsetTop;
    const activeH = active.clientHeight;
    container.scrollTo({
      top: activeTop - containerH / 2 + activeH / 2,
      behavior: 'smooth',
    });
  }, [idx]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 5,
        overflowY: 'auto',
        overflowX: 'hidden',
        WebkitOverflowScrolling: 'touch',
        paddingTop: '35vh',
        paddingBottom: '35vh',
        maskImage: 'linear-gradient(to bottom, transparent 0%, black 20%, black 80%, transparent 100%)',
        WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 20%, black 80%, transparent 100%)',
      }}
    >
      {lyrics.map((line, i) => {
        const isActive = i === idx;
        const dist = Math.abs(i - idx);
        const scale = isActive ? 1 : Math.max(0.85, 1 - dist * 0.035);
        const opacity = isActive ? 1 : Math.max(0.25, 1 - dist * 0.18);
        return (
          <div
            key={i}
            ref={isActive ? activeRef : null}
            style={{
              padding: '10px 24px',
              fontSize: isActive ? 17 : 14,
              fontWeight: isActive ? 700 : 500,
              color: isActive ? accent : 'rgba(255,255,255,0.55)',
              textAlign: 'center',
              lineHeight: 1.5,
              transform: `scale(${scale})`,
              opacity,
              transition: 'all 0.3s ease',
              textShadow: isActive ? `0 0 18px ${accent}66` : 'none',
              minHeight: 28,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {line.text || '·'}
          </div>
        );
      })}
    </div>
  );
}
