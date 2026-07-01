import { useEffect, useRef } from 'react';
import { readFrequencyDataLog } from '../audio/engine';

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

    const BARS = 72;
    const smooth = new Float32Array(BARS);

    const draw = () => {
      ctx.clearRect(0, 0, w, h);

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const INNER_R = coverRadius * dpr;
      const MAX_BAR_LEN = Math.min(w, h) / 2 - INNER_R - 4 * dpr;
      if (MAX_BAR_LEN < 4) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      const { data: freqData, hasData } = readFrequencyDataLog(BARS);
      const t = Date.now() * 0.001;

      for (let i = 0; i < BARS; i++) {
        const angle = (i / BARS) * Math.PI * 2 - Math.PI / 2;

        let value;
        if (hasData) {
          value = freqData[i] || 0;
        } else {
          const wave1 = Math.sin(i * 0.25 + t * 2.0) * 0.5 + 0.5;
          const wave2 = Math.sin(i * 0.13 + t * 1.1) * 0.3 + 0.5;
          value = wave1 * wave2 * 0.3;
        }

        smooth[i] += (value - smooth[i]) * 0.22;
        const v = smooth[i];

        const barLen = Math.max(1.5 * dpr, v * MAX_BAR_LEN);
        const x1 = cx + Math.cos(angle) * INNER_R;
        const y1 = cy + Math.sin(angle) * INNER_R;
        const x2 = cx + Math.cos(angle) * (INNER_R + barLen);
        const y2 = cy + Math.sin(angle) * (INNER_R + barLen);

        // 渐变：根部暗蓝，尖端亮白
        const grad = ctx.createLinearGradient(x1, y1, x2, y2);
        grad.addColorStop(0, `rgba(80,140,220,${0.15 + v * 0.2})`);
        grad.addColorStop(0.5, `rgba(160,200,255,${0.3 + v * 0.4})`);
        grad.addColorStop(1, `rgba(255,255,255,${0.5 + v * 0.5})`);

        ctx.strokeStyle = grad;
        ctx.lineWidth = 2.5 * dpr;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        // 尖端发光点
        if (v > 0.25) {
          ctx.fillStyle = `rgba(255,255,255,${v * 0.7})`;
          ctx.beginPath();
          ctx.arc(x2, y2, 1.5 * dpr * (1 + v), 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // 内圈光环
      const avgEnergy = hasData
        ? freqData.reduce((a, b) => a + b, 0) / BARS
        : (Math.sin(t * 1.5) * 0.5 + 0.5) * 0.1;
      ctx.strokeStyle = `rgba(100,160,255,${0.05 + avgEnergy * 0.12})`;
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.arc(cx, cy, INNER_R - 2 * dpr, 0, Math.PI * 2);
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
