import { useEffect, useRef } from 'react';
import { readFrequencyData } from '../audio/engine';

export default function Visualizer({ isPlaying }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const rotationRef = useRef(0);

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

    const RINGS = 3;
    const BARS_PER_RING = 64;
    const RING_RADIUS_BASE = Math.min(w, h) * 0.18;

    const draw = () => {
      ctx.fillStyle = 'rgba(10,10,10,0.25)';
      ctx.fillRect(0, 0, w, h);

      let freqData = readFrequencyData();
      const hasData = freqData.length > 0 && isPlaying;

      if (!hasData) {
        freqData = new Uint8Array(BARS_PER_RING).map((_, i) =>
          Math.max(4, Math.sin(i * 0.3 + rotationRef.current * 0.02) * 12 + 12)
        );
      }

      rotationRef.current += 0.4;

      for (let r = RINGS - 1; r >= 0; r--) {
        const ringScale = 1 - r * 0.22;
        const radius = RING_RADIUS_BASE * ringScale;
        const alpha = 0.25 + (1 - r * 0.25) * 0.75;
        const offsetAngle = rotationRef.current * (0.008 + r * 0.004);

        for (let i = 0; i < BARS_PER_RING; i++) {
          const angle = (i / BARS_PER_RING) * Math.PI * 2 + offsetAngle;
          const freqIdx = Math.floor((i / BARS_PER_RING) * freqData.length) % freqData.length;
          const value = freqData[freqIdx] || 0;
          const normalized = value / 255;

          const barLen = Math.max(2, normalized * radius * 0.7 * (hasData ? 1.3 : 0.6));
          const x1 = cx + Math.cos(angle) * radius;
          const y1 = cy + Math.sin(angle) * radius;
          const x2 = cx + Math.cos(angle) * (radius + barLen);
          const y2 = cy + Math.sin(angle) * (radius + barLen);

          ctx.strokeStyle = `rgba(255,255,255,${alpha * (0.2 + normalized * 0.8)})`;
          ctx.lineWidth = 2.5 * ringScale;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();

          // 端点光晕
          if (hasData && normalized > 0.3) {
            ctx.fillStyle = `rgba(255,255,255,${normalized * alpha * 0.6})`;
            ctx.beginPath();
            ctx.arc(x2, y2, 2.5 * ringScale, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // 内圈圆环
        ctx.strokeStyle = `rgba(255,255,255,${alpha * 0.08})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 中心脉冲
      const pulse = hasData
        ? (freqData.reduce((a, b) => a + b, 0) / freqData.length / 255) * 12
        : 4;
      ctx.strokeStyle = `rgba(255,255,255,${0.15 + pulse * 0.03})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, RING_RADIUS_BASE * 0.08 + pulse, 0, Math.PI * 2);
      ctx.stroke();

      rafRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [isPlaying]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%',
        height: '100%',
      }}
    />
  );
}
