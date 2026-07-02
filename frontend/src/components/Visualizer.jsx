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

      // ---- 频谱柱环带：柱子粘在一起形成实心环 ----
      // 每根柱子是从内圈向外延伸的梯形，相邻柱子共享径向边（无间隙）
      // 外轮廓 = 柱子顶部阶梯折线；内圈挖空；中间用径向细线体现柱子结构
      const numBars = NUM_BARS;
      const angleStep = (Math.PI * 2) / numBars;

      // 每根柱子长度
      const barLen = [];
      for (let i = 0; i < numBars; i++) {
        const value = hasData ? smooth[i] : 0.04;
        barLen.push(Math.max(2, value * safeBarScale * (hasData ? 1.0 : 0.4)));
      }

      // 角度/坐标辅助
      const angleAt = (i) => i * angleStep - Math.PI / 2;
      const radPos = (a, r) => ({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });

      // 构建阶梯外轮廓 + 内圈挖空路径（evenodd 填充环带）
      const buildBandPath = () => {
        ctx.beginPath();
        // 起点：第 0 根柱子左上角
        const p0 = radPos(angleAt(0), INNER_R + barLen[0]);
        ctx.moveTo(p0.x, p0.y);
        // 沿每根柱子顶部阶梯走一圈：横到右上角 → 径向连到下一根左上角
        for (let i = 0; i < numBars; i++) {
          const aR = angleAt((i + 1) % numBars);
          const rCur = INNER_R + barLen[i];
          const rNext = INNER_R + barLen[(i + 1) % numBars];
          const pTop = radPos(aR, rCur);
          ctx.lineTo(pTop.x, pTop.y);
          const pNext = radPos(aR, rNext);
          ctx.lineTo(pNext.x, pNext.y);
        }
        ctx.closePath();
        // 内圈逆时针挖空
        const pIn0 = radPos(0, INNER_R);
        ctx.moveTo(pIn0.x, pIn0.y);
        for (let a = Math.PI * 2; a >= 0; a -= 0.08) {
          const p = radPos(a, INNER_R);
          ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
      };

      // 渐变填充：蓝色（内）→ 白色（外）
      const fillGrad = ctx.createRadialGradient(cx, cy, INNER_R, cx, cy, MAX_OUTER);
      fillGrad.addColorStop(0, 'rgba(60, 140, 255, 0.7)');
      fillGrad.addColorStop(0.5, 'rgba(100, 170, 255, 0.55)');
      fillGrad.addColorStop(0.85, 'rgba(180, 210, 255, 0.45)');
      fillGrad.addColorStop(1, 'rgba(255, 255, 255, 0.3)');

      // 外辉光
      ctx.save();
      ctx.shadowColor = 'rgba(80, 150, 255, 0.6)';
      ctx.shadowBlur = minDim * 0.02;
      buildBandPath();
      ctx.fillStyle = fillGrad;
      ctx.fill('evenodd');
      ctx.restore();

      // 柱子径向分隔线：体现"柱子"结构，柱子之间粘在一起但有可见边界
      ctx.save();
      ctx.strokeStyle = 'rgba(8, 16, 32, 0.4)';
      ctx.lineWidth = Math.max(1, minDim * 0.0009);
      ctx.lineCap = 'butt';
      for (let i = 0; i < numBars; i++) {
        const a = angleAt(i);
        // 共享边只画到相邻两根中较矮那根的顶部
        const rL = INNER_R + barLen[(i - 1 + numBars) % numBars];
        const rR = INNER_R + barLen[i];
        const rEdge = Math.min(rL, rR);
        const pIn = radPos(a, INNER_R);
        const pOut = radPos(a, rEdge);
        ctx.beginPath();
        ctx.moveTo(pIn.x, pIn.y);
        ctx.lineTo(pOut.x, pOut.y);
        ctx.stroke();
      }
      ctx.restore();

      // 顶部亮芯描边（阶梯轮廓）
      ctx.beginPath();
      const pTop0 = radPos(angleAt(0), INNER_R + barLen[0]);
      ctx.moveTo(pTop0.x, pTop0.y);
      for (let i = 0; i < numBars; i++) {
        const aR = angleAt((i + 1) % numBars);
        const rCur = INNER_R + barLen[i];
        const rNext = INNER_R + barLen[(i + 1) % numBars];
        const pTop = radPos(aR, rCur);
        ctx.lineTo(pTop.x, pTop.y);
        const pNext = radPos(aR, rNext);
        ctx.lineTo(pNext.x, pNext.y);
      }
      ctx.closePath();
      ctx.strokeStyle = 'rgba(220, 235, 255, 0.75)';
      ctx.lineWidth = minDim * 0.0018;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
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
