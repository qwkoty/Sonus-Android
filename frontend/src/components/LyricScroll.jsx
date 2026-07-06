import { useEffect, useState, useMemo } from 'react';

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

// 估算当前行内唱到的字词位置（标准 LRC 只有行时间戳，按行时长线性分配）
function estimateWordProgress(lyrics, currentTime) {
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
  return easeOutCubic(Math.max(0, Math.min(1, (currentTime - line.time) / duration)));
}

// 中央歌词：当前行大字显示，主题色；读到的字高亮放大
export default function LyricScroll({ currentLyric = '', lyrics = [], currentTime = 0, accent = '#00F5D4' }) {
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

  const words = useMemo(() => {
    if (!display || display.trim() === '') return [];
    return display.split(/(\s+)/).filter(Boolean);
  }, [display]);

  const wordProgress = estimateWordProgress(lyrics, currentTime);
  const activeIndex = words.length ? Math.min(words.length - 1, Math.floor(wordProgress * words.length)) : -1;

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
        lineHeight: 1.6,
        textAlign: 'center',
        maxWidth: 'min(720px, 88vw)',
        opacity: phase === 'in' ? 1 : 0,
        transform: phase === 'in' ? 'translateY(0) scale(1)' : 'translateY(16px) scale(0.97)',
        transition: 'opacity .28s cubic-bezier(.16,1,.3,1), transform .28s cubic-bezier(.16,1,.3,1)',
        color: accent,
        textShadow: `0 2px 18px rgba(0,0,0,0.9), 0 0 30px ${accent}30`,
        whiteSpace: 'pre-wrap',
        margin: 0,
      }}>
        {isEmpty ? (
          <span style={{ opacity: 0 }}> </span>
        ) : (
          words.map((word, i) => {
            const active = i <= activeIndex;
            const current = i === activeIndex;
            return (
              <span
                key={i}
                style={{
                  display: 'inline-block',
                  marginRight: word.match(/\s/) ? '0.12em' : undefined,
                  color: active ? '#fff' : accent,
                  transform: current ? 'scale(1.08)' : 'scale(1)',
                  textShadow: active
                    ? `0 0 16px ${accent}, 0 0 32px ${accent}66`
                    : `0 2px 10px rgba(0,0,0,0.6)`,
                  transition: 'color 0.15s ease, transform 0.15s ease, text-shadow 0.15s ease',
                }}
              >
                {word.trim() === '' ? '\u00A0' : word}
              </span>
            );
          })
        )}
      </p>
    </div>
  );
}
