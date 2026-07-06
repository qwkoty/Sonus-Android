import { useEffect, useState, useMemo } from 'react';

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

// 估算当前行内唱到的字词位置（标准 LRC 只有行时间戳，按行时长线性分配）
function estimateWordProgress(lyrics, currentTime) {
  if (!lyrics?.length || currentTime == null) return { lineIndex: -1, wordProgress: 0 };
  let lineIndex = -1;
  for (let i = 0; i < lyrics.length; i++) {
    if (lyrics[i].time <= currentTime) lineIndex = i;
    else break;
  }
  if (lineIndex < 0) return { lineIndex: -1, wordProgress: 0 };

  const line = lyrics[lineIndex];
  const nextTime = lyrics[lineIndex + 1]?.time ?? (line.time + 5);
  const duration = Math.max(0.5, nextTime - line.time);
  const progress = Math.max(0, Math.min(1, (currentTime - line.time) / duration));
  return { lineIndex, wordProgress: easeOutCubic(progress) };
}

// 中央歌词：当前行大字高亮，字词按演唱进度逐字点亮，切换时带缩放/光晕动画
export default function LyricScroll({ currentLyric = '', lyrics = [], currentTime = 0, accent = '#00F5D4' }) {
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

  const words = useMemo(() => {
    if (!display || display.trim() === '') return [];
    return display.split(/(\s+)/).filter(Boolean);
  }, [display]);

  const { wordProgress } = estimateWordProgress(lyrics, currentTime);
  const activeWordIndex = words.length ? Math.min(words.length - 1, Math.floor(wordProgress * words.length)) : -1;
  const partial = words.length ? (wordProgress * words.length) - activeWordIndex : 0;

  const show = display || ' ';
  const isEmpty = !display || display.trim() === '';

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
        lineHeight: 1.55,
        textAlign: 'center',
        maxWidth: 'min(720px, 88vw)',
        opacity: phase === 'in' ? 1 : 0,
        transform: phase === 'in' ? 'translateY(0) scale(1)' : 'translateY(18px) scale(0.96)',
        transition: 'opacity .34s cubic-bezier(.16,1,.3,1), transform .34s cubic-bezier(.16,1,.3,1)',
        textShadow: `0 2px 20px rgba(0,0,0,0.9), 0 0 40px ${accent}28, 0 0 80px ${accent}14`,
        background: 'linear-gradient(180deg, #fff 0%, rgba(255,255,255,0.85) 100%)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
        whiteSpace: 'pre-wrap',
      }}>
        {isEmpty ? (
          <span>{show}</span>
        ) : (
          words.map((word, i) => {
            const isActive = i <= activeWordIndex;
            const isCurrent = i === activeWordIndex;
            const scale = isCurrent && phase === 'in' ? 1.06 + partial * 0.04 : 1;
            return (
              <span
                key={i}
                style={{
                  display: 'inline-block',
                  marginRight: word.match(/\s/) ? '0.12em' : undefined,
                  opacity: isActive ? 1 : 0.45,
                  transform: `scale(${scale})`,
                  transition: 'opacity 0.18s ease, transform 0.18s ease',
                  textShadow: isActive
                    ? `0 0 18px ${accent}55, 0 0 36px ${accent}33`
                    : 'none',
                  filter: isActive ? 'brightness(1.05)' : 'brightness(0.85)',
                }}
              >
                {word.trim() === '' ? '\u00A0' : word}
              </span>
            );
          })
        )}
      </p>
      {/* 底层发光呼吸层，增强氛围 */}
      {!isEmpty && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 'min(680px, 86vw)',
            height: 90,
            borderRadius: '50%',
            background: `radial-gradient(ellipse at center, ${accent}14 0%, transparent 70%)`,
            opacity: phase === 'in' ? 0.7 : 0,
            animation: 'lyricGlow 2.4s ease-in-out infinite',
            pointerEvents: 'none',
            zIndex: -1,
          }}
        />
      )}
    </div>
  );
}
