import { useEffect, useRef, useState } from 'react';

// 歌词背景：把当前歌词以大字号淡淡地铺在背景中央
// 随歌曲进度切换时淡入淡出，不抢视觉焦点
export default function LyricBackground({ lyric = '' }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const lyricRef = useRef(lyric);
  const [displayLyric, setDisplayLyric] = useState(lyric);
  const alphaRef = useRef(1);
  const targetAlphaRef = useRef(1);

  useEffect(() => {
    lyricRef.current = lyric;
    if (lyric && lyric !== displayLyric) {
      targetAlphaRef.current = 0;
      const t = setTimeout(() => {
        setDisplayLyric(lyric);
        targetAlphaRef.current = 1;
      }, 250);
      return () => clearTimeout(t);
    }
    if (!lyric) targetAlphaRef.current = 0;
  }, [lyric, displayLyric]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let w, h, dpr;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.width = canvas.offsetWidth * dpr;
      h = canvas.height = canvas.offsetHeight * dpr;
    };
    resize();
    window.addEventListener('resize', resize);

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      alphaRef.current += (targetAlphaRef.current - alphaRef.current) * 0.08;
      if (alphaRef.current < 0.005 || !displayLyric) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const baseSize = Math.max(18, Math.min(w, h) / 10);
      ctx.font = `700 ${baseSize}px Inter, sans-serif`;

      // 超大模糊背景字
      ctx.globalAlpha = alphaRef.current * 0.12;
      ctx.fillStyle = '#fff';
      ctx.shadowColor = 'rgba(255,255,255,0.35)';
      ctx.shadowBlur = baseSize * 0.6;
      wrapText(ctx, displayLyric, 0, 0, w * 0.82, baseSize * 1.25);

      // 清晰一点的叠加层
      ctx.globalAlpha = alphaRef.current * 0.08;
      ctx.shadowBlur = baseSize * 0.15;
      wrapText(ctx, displayLyric, 0, 0, w * 0.82, baseSize * 1.25);

      ctx.restore();
      rafRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [displayLyric]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: 0,
        pointerEvents: 'none',
      }}
    />
  );
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const chars = text.split('');
  let line = '';
  const lines = [];
  for (let i = 0; i < chars.length; i++) {
    const test = line + chars[i];
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = chars[i];
    } else {
      line = test;
    }
  }
  lines.push(line);
  const totalH = (lines.length - 1) * lineHeight;
  lines.forEach((l, i) => {
    ctx.fillText(l, x, y - totalH / 2 + i * lineHeight);
  });
}
