import { useEffect, useRef } from 'react';
import { getSpectrumBars, readTimeDomainData } from '../audio/engine';

const NUM_BARS = 64;

export default function Visualizer({ isPlaying, mode = 'ring' }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const smoothRef = useRef(new Float32Array(NUM_BARS));
  const bassSmoothRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let w, h, cx, cy, dpr, minDim;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.width = canvas.offsetWidth * dpr;
      h = canvas.height = canvas.offsetHeight * dpr;
      cx = w / 2;
      cy = h / 2;
      minDim = Math.min(w, h);
    };
    resize();
    window.addEventListener('resize', resize);

    // ---- 模式：连续闭合环形频谱（完全自适应 + 中心填充） ----
    const drawRing = (spectrum, hasData) => {
      const data = spectrum;

      // 自适应半径
      const INNER_R = minDim * 0.15;
      const MAX_OUTER = minDim * 0.5 * 0.85;
      const MAX_BAR = MAX_OUTER - INNER_R;
      const safeBarScale = MAX_BAR / 1.2;

      // 平滑
      const smooth = smoothRef.current;
      const smoothFactor = 0.35;
      for (let i = 0; i < NUM_BARS; i++) {
        smooth[i] += (data[i] - smooth[i]) * smoothFactor;
      }

      // 计算 bass 能量（前 8 个频段平均），用于中心辉光脉动
      let bass = 0;
      if (hasData) {
        for (let i = 0; i < 8; i++) bass += smooth[i];
        bass /= 8;
      } else {
        bass = 0.05 + Math.sin(Date.now() * 0.001) * 0.03;
      }
      bassSmoothRef.current += (bass - bassSmoothRef.current) * 0.2;
      const bassSmooth = bassSmoothRef.current;

      // ---- 中心填充：蓝色圆心向外渐变到白色 ----
      const centerGlowR = INNER_R * (1.3 + bassSmooth * 0.3);
      const centerGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, centerGlowR);
      centerGrad.addColorStop(0, `rgba(60, 140, 255, ${0.35 + bassSmooth * 0.15})`);
      centerGrad.addColorStop(0.5, `rgba(100, 170, 255, ${0.18 + bassSmooth * 0.08})`);
      centerGrad.addColorStop(0.85, `rgba(200, 220, 255, ${0.06})`);
      centerGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = centerGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, centerGlowR, 0, Math.PI * 2);
      ctx.fill();

      // ---- 计算频谱曲线点 ----
      const outerPts = [];
      const innerPts = [];
      for (let i = 0; i < NUM_BARS; i++) {
        const angle = (i / NUM_BARS) * Math.PI * 2 - Math.PI / 2;
        const value = hasData ? smooth[i] : 0.04;
        const barLen = Math.max(1, value * safeBarScale * (hasData ? 1.0 : 0.4));

        outerPts.push({
          x: cx + Math.cos(angle) * (INNER_R + barLen),
          y: cy + Math.sin(angle) * (INNER_R + barLen),
        });
        const innerLen = Math.min(barLen * 0.5, INNER_R * 0.4);
        innerPts.push({
          x: cx + Math.cos(angle) * (INNER_R - innerLen),
          y: cy + Math.sin(angle) * (INNER_R - innerLen),
        });
      }

      // ---- 绘制平滑闭合曲线 ----
      const drawSmoothLoop = (pts, lineWidth, alpha) => {
        if (pts.length < 3) return;
        ctx.beginPath();
        const midX = (pts[0].x + pts[pts.length - 1].x) / 2;
        const midY = (pts[0].y + pts[pts.length - 1].y) / 2;
        ctx.moveTo(midX, midY);
        for (let i = 0; i < pts.length; i++) {
          const next = pts[(i + 1) % pts.length];
          const mx = (pts[i].x + next.x) / 2;
          const my = (pts[i].y + next.y) / 2;
          ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
        }
        ctx.closePath();

        const grad = ctx.createLinearGradient(cx - INNER_R, cy, cx + INNER_R, cy);
        grad.addColorStop(0, `hsla(30, 90%, 65%, ${alpha})`);
        grad.addColorStop(0.5, `hsla(200, 90%, 65%, ${alpha})`);
        grad.addColorStop(1, `hsla(320, 90%, 65%, ${alpha})`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = lineWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
      };

      const baseLW = minDim * 0.003;

      // 镜像反射层
      drawSmoothLoop(innerPts, baseLW * 0.8, 0.1);

      // 3 层辉光
      drawSmoothLoop(outerPts, baseLW * 5, 0.05);
      drawSmoothLoop(outerPts, baseLW * 2.5, 0.15);
      drawSmoothLoop(outerPts, baseLW * 1.2, 0.85);
    };

    // ---- 模式：波形示波器（自适应） ----
    const drawWave = () => {
      const wave = readTimeDomainData();
      const hasData = wave.length > 0 && isPlaying;
      const midY = cy;
      const amp = h * 0.35;
      const baseLW = minDim * 0.003;

      const layers = [
        { width: baseLW * 4, alpha: 0.08, color: '#4FC3F7' },
        { width: baseLW * 2.2, alpha: 0.18, color: '#4FC3F7' },
        { width: baseLW * 1.2, alpha: 0.9, color: '#fff' },
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

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      const { data, hasData } = getSpectrumBars(NUM_BARS);

      if (mode === 'wave') {
        drawWave();
      } else {
        drawRing(data, hasData);
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    smoothRef.current.fill(0);
    bassSmoothRef.current = 0;
    draw();
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [isPlaying, mode]);

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
