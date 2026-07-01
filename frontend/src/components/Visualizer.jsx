import { useEffect, useRef } from 'react';
import { readFrequencyData } from '../audio/engine';

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

    const BARS = 64;

    const draw = () => {
      ctx.clearRect(0, 0, w, h);

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const INNER_R = coverRadius * dpr;
      // 确保音柱不超出画布范围
      const MAX_BAR_LEN = Math.min(w, h) / 2 - INNER_R - 6 * dpr;
      if (MAX_BAR_LEN < 4) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      let freqData = readFrequencyData();
      const hasData = freqData.length > 0 && isPlaying;

      if (!hasData) {
        freqData = new Uint8Array(BARS).map((_, i) =>
          Math.max(4, Math.sin(i * 0.35 + Date.now() * 0.0012) * 8 + 8)
        );
      }

      const step = Math.max(1, Math.floor(freqData.length / BARS));

      for (let i = 0; i < BARS; i++) {
        const angle = (i / BARS) * Math.PI * 2 - Math.PI / 2;
        const idx = Math.min(i * step, freqData.length - 1);
        const value = freqData[idx] || 0;
        const normalized = value / 255;

        const barLen = Math.max(1.5, normalized * MAX_BAR_LEN * (hasData ? 1.0 : 0.45));
        const x1 = cx + Math.cos(angle) * INNER_R;
        const y1 = cy + Math.sin(angle) * INNER_R;
        const x2 = cx + Math.cos(angle) * (INNER_R + barLen);
        const y2 = cy + Math.sin(angle) * (INNER_R + barLen);

        const alpha = 0.15 + normalized * 0.85;
        ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
        ctx.lineWidth = 2 * dpr;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

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
