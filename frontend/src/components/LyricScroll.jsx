import { useMemo } from 'react';

// CJK 单字拆分，英文按空格分词，空格保留占位用于间距
function tokenize(text) {
  if (!text) return [];
  const tokens = [];
  let word = '';
  for (const ch of text) {
    const isCJK = /[\u4e00-\u9fff\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(ch);
    if (isCJK) {
      if (word) tokens.push(word);
      tokens.push(ch);
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

// 中央歌词：当前整句中正在唱的字/词高亮放大，唱完恢复主题色
export default function LyricScroll({ currentLyric = '', lyrics = [], currentTime = 0, accent = '#00F5D4' }) {
  const { line, lineIndex } = useMemo(() => {
    if (!lyrics?.length) return { line: null, lineIndex: -1 };
    let idx = -1;
    for (let i = 0; i < lyrics.length; i++) {
      if (lyrics[i].time <= currentTime) idx = i;
      else break;
    }
    return { line: idx >= 0 ? lyrics[idx] : null, lineIndex: idx };
  }, [lyrics, currentTime]);

  const text = line?.text || currentLyric || '';
  const tokens = useMemo(() => tokenize(text), [text]);

  const { currentIndex, intensity } = useMemo(() => {
    if (!line || tokens.length === 0) return { currentIndex: -1, intensity: 0 };
    const next = lyrics[lineIndex + 1];
    const lineDuration = next
      ? Math.max(0.5, next.time - line.time)
      : Math.max(2, tokens.length * 0.25);
    const elapsed = Math.max(0, currentTime - line.time);
    const tokenDuration = lineDuration / tokens.length;
    const idx = Math.min(tokens.length - 1, Math.floor(elapsed / tokenDuration));
    const progress = Math.min(1, Math.max(0, (elapsed - idx * tokenDuration) / tokenDuration));
    return { currentIndex: idx, intensity: progress };
  }, [line, lineIndex, lyrics, tokens.length, currentTime]);

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
        color: accent,
        margin: 0,
      }}>
        {tokens.length > 0 ? tokens.map((token, i) => {
          const isCurrent = i === currentIndex;
          const scale = isCurrent ? 1 + intensity * 0.13 : 1;
          return (
            <span
              key={i}
              style={{
                display: 'inline-block',
                color: isCurrent ? '#fff' : accent,
                transform: `scale(${scale})`,
                textShadow: isCurrent
                  ? `0 0 14px ${accent}88, 0 0 28px ${accent}44`
                  : 'none',
                marginRight: token === '\u00A0' ? '0.18em' : undefined,
                transition: 'color 0.04s ease, text-shadow 0.04s ease',
                willChange: 'transform',
              }}
            >
              {token === '\u00A0' ? ' ' : token}
            </span>
          );
        }) : ' '}
      </p>
    </div>
  );
}
