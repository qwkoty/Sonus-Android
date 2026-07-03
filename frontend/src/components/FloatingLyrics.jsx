import { useEffect, useRef } from 'react';

// 漂浮歌词粒子：歌词文字从底部缓慢上浮
// 网页端表现力版本：发光光晕 + 生命周期淡入淡出 + 轻微旋转 + 横向漂移
// 安卓优化：dpr 限 1.5、粒子上限 30、shadowBlur 适中
export default function FloatingLyrics({ lyrics, isPlaying }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const particlesRef = useRef([]);
  const lyricsRef = useRef(lyrics);
  const isPlayingRef = useRef(isPlaying);

  useEffect(() => { lyricsRef.current = lyrics; }, [lyrics]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let w, h, dpr;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);   // 安卓限 1.5
      w = canvas.width = canvas.offsetWidth * dpr;
      h = canvas.height = canvas.offsetHeight * dpr;
    };
    resize();
    window.addEventListener('resize', resize);

    const MAX_PARTICLES = 30;   // 粒子上限，避免堆积影响性能

    const spawnParticle = () => {
      const ls = lyricsRef.current;
      if (!ls || !ls.length) return;
      // 优先选有文本的行
      const candidates = ls.filter((l) => l && l.text && l.text.length >= 2);
      if (!candidates.length) return;
      const line = candidates[Math.floor(Math.random() * candidates.length)];
      const size = (11 + Math.random() * 14) * dpr;
      particlesRef.current.push({
        text: line.text,
        x: Math.random() * w,
        y: h + 30 * dpr,
        speed: (0.15 + Math.random() * 0.35) * dpr,
        size,
        drift: (Math.random() - 0.5) * 0.15 * dpr,
        rotation: (Math.random() - 0.5) * 0.15,
        life: 1.0,
        fadeRate: 0.0015 + Math.random() * 0.001,
        baseOpacity: 0.25 + Math.random() * 0.25,
      });
    };

    let frameCount = 0;
    const draw = () => {
      ctx.clearRect(0, 0, w, h);

      // 播放时每 70 帧生成一个粒子（上限 30）
      if (isPlayingRef.current && frameCount % 70 === 0 && particlesRef.current.length < MAX_PARTICLES) {
        spawnParticle();
      }
      frameCount++;

      const particles = particlesRef.current;
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.y -= p.speed;
        p.x += p.drift;
        p.life -= p.fadeRate;

        if (p.life <= 0 || p.y < -50 * dpr) {
          particles.splice(i, 1);
          continue;
        }

        // 透明度：淡入(life>0.85) → 满 → 淡出(life<0.3)
        let alpha;
        if (p.life > 0.85) {
          alpha = (1 - p.life) / 0.15;       // 淡入
        } else if (p.life < 0.3) {
          alpha = p.life / 0.3;               // 淡出
        } else {
          alpha = 1;
        }
        alpha *= p.baseOpacity;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.font = `500 ${p.size}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // 发光光晕
        ctx.shadowColor = 'rgba(255,255,255,0.6)';
        ctx.shadowBlur = 12 * dpr;
        ctx.fillStyle = `rgba(255,255,255,${alpha})`;
        ctx.fillText(p.text, 0, 0);
        ctx.restore();
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: 1,
      }}
    />
  );
}
