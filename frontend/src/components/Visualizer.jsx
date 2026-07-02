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

    // ---- 模式：环形频谱（柱子粘在一起的实心环带 · 现代精美版） ----
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

      // bass 能量（前 8 段平均），驱动中心脉动
      let bass = 0;
      if (hasData) {
        for (let i = 0; i < 8; i++) bass += smooth[i];
        bass /= 8;
      } else {
        bass = 0.05 + Math.sin(Date.now() * 0.001) * 0.03;
      }
      bassSmoothRef.current += (bass - bassSmoothRef.current) * 0.2;
      const bassSmooth = bassSmoothRef.current;

      // ---- 中心双层辉光（更细腻现代） ----
      // 外层柔光晕
      const haloR = INNER_R * (1.8 + bassSmooth * 0.3);
      const haloGrad = ctx.createRadialGradient(cx, cy, INNER_R * 0.4, cx, cy, haloR);
      haloGrad.addColorStop(0, `rgba(90, 160, 255, ${0.14 + bassSmooth * 0.08})`);
      haloGrad.addColorStop(0.6, `rgba(140, 180, 255, 0.05)`);
      haloGrad.addColorStop(1, 'rgba(180, 200, 255, 0)');
      ctx.fillStyle = haloGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
      ctx.fill();

      // 内层亮核：蓝→白
      const coreR = INNER_R * (0.95 + bassSmooth * 0.15);
      const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
      coreGrad.addColorStop(0, `rgba(215, 232, 255, ${0.55 + bassSmooth * 0.2})`);
      coreGrad.addColorStop(0.45, `rgba(120, 170, 255, 0.3)`);
      coreGrad.addColorStop(1, 'rgba(80, 140, 255, 0)');
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.fill();

      // ---- 频谱柱环带：柱子粘在一起 ----
      const numBars = NUM_BARS;
      const angleStep = (Math.PI * 2) / numBars;
      const angleAt = (i) => i * angleStep - Math.PI / 2;
      const radPos = (a, r) => ({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });

      const barLen = [];
      for (let i = 0; i < numBars; i++) {
        const value = hasData ? smooth[i] : 0.04;
        barLen.push(Math.max(2, value * safeBarScale * (hasData ? 1.0 : 0.4)));
      }

      // 构建阶梯外轮廓 + 内圈挖空（evenodd 填充环带）
      const buildBandPath = () => {
        ctx.beginPath();
        const p0 = radPos(angleAt(0), INNER_R + barLen[0]);
        ctx.moveTo(p0.x, p0.y);
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
        const pIn0 = radPos(0, INNER_R);
        ctx.moveTo(pIn0.x, pIn0.y);
        for (let a = Math.PI * 2; a >= 0; a -= 0.08) {
          const p = radPos(a, INNER_R);
          ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
      };

      // 现代渐变：青蓝 → 亮蓝 → 蓝紫 → 淡紫白
      const fillGrad = ctx.createRadialGradient(cx, cy, INNER_R, cx, cy, MAX_OUTER);
      fillGrad.addColorStop(0, 'rgba(79, 195, 247, 0.78)');
      fillGrad.addColorStop(0.45, 'rgba(100, 170, 255, 0.62)');
      fillGrad.addColorStop(0.8, 'rgba(159, 168, 218, 0.5)');
      fillGrad.addColorStop(1, 'rgba(222, 222, 255, 0.35)');

      // 外柔光层
      ctx.save();
      ctx.shadowColor = 'rgba(100, 160, 255, 0.55)';
      ctx.shadowBlur = minDim * 0.025;
      buildBandPath();
      ctx.fillStyle = fillGrad;
      ctx.fill('evenodd');
      ctx.restore();

      // 柱子径向分隔线：极淡白色（非黑色），更现代精致
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.13)';
      ctx.lineWidth = Math.max(0.8, minDim * 0.0007);
      ctx.lineCap = 'butt';
      for (let i = 0; i < numBars; i++) {
        const a = angleAt(i);
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

      // 每根柱子顶部圆角高光 cap（立体感）
      ctx.save();
      const capR = Math.max(1.5, minDim * 0.0035);
      for (let i = 0; i < numBars; i++) {
        const a = angleAt(i) + angleStep / 2;
        const r = INNER_R + barLen[i];
        const p = radPos(a, r);
        const capGrad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, capR * 2);
        capGrad.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
        capGrad.addColorStop(0.5, 'rgba(220, 235, 255, 0.4)');
        capGrad.addColorStop(1, 'rgba(200, 220, 255, 0)');
        ctx.fillStyle = capGrad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, capR * 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // 顶部阶梯亮芯描边
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
      ctx.strokeStyle = 'rgba(230, 240, 255, 0.7)';
      ctx.lineWidth = minDim * 0.0016;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();

      // ---- 内圈玻璃高光环（带发光） ----
      ctx.save();
      ctx.strokeStyle = 'rgba(180, 215, 255, 0.55)';
      ctx.lineWidth = Math.max(1, minDim * 0.0018);
      ctx.shadowColor = 'rgba(120, 170, 255, 0.7)';
      ctx.shadowBlur = minDim * 0.018;
      ctx.beginPath();
      ctx.arc(cx, cy, INNER_R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // 内圈内侧细高光（玻璃质感）
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.lineWidth = Math.max(0.5, minDim * 0.0007);
      ctx.beginPath();
      ctx.arc(cx, cy, INNER_R - minDim * 0.005, 0, Math.PI * 2);
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
