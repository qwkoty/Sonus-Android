import { useEffect, useRef } from 'react';
import { readFrequencyData } from '../audio/engine';

export default function Visualizer({ isPlaying }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let w, h;

    const resize = () => {
      w = canvas.width = canvas.offsetWidth * 2;
      h = canvas.height = canvas.offsetHeight * 2;
    };
    resize();
    window.addEventListener('resize', resize);

    const draw = () => {
      ctx.clearRect(0, 0, w, h);

      let freqData = readFrequencyData();
      const hasData = freqData.length > 0 && isPlaying;

      if (!hasData) {
        // 回退：静默时显示低幅度静态条
        freqData = new Uint8Array(32).map(() => 8);
      }

      const bars = freqData.length;
      const barW = w / bars;
      const gap = barW * 0.4;
      const maxH = h * 0.45;

      for (let i = 0; i < bars; i++) {
        // 频率数据 0-255，映射到高度
        const value = freqData[i] || 0;
        const normalized = value / 255;
        const bh = Math.max(4, normalized * maxH * (hasData ? 1.2 : 1));
        const x = i * barW + gap / 2;
        const y = (h - bh) / 2;

        const alpha = 0.3 + normalized * 0.7;
        ctx.fillStyle = `rgba(255,255,255,${alpha})`;
        ctx.beginPath();
        ctx.roundRect(x, y, barW - gap, bh, 4);
        ctx.fill();
      }

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
        height: 60,
        opacity: 0.9,
      }}
    />
  );
}
