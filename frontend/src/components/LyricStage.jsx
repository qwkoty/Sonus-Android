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

function mixColor(hex, t) {
  const c = hex.replace('#', '');
  const bigint = parseInt(c.length === 3 ? c.split('').map(x => x + x).join('') : c, 16);
  const r = Math.round(((bigint >> 16) & 255) * (1 - t) + 255 * t);
  const g = Math.round(((bigint >> 8) & 255) * (1 - t) + 255 * t);
  const b = Math.round((bigint & 255) * (1 - t) + 255 * t);
  return `${r},${g},${b}`; // 返回 RGB 三元组，由调用方拼 rgba(...,alpha)（v1.25 B3 修复畸形 rgba）
}

// 歌词舞台：MineRadio 风格
// - 多层径向光晕随节拍脉动
// - 顶部聚光灯投下锥形光束
// - 地板反射
// - 多道水平流光粒子在中心歌词区域穿梭
export default function LyricStage({ accent = '#00F5D4', isPlaying = false }) {
  const canvasRef = useRef(null);
  const accentRef = useRef(accent);
  const playingRef = useRef(isPlaying);
  useEffect(() => { accentRef.current = accent; }, [accent]);
  useEffect(() => { playingRef.current = isPlaying; }, [isPlaying]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let w, h, cx, cy, dpr;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.width = canvas.offsetWidth * dpr;
      h = canvas.height = canvas.offsetHeight * dpr;
      cx = w / 2;
      cy = h * 0.52;
    };
    resize();
    window.addEventListener('resize', resize);

    // 流光粒子：分布在若干水平车道，沿 x 方向漂移并叠加正弦曲线
    const LANES = 7;
    const PARTICLES = 160;
    const particles = Array.from({ length: PARTICLES }, (_, i) => ({
      lane: i % LANES,
      offset: Math.random(), // 在车道内的横向偏移
      speed: 0.004 + Math.random() * 0.012,
      size: 0.6 + Math.random() * 1.6,
      seed: Math.random() * 100,
      alpha: 0.15 + Math.random() * 0.45,
    }));

    let energy = 0;
    let beat = 0;
    let solar = 0;
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
      beat += (target - beat) * (target > beat ? 0.45 : 0.14);
      solar += (target - solar) * 0.08;

      const ac = accentRef.current;
      const baseA = mixColor(ac, 0.55);
      const hotA = mixColor(ac, 0.85);
      const now = Date.now() * 0.001;

      ctx.clearRect(0, 0, w, h);

      // 1) 顶部两束舞台聚光灯（更宽、更柔和）
      const beamGrad = ctx.createLinearGradient(cx, -h * 0.25, cx, cy);
      beamGrad.addColorStop(0, 'rgba(255,255,255,0)');
      beamGrad.addColorStop(0.45, hexToRgba(ac, 0.035 + solar * 0.10));
      beamGrad.addColorStop(0.72, hexToRgba(ac, 0.015 + solar * 0.045));
      beamGrad.addColorStop(1, 'rgba(255,255,255,0)');

      ctx.save();
      ctx.translate(cx, -h * 0.06);
      ctx.globalCompositeOperation = 'screen';
      [-0.34, 0.34].forEach((rot, idx) => {
        ctx.save();
        ctx.rotate(rot + Math.sin(now * 0.4 + idx) * 0.02);
        ctx.fillStyle = beamGrad;
        ctx.beginPath();
        ctx.moveTo(-w * 0.045, 0);
        ctx.lineTo(w * 0.045, 0);
        ctx.lineTo(w * 0.38, h * 0.88);
        ctx.lineTo(-w * 0.38, h * 0.88);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      });
      ctx.restore();

      // 2) 中心多层光晕（类似 MineRadio aura）
      const haloR = Math.min(w, h) * (0.20 + energy * 0.32 + beat * 0.10);
      const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, haloR);
      halo.addColorStop(0, hexToRgba('#ffffff', 0.10 + beat * 0.18));
      halo.addColorStop(0.22, hexToRgba(ac, 0.10 + solar * 0.16));
      halo.addColorStop(0.55, `rgba(${baseA},${0.05 + energy * 0.10})`);
      halo.addColorStop(0.85, `rgba(${baseA},${0.015 + energy * 0.03})`);
      halo.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
      ctx.fill();

      // 3) 地板反射
      const floorGrad = ctx.createRadialGradient(cx, h * 0.92, 0, cx, h * 0.92, w * 0.55);
      floorGrad.addColorStop(0, `rgba(${hotA},${0.10 + energy * 0.22})`);
      floorGrad.addColorStop(0.4, `rgba(${baseA},${0.05 + energy * 0.08})`);
      floorGrad.addColorStop(0.78, `rgba(${baseA},${0.015 + energy * 0.025})`);
      floorGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = floorGrad;
      ctx.beginPath();
      ctx.ellipse(cx, h * 0.92, w * 0.55, h * 0.10, 0, 0, Math.PI * 2);
      ctx.fill();

      // 4) 水平流光粒子（MineRadio 桌面歌词同款车道效果）
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const laneHeight = h * 0.22;
      const centerY = cy;
      for (const p of particles) {
        const laneY = centerY + (p.lane - (LANES - 1) / 2) * laneHeight * 0.18;
        p.offset += p.speed * (0.6 + energy * 2.4);
        if (p.offset > 1) p.offset -= 1;
        const flow = p.offset;
        const edge = Math.sin(Math.PI * flow);
        const x = cx + (flow - 0.5) * w * 1.15;
        const curve = Math.sin(flow * Math.PI * 2 * (0.8 + (p.seed % 0.5)) + p.seed + now * 0.5) * laneHeight * (0.12 + (p.seed % 0.18));
        const y = laneY + curve + Math.sin(now * (0.4 + (p.seed % 0.3)) + p.seed) * (3 + beat * 5);
        const tw = Math.pow(0.5 + 0.5 * Math.sin(now * (0.7 + (p.seed % 0.4)) + p.seed), 4);
        const r = p.size * dpr * (0.8 + edge * 1.2 + tw * 0.7 + beat * 0.5);

        const grad = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
        grad.addColorStop(0, `${hotA},0.95)`);
        grad.addColorStop(0.35, `${baseA},0.65)`);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = p.alpha * (0.18 + edge * 0.42 + tw * 0.24) * (0.35 + energy * 0.65);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.6, r * 4), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // 5) 中心歌词区域额外的辉尘（向上缓慢飘升）
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      for (let i = 0; i < 24; i++) {
        const t = (now * (0.08 + (i % 7) * 0.02) + i * 0.37) % 1;
        const x = cx + (Math.sin(i * 1.3) * 0.35 + (Math.random() - 0.5) * 0.04) * w * 0.5;
        const y = cy + t * h * 0.35;
        const r = (0.5 + (i % 5) * 0.25) * dpr * (0.8 + beat);
        ctx.globalAlpha = (1 - t) * (0.12 + energy * 0.28);
        ctx.fillStyle = `rgba(${hotA},${0.8})`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

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
