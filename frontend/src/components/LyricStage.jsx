import { useEffect, useRef } from 'react';
import { getSpectrumBars } from '../audio/engine';

function hexToRgba(hex, a) {
  const c = hex.replace('#', '');
  const bigint = parseInt(c.length === 3 ? c.split('').map(x => x + x).join('') : c, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r},${g},${b},${a})`;
}

export default function LyricStage({ accent = '#00F5D4', isPlaying = false }) {
  const canvasRef = useRef(null);
  const accentRef = useRef(accent);
  useEffect(() => { accentRef.current = accent; }, [accent]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let w, h, cx, cy, dpr;

    const particles = Array.from({ length: 44 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: Math.random() * 1.4 + 0.5,
      vy: Math.random() * 0.35 + 0.12,
      vx: (Math.random() - 0.5) * 0.12,
      a: Math.random() * 0.6 + 0.2,
    }));

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.width = canvas.offsetWidth * dpr;
      h = canvas.height = canvas.offsetHeight * dpr;
      cx = w / 2;
      cy = h * 0.52;
    };
    resize();
    window.addEventListener('resize', resize);

    let energy = 0;
    let raf;

    const draw = () => {
      const { data, hasData } = getSpectrumBars(32);
      let target = 0;
      if (hasData) {
        for (let i = 0; i < data.length; i++) target += data[i];
        target /= data.length;
      } else {
        target = 0.05 + Math.sin(Date.now() * 0.0012) * 0.03;
      }
      energy += (target - energy) * 0.12;

      ctx.clearRect(0, 0, w, h);

      const ac = accentRef.current;

      // 顶部两束舞台聚光灯
      const beamGrad = ctx.createLinearGradient(cx, -h * 0.2, cx, cy);
      beamGrad.addColorStop(0, 'rgba(255,255,255,0)');
      beamGrad.addColorStop(0.55, hexToRgba(ac, 0.03 + energy * 0.08));
      beamGrad.addColorStop(1, 'rgba(255,255,255,0)');

      ctx.save();
      ctx.translate(cx, -h * 0.08);
      ctx.rotate(-0.32);
      ctx.fillStyle = beamGrad;
      ctx.beginPath();
      ctx.moveTo(-w * 0.04, 0);
      ctx.lineTo(w * 0.04, 0);
      ctx.lineTo(w * 0.32, h * 0.85);
      ctx.lineTo(-w * 0.32, h * 0.85);
      ctx.closePath();
      ctx.fill();

      ctx.rotate(0.64);
      ctx.beginPath();
      ctx.moveTo(-w * 0.04, 0);
      ctx.lineTo(w * 0.04, 0);
      ctx.lineTo(w * 0.32, h * 0.85);
      ctx.lineTo(-w * 0.32, h * 0.85);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // 歌词中心光晕：随能量脉动
      const glowR = Math.min(w, h) * (0.16 + energy * 0.28);
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
      glow.addColorStop(0, hexToRgba('#ffffff', 0.10 + energy * 0.18));
      glow.addColorStop(0.35, hexToRgba(ac, 0.08 + energy * 0.14));
      glow.addColorStop(0.75, hexToRgba(ac, 0.02 + energy * 0.04));
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
      ctx.fill();

      // 舞台地板反光
      const floorGrad = ctx.createRadialGradient(cx, h * 0.92, 0, cx, h * 0.92, w * 0.55);
      floorGrad.addColorStop(0, hexToRgba(ac, 0.08 + energy * 0.16));
      floorGrad.addColorStop(0.5, hexToRgba(ac, 0.03 + energy * 0.05));
      floorGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = floorGrad;
      ctx.beginPath();
      ctx.ellipse(cx, h * 0.92, w * 0.55, h * 0.09, 0, 0, Math.PI * 2);
      ctx.fill();

      // 光束中的浮尘粒子
      ctx.fillStyle = '#ffffff';
      for (const p of particles) {
        p.y -= p.vy * (0.6 + energy * 1.8) * 0.01;
        p.x += p.vx * 0.01;
        if (p.y < 0) {
          p.y = 1;
          p.x = Math.random();
        }
        // 粒子集中在两束光锥范围内
        const beamOffset = (Math.random() > 0.5 ? 1 : -1) * (0.12 + p.y * 0.28);
        const px = cx + (p.x - 0.5 + beamOffset * 0.6) * w * 0.9;
        const py = cy - p.y * (cy + h * 0.18);
        const pr = p.r * dpr * (0.7 + energy * 0.9);
        ctx.globalAlpha = p.a * (0.25 + energy * 0.55) * (1 - Math.abs(p.x - 0.5) * 1.2);
        ctx.beginPath();
        ctx.arc(px, py, Math.max(0.5, pr), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      raf = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      cancelAnimationFrame(raf);
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
        pointerEvents: 'none',
      }}
    />
  );
}
