import { useEffect, useRef } from 'react';
import { getSpectrumBars } from '../audio/engine';

export default function Visualizer({ isPlaying, coverRadius = 80 }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let w, h, cx, cy;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.width = canvas.offsetWidth * dpr;
      h = canvas.height = canvas.offsetHeight * dpr;
      cx = w / 2;
      cy = h / 2;
    };
    resize();
    window.addEventListener('resize', resize);

    const BARS = 128;
    const smooth = new Float32Array(BARS);

    // Catmull-Rom 样条插值，生成平滑曲线
    function catmullRom(p0, p1, p2, p3, t) {
      const t2 = t * t;
      const t3 = t2 * t;
      return {
        x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      };
    }

    const draw = () => {
      ctx.clearRect(0, 0, w, h);

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const INNER_R = coverRadius * dpr;
      const MAX_BAR_LEN = Math.min(w, h) / 2 - INNER_R - 4 * dpr;
      if (MAX_BAR_LEN < 4) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      const { data: spectrum, hasData } = getSpectrumBars(72);
      const t = Date.now() * 0.001;

      // 计算 128 个点的值（从 72 个频段插值）
      const values = new Float32Array(BARS);
      for (let i = 0; i < BARS; i++) {
        const ratio = (i / BARS) * 72;
        const idx = Math.floor(ratio);
        const frac = ratio - idx;
        const idx2 = Math.min(idx + 1, 71);
        let rawVal;
        if (hasData) {
          rawVal = (spectrum[idx] || 0) * (1 - frac) + (spectrum[idx2] || 0) * frac;
        } else {
          const wave1 = Math.sin(i * 0.15 + t * 1.6) * 0.5 + 0.5;
          const wave2 = Math.sin(i * 0.08 + t * 0.85) * 0.3 + 0.5;
          rawVal = wave1 * wave2 * 0.2;
        }
        if (rawVal > smooth[i]) {
          smooth[i] += (rawVal - smooth[i]) * 0.5;
        } else {
          smooth[i] += (rawVal - smooth[i]) * 0.1;
        }
        values[i] = smooth[i];
      }

      // 计算外轮廓和内轮廓的点
      const outerPts = [];
      const innerPts = [];
      for (let i = 0; i < BARS; i++) {
        const angle = (i / BARS) * Math.PI * 2 - Math.PI / 2;
        const v = values[i];
        const outerR = INNER_R + Math.max(1 * dpr, v * MAX_BAR_LEN);
        outerPts.push({
          x: cx + Math.cos(angle) * outerR,
          y: cy + Math.sin(angle) * outerR,
        });
        innerPts.push({
          x: cx + Math.cos(angle) * INNER_R,
          y: cy + Math.sin(angle) * INNER_R,
        });
      }

      // ---- 绘制外层光晕 ----
      ctx.save();
      ctx.shadowColor = 'rgba(100,170,255,0.4)';
      ctx.shadowBlur = 20 * dpr;
      ctx.beginPath();
      // 用 Catmull-Rom 画平滑闭合曲线
      for (let i = 0; i < BARS; i++) {
        const p0 = outerPts[(i - 1 + BARS) % BARS];
        const p1 = outerPts[i];
        const p2 = outerPts[(i + 1) % BARS];
        const p3 = outerPts[(i + 2) % BARS];
        const steps = 4;
        for (let s = 0; s < steps; s++) {
          const pt = catmullRom(p0, p1, p2, p3, s / steps);
          if (i === 0 && s === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        }
      }
      ctx.closePath();

      // 闭合到内圈
      for (let i = BARS - 1; i >= 0; i--) {
        ctx.lineTo(innerPts[i].x, innerPts[i].y);
      }
      ctx.closePath();

      // 径向渐变填充
      const grad = ctx.createRadialGradient(cx, cy, INNER_R, cx, cy, INNER_R + MAX_BAR_LEN);
      grad.addColorStop(0, 'rgba(30,70,160,0.12)');
      grad.addColorStop(0.4, 'rgba(60,130,230,0.2)');
      grad.addColorStop(0.8, 'rgba(140,190,255,0.35)');
      grad.addColorStop(1, 'rgba(255,255,255,0.5)');
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.restore();

      // ---- 绘制外轮廓线 ----
      ctx.beginPath();
      for (let i = 0; i < BARS; i++) {
        const p0 = outerPts[(i - 1 + BARS) % BARS];
        const p1 = outerPts[i];
        const p2 = outerPts[(i + 1) % BARS];
        const p3 = outerPts[(i + 2) % BARS];
        const steps = 4;
        for (let s = 0; s < steps; s++) {
          const pt = catmullRom(p0, p1, p2, p3, s / steps);
          if (i === 0 && s === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        }
      }
      ctx.closePath();
      ctx.strokeStyle = 'rgba(160,210,255,0.5)';
      ctx.lineWidth = 1.2 * dpr;
      ctx.stroke();

      // ---- 高能量点发光 ----
      for (let i = 0; i < BARS; i++) {
        const v = values[i];
        if (v > 0.35) {
          const angle = (i / BARS) * Math.PI * 2 - Math.PI / 2;
          const r = INNER_R + v * MAX_BAR_LEN;
          const x = cx + Math.cos(angle) * r;
          const y = cy + Math.sin(angle) * r;
          ctx.save();
          ctx.shadowColor = `rgba(200,230,255,${v * 0.6})`;
          ctx.shadowBlur = 6 * dpr;
          ctx.fillStyle = `rgba(255,255,255,${v * 0.7})`;
          ctx.beginPath();
          ctx.arc(x, y, 1.2 * dpr, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      // ---- 内圈呼吸光环 ----
      const avgEnergy = hasData
        ? spectrum.reduce((a, b) => a + b, 0) / 72
        : (Math.sin(t * 1.5) * 0.5 + 0.5) * 0.08;
      ctx.strokeStyle = `rgba(80,140,255,${0.04 + avgEnergy * 0.12})`;
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath();
      ctx.arc(cx, cy, INNER_R - 3 * dpr, 0, Math.PI * 2);
      ctx.stroke();

      rafRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [isPlaying, coverRadius]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: 2,
      }}
    />
  );
}
