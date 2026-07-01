import { useEffect, useRef } from 'react';

export default function FloatingLyrics({ lyrics, isPlaying }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const particlesRef = useRef([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let w, h;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.width = canvas.offsetWidth * dpr;
      h = canvas.height = canvas.offsetHeight * dpr;
    };
    resize();
    window.addEventListener('resize', resize);

    const spawnParticle = () => {
      if (!lyrics.length) return;
      const line = lyrics[Math.floor(Math.random() * lyrics.length)];
      particlesRef.current.push({
        text: line.text,
        x: Math.random() * w,
        y: h + 20,
        speed: 0.3 + Math.random() * 0.6,
        opacity: 0.05 + Math.random() * 0.12,
        size: 10 + Math.random() * 14,
        drift: (Math.random() - 0.5) * 0.2,
      });
    };

    let frameCount = 0;
    const draw = () => {
      ctx.clearRect(0, 0, w, h);

      // 偶尔生成新粒子
      if (isPlaying && frameCount % 40 === 0) {
        spawnParticle();
        if (Math.random() > 0.5) spawnParticle();
      }
      frameCount++;

      const particles = particlesRef.current;
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.y -= p.speed;
        p.x += p.drift;

        ctx.font = `${p.size * (window.devicePixelRatio || 1)}px Inter, sans-serif`;
        ctx.fillStyle = `rgba(255,255,255,${p.opacity})`;
        ctx.textAlign = 'center';
        ctx.fillText(p.text, p.x, p.y);

        if (p.y < -30) {
          particles.splice(i, 1);
        }
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [lyrics, isPlaying]);

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
