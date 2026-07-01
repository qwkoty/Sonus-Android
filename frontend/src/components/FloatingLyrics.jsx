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
      if (!line.text || line.text.length < 2) return;
      particlesRef.current.push({
        text: line.text,
        x: Math.random() * w,
        y: h + 20,
        speed: 0.15 + Math.random() * 0.3,
        opacity: 0.02 + Math.random() * 0.05,
        size: 9 + Math.random() * 11,
        drift: (Math.random() - 0.5) * 0.1,
      });
    };

    let frameCount = 0;
    const draw = () => {
      ctx.clearRect(0, 0, w, h);

      if (isPlaying && frameCount % 80 === 0) {
        spawnParticle();
      }
      frameCount++;

      const particles = particlesRef.current;
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.y -= p.speed;
        p.x += p.drift;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        ctx.font = `${p.size * dpr}px Inter, sans-serif`;
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
