import { useEffect, useState } from 'react';

// 将歌词拆分为演唱单位：CJK 每个字独立，非 CJK 按空格分词
function tokenize(text) {
  if (!text) return [];
  const tokens = [];
  let word = '';
  for (const ch of text) {
    const isCJK = /[\u4e00-\u9fff\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(ch);
    if (isCJK) {
      if (word) tokens.push(word);
      if (/\s/.test(ch)) tokens.push('\u00A0');
      else tokens.push(ch);
      word = '';
    } else if (/\s/.test(ch)) {
      if (word) { tokens.push(word); word = ''; }
      tokens.push('\u00A0');
    } else {
      word += ch;
    }
  }
  if (word) tokens.push(word);
  return tokens;
}

// 估算当前唱到的 token 索引（0..tokens.length）
function estimateTokenProgress(lyrics, currentTime) {
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

// 中央歌词：仅当前正在唱的字/词高亮放大；唱完立即恢复
export default function LyricScroll({ currentLyric = '', lyrics = [], currentTime = 0, accent = '#00F5D4' }) {
  const [display, setDisplay] = useState(currentLyric);
  const [phase, setPhase] = useState('in');

  useEffect(() => {
    if (currentLyric === display) return;
    setPhase('out');
    const t = setTimeout(() => {
      setDisplay(currentLyric);
      setPhase('in');
    }, 120);
    return () => clearTimeout(t);
  }, [currentLyric, display]);

  const tokens = tokenize(display);
  const progress = estimateTokenProgress(lyrics, currentTime);
  const rawIdx = progress * tokens.length;
  const currentIndex = Math.min(tokens.length - 1, Math.floor(rawIdx));
  const local = rawIdx - currentIndex; // 0~1 在当前 token 内

  // 当前 token 高亮/放大强度：进入后快速升起，唱到中间最大，末尾回落
  const peak = local < 0.3 ? local / 0.3 : local > 0.7 ? (1 - local) / 0.3 : 1;

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
        transform: phase === 'in' ? 'translateY(0)' : 'translateY(12px)',
        transition: 'opacity .22s ease, transform .22s ease',
        color: accent,
        textShadow: `0 2px 16px rgba(0,0,0,0.85)`,
        whiteSpace: 'pre-wrap',
        margin: 0,
      }}>
        {tokens.length === 0 ? (
          <span> </span>
        ) : (
          tokens.map((token, i) => {
            const isCurrent = i === currentIndex;
            const intensity = isCurrent ? peak : 0;
            const scale = 1 + intensity * 0.13;
            const color = isCurrent ? '#fff' : accent;
            return (
              <span
                key={i}
                style={{
                  display: 'inline-block',
                  color,
                  transform: `scale(${scale})`,
                  textShadow: isCurrent
                    ? `0 0 14px ${accent}88, 0 0 28px ${accent}44`
                    : 'none',
                  transition: 'color 0.08s ease, transform 0.08s ease, text-shadow 0.08s ease',
                  marginRight: token === '\u00A0' ? '0.18em' : undefined,
                }}
              >
                {token === '\u00A0' ? ' ' : token}
              </span>
            );
          })
        )}
      </p>
    </div>
  );
}
