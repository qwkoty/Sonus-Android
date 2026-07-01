import { useEffect, useRef } from 'react';
import { getSpectrumBars, readTimeDomainData } from '../audio/engine';

const NUM_BARS = 64;

export default function Visualizer({ isPlaying, coverRadius = 80, mode = 'ring' }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const particlesRef = useRef([]);
  const waterfallRef = useRef([]);

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
      cy = h / 2;
    };
    resize();
    window.addEventListener('resize', resize);

    // ---- 模式：环形频谱（分色 + 镜像反射） ----
    const drawRing = (spectrum, hasData) => {
      const data = spectrum;
      const INNER_R = coverRadius * dpr;
      const MAX_BAR = Math.min(w, h) * 0.32;

      for (let i = 0; i < NUM_BARS; i++) {
        const angle = (i / NUM_BARS) * Math.PI * 2 - Math.PI / 2;
        const value = data[i] || 0;

        // 外侧条
        const barLen = Math.max(2, value * MAX_BAR * (hasData ? 1.15 : 0.5));
        const x1 = cx + Math.cos(angle) * INNER_R;
        const y1 = cy + Math.sin(angle) * INNER_R;
        const x2 = cx + Math.cos(angle) * (INNER_R + barLen);
        const y2 = cy + Math.sin(angle) * (INNER_R + barLen);

        // 按频率分色：低频暖橙 → 高频青蓝
        const hue = 200 - (i / NUM_BARS) * 170; // 200(青) → 30(橙)
        const alpha = 0.3 + value * 0.7;
        ctx.strokeStyle = `hsla(${hue}, 80%, 65%, ${alpha})`;
        ctx.lineWidth = 2.5 * dpr;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        // 镜像反射（向内）
        const x3 = cx + Math.cos(angle) * (INNER_R - barLen * 0.45);
        const y3 = cy + Math.sin(angle) * (INNER_R - barLen * 0.45);
        ctx.strokeStyle = `hsla(${hue}, 80%, 65%, ${alpha * 0.3})`;
        ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x3, y3);
        ctx.stroke();

        // 端点微光
        if (hasData && value > 0.35) {
          ctx.fillStyle = `hsla(${hue}, 90%, 75%, ${value * 0.6})`;
          ctx.beginPath();
          ctx.arc(x2, y2, 2.5 * dpr, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    // ---- 模式：波形示波器 ----
    const drawWave = () => {
      const wave = readTimeDomainData();
      const hasData = wave.length > 0 && isPlaying;
      const midY = cy;
      const amp = h * 0.32;

      // 多层辉光
      const layers = [
        { width: 6 * dpr, alpha: 0.08, color: '#4FC3F7' },
        { width: 3.5 * dpr, alpha: 0.18, color: '#4FC3F7' },
        { width: 2 * dpr, alpha: 0.9, color: '#fff' },
      ];

      for (const layer of layers) {
        ctx.strokeStyle = layer.color;
        ctx.globalAlpha = layer.alpha;
        ctx.lineWidth = layer.width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();

        if (hasData && wave.length > 0) {
          const step = wave.length / w;
          for (let x = 0; x < w; x++) {
            const idx = Math.floor(x * step);
            const v = (wave[idx] - 128) / 128;
            const y = midY + v * amp;
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
        } else {
          // 待机正弦波
          const t = Date.now() * 0.002;
          for (let x = 0; x < w; x++) {
            const y = midY + Math.sin(x * 0.02 + t) * amp * 0.12;
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };

    // ---- 模式：粒子脉动 ----
    // 两层效果：1) 围绕封面的脉动粒子环（大小随频谱实时变化）
    //          2) 高频段发射飞散粒子（慢衰减 + 辉光）
    const drawParticles = (spectrum, hasData) => {
      const data = spectrum;
      const INNER_R = coverRadius * dpr;

      // ===== 第 1 层：脉动粒子环（核心音频反馈） =====
      // 每个频段对应一个固定粒子，大小 = 基础大小 * (1 + 频谱值 * 5)
      for (let i = 0; i < NUM_BARS; i++) {
        const angle = (i / NUM_BARS) * Math.PI * 2 - Math.PI / 2;
        const value = hasData ? data[i] : 0.05;
        const hue = 200 - (i / NUM_BARS) * 170;

        const px = cx + Math.cos(angle) * INNER_R;
        const py = cy + Math.sin(angle) * INNER_R;

        // 粒子大小直接由频谱值驱动 — 这是音频波动的直接体现
        const baseSize = 2 * dpr;
        const pulseSize = baseSize + value * 14 * dpr;

        // 辉光
        ctx.shadowBlur = 12 * dpr;
        ctx.shadowColor = `hsla(${hue}, 90%, 60%, 0.8)`;
        ctx.fillStyle = `hsla(${hue}, 90%, 70%, ${0.4 + value * 0.6})`;
        ctx.beginPath();
        ctx.arc(px, py, pulseSize, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // ===== 第 2 层：飞散粒子（高频段触发） =====
      if (isPlaying) {
        for (let i = 0; i < NUM_BARS; i++) {
          const value = hasData ? data[i] : 0;
          if (value < 0.25) continue; // 只有能量足够的频段才发射

          const angle = (i / NUM_BARS) * Math.PI * 2 - Math.PI / 2;
          const hue = 200 - (i / NUM_BARS) * 170;
          const speed = (1 + value * 5) * dpr;

          particlesRef.current.push({
            x: cx + Math.cos(angle) * INNER_R,
            y: cy + Math.sin(angle) * INNER_R,
            vx: Math.cos(angle) * speed + (Math.random() - 0.5) * 0.5,
            vy: Math.sin(angle) * speed + (Math.random() - 0.5) * 0.5,
            life: 1,
            decay: 0.004 + Math.random() * 0.006, // 慢衰减
            size: (2 + value * 4) * dpr,
            hue,
          });
        }
      }

      // 限制粒子数
      if (particlesRef.current.length > 600) {
        particlesRef.current.splice(0, particlesRef.current.length - 600);
      }

      const particles = particlesRef.current;
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.98;
        p.vy *= 0.98;
        p.life -= p.decay;

        if (p.life <= 0) {
          particles.splice(i, 1);
          continue;
        }

        ctx.shadowBlur = 6 * dpr;
        ctx.shadowColor = `hsla(${p.hue}, 90%, 60%, ${p.life * 0.6})`;
        ctx.fillStyle = `hsla(${p.hue}, 90%, 70%, ${p.life * 0.9})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    };

    // ---- 模式：频谱瀑布图（底部上滚 + 高饱和渐变） ----
    // 每帧频谱从底部出现，向上滚动逐渐淡出，形成"声波瀑布"效果
    const drawWaterfall = (spectrum, hasData) => {
      const data = spectrum;
      const colWidth = w / NUM_BARS;

      // 保存当前帧（最新的在数组末尾）
      waterfallRef.current.push(Array.from(data));
      const MAX_HISTORY = 100;
      if (waterfallRef.current.length > MAX_HISTORY) waterfallRef.current.shift();

      const history = waterfallRef.current;
      const rowH = h / MAX_HISTORY;

      // 从底部（最新）向上（最旧）绘制
      for (let row = 0; row < history.length; row++) {
        const rowData = history[history.length - 1 - row]; // row=0 是最新帧
        const y = h - (row + 1) * rowH; // 从底部开始

        // 越旧越淡
        const ageAlpha = Math.pow(1 - row / history.length, 0.8);

        for (let i = 0; i < NUM_BARS; i++) {
          const value = rowData[i] || 0;
          if (value < 0.01) continue;

          // 高饱和渐变：低频品红 → 中频青绿 → 高频明黄
          const hue = 320 - (i / NUM_BARS) * 200; // 320(品红) → 120(绿)
          const x = i * colWidth;

          // 颜色亮度直接由频谱值驱动 — 能量越高越亮
          const lightness = 45 + value * 30; // 45% → 75%
          const alpha = Math.min(1, value * 1.5) * ageAlpha;

          ctx.fillStyle = `hsla(${hue}, 95%, ${lightness}%, ${alpha})`;
          ctx.fillRect(x, y, colWidth + 1, rowH + 1);

          // 高能量格子的辉光
          if (value > 0.4) {
            ctx.shadowBlur = 8 * dpr;
            ctx.shadowColor = `hsla(${hue}, 95%, 65%, ${alpha * 0.8})`;
            ctx.fillStyle = `hsla(${hue}, 100%, 80%, ${alpha * 0.5})`;
            ctx.fillRect(x, y, colWidth + 1, rowH + 1);
            ctx.shadowBlur = 0;
          }
        }
      }

      // 底部当前帧的亮线（强调"正在播放"的瞬态）
      if (hasData && history.length > 0) {
        const latest = history[history.length - 1];
        for (let i = 0; i < NUM_BARS; i++) {
          const value = latest[i] || 0;
          if (value < 0.01) continue;
          const hue = 320 - (i / NUM_BARS) * 200;
          const x = i * colWidth;
          ctx.fillStyle = `hsla(${hue}, 100%, 85%, ${value * 0.9})`;
          ctx.fillRect(x, h - rowH - 1, colWidth + 1, 2 * dpr);
        }
      }
    };

    // ---- 主循环 ----
    const draw = () => {
      ctx.clearRect(0, 0, w, h);

      const { data, hasData } = getSpectrumBars(NUM_BARS);

      switch (mode) {
        case 'wave':
          drawWave();
          break;
        case 'particles':
          ctx.clearRect(0, 0, w, h); // 粒子模式完全清除
          drawParticles(data, hasData);
          break;
        case 'waterfall':
          drawWaterfall(data, hasData);
          break;
        default:
          drawRing(data, hasData);
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    // 切换模式时清空状态
    particlesRef.current = [];
    waterfallRef.current = [];

    draw();
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [isPlaying, coverRadius, mode]);

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
