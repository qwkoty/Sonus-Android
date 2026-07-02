import { useEffect, useRef } from 'react';
import { getSpectrumBars, readTimeDomainData } from '../audio/engine';

const NUM_BARS = 64;

// hex → hsl，用于根据用户 DIY 主色派生整组配色
const hexToHsl = (hex) => {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h * 360, s * 100, l * 100];
};

export default function Visualizer({ isPlaying, mode = 'ring', accent = '#4FC3F7' }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const smoothRef = useRef(new Float32Array(NUM_BARS));
  const bassSmoothRef = useRef(0);
  const accentRef = useRef(accent);

  useEffect(() => { accentRef.current = accent; }, [accent]);

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

    // 根据当前 DIY 主色派生一组配色
    const palette = () => {
      const [H] = hexToHsl(accentRef.current);
      return {
        // 环带渐变（内→外）
        inner: `hsla(${H}, 78%, 56%, 0.78)`,
        mid:   `hsla(${H + 18}, 66%, 63%, 0.6)`,
        outer: `hsla(${H + 36}, 54%, 76%, 0.42)`,
        tip:   `hsla(${H + 40}, 48%, 86%, 0.32)`,
        // 中心
        coreBright: (a) => `hsla(${H}, 85%, 90%, ${a})`,
        coreMain:   (a) => `hsla(${H}, 75%, 60%, ${a})`,
        halo:       (a) => `hsla(${H}, 70%, 58%, ${a})`,
        // 玻璃环 / 描边
        glass: `hsla(${H}, 72%, 72%, 0.55)`,
        glow:  `hsla(${H}, 75%, 60%, 0.7)`,
        stroke: `hsla(${H + 10}, 80%, 88%, 0.72)`,
        // 波形
        waveCore: `hsl(${H}, 82%, 62%)`,
        waveGlow: `hsla(${H}, 80%, 60%, 1)`,
      };
    };

    // ---- 模式：环形频谱（柱子粘在一起的实心环带 · 自适应） ----
    const drawRing = (spectrum, hasData) => {
      const data = spectrum;
      const C = palette();

      const INNER_R = minDim * 0.15;
      const MAX_OUTER = minDim * 0.5 * 0.85;
      const MAX_BAR = MAX_OUTER - INNER_R;
      const safeBarScale = MAX_BAR / 1.2;

      const smooth = smoothRef.current;
      const smoothFactor = 0.35;
      for (let i = 0; i < NUM_BARS; i++) {
        smooth[i] += (data[i] - smooth[i]) * smoothFactor;
      }

      let bass = 0;
      if (hasData) {
        for (let i = 0; i < 8; i++) bass += smooth[i];
        bass /= 8;
      } else {
        bass = 0.05 + Math.sin(Date.now() * 0.001) * 0.03;
      }
      bassSmoothRef.current += (bass - bassSmoothRef.current) * 0.2;
      const bassSmooth = bassSmoothRef.current;

      // ---- 中心双层辉光 ----
      const haloR = INNER_R * (1.8 + bassSmooth * 0.3);
      const haloGrad = ctx.createRadialGradient(cx, cy, INNER_R * 0.4, cx, cy, haloR);
      haloGrad.addColorStop(0, C.halo(0.14 + bassSmooth * 0.08));
      haloGrad.addColorStop(0.6, C.halo(0.05));
      haloGrad.addColorStop(1, C.halo(0));
      ctx.fillStyle = haloGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
      ctx.fill();

      const coreR = INNER_R * (0.95 + bassSmooth * 0.15);
      const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
      coreGrad.addColorStop(0, C.coreBright(0.55 + bassSmooth * 0.2));
      coreGrad.addColorStop(0.45, C.coreMain(0.3));
      coreGrad.addColorStop(1, C.coreMain(0));
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.fill();

      // ---- 柱子粘在一起的环带 ----
      const numBars = NUM_BARS;
      const angleStep = (Math.PI * 2) / numBars;
      const angleAt = (i) => i * angleStep - Math.PI / 2;
      const radPos = (a, r) => ({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });

      const barLen = [];
      for (let i = 0; i < numBars; i++) {
        const value = hasData ? smooth[i] : 0.04;
        barLen.push(Math.max(2, value * safeBarScale * (hasData ? 1.0 : 0.4)));
      }

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

      const fillGrad = ctx.createRadialGradient(cx, cy, INNER_R, cx, cy, MAX_OUTER);
      fillGrad.addColorStop(0, C.inner);
      fillGrad.addColorStop(0.45, C.mid);
      fillGrad.addColorStop(0.8, C.outer);
      fillGrad.addColorStop(1, C.tip);

      ctx.save();
      ctx.shadowColor = C.glow;
      ctx.shadowBlur = minDim * 0.025;
      buildBandPath();
      ctx.fillStyle = fillGrad;
      ctx.fill('evenodd');
      ctx.restore();

      // 柱子径向分隔线（极淡白色）
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
      ctx.strokeStyle = C.stroke;
      ctx.lineWidth = minDim * 0.0016;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();

      // 内圈玻璃高光环
      ctx.save();
      ctx.strokeStyle = C.glass;
      ctx.lineWidth = Math.max(1, minDim * 0.0018);
      ctx.shadowColor = C.glow;
      ctx.shadowBlur = minDim * 0.018;
      ctx.beginPath();
      ctx.arc(cx, cy, INNER_R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.lineWidth = Math.max(0.5, minDim * 0.0007);
      ctx.beginPath();
      ctx.arc(cx, cy, INNER_R - minDim * 0.005, 0, Math.PI * 2);
      ctx.stroke();
    };

    // ---- 模式：波形（频谱柱镜像 + 渐变填充 + 中心线 · 自适应） ----
    const drawWave = (spectrum, hasData) => {
      const C = palette();
      const data = spectrum;

      // 平滑
      const smooth = smoothRef.current;
      for (let i = 0; i < NUM_BARS; i++) {
        smooth[i] += (data[i] - smooth[i]) * 0.32;
      }

      const midY = cy;
      const maxAmp = h * 0.34;
      const barW = w / NUM_BARS;
      const gap = Math.max(1, barW * 0.18);
      const innerW = Math.max(1, barW - gap);

      // 中心线（淡）
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, midY);
      ctx.lineTo(w, midY);
      ctx.stroke();

      // 镜像频谱柱：上下对称，每根柱子用垂直渐变填充
      for (let i = 0; i < NUM_BARS; i++) {
        const value = hasData ? smooth[i] : 0.04 + Math.sin(Date.now() * 0.002 + i * 0.2) * 0.02;
        const amp = Math.max(2, value * maxAmp * (hasData ? 1 : 0.4));
        const x = i * barW + gap / 2;

        // 上半柱
        const gUp = ctx.createLinearGradient(0, midY - amp, 0, midY);
        gUp.addColorStop(0, C.outer);
        gUp.addColorStop(0.5, C.mid);
        gUp.addColorStop(1, C.inner);
        ctx.fillStyle = gUp;
        roundRectFill(ctx, x, midY - amp, innerW, amp, innerW * 0.35);

        // 下半柱（镜像，更淡）
        const gDown = ctx.createLinearGradient(0, midY, 0, midY + amp);
        gDown.addColorStop(0, C.inner);
        gDown.addColorStop(0.5, C.mid);
        gDown.addColorStop(1, C.outer);
        ctx.save();
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = gDown;
        roundRectFill(ctx, x, midY, innerW, amp, innerW * 0.35);
        ctx.restore();
      }

      // 中心高光线（细亮）
      ctx.save();
      ctx.shadowColor = C.glow;
      ctx.shadowBlur = minDim * 0.012;
      ctx.strokeStyle = C.stroke;
      ctx.lineWidth = Math.max(1, minDim * 0.0014);
      ctx.beginPath();
      ctx.moveTo(0, midY);
      ctx.lineTo(w, midY);
      ctx.stroke();
      ctx.restore();

      // 叠加一条细波形示波器线，体现时域细节
      const wave = readTimeDomainData();
      const waveHasData = wave.length > 0 && isPlaying;
      ctx.save();
      ctx.strokeStyle = C.waveCore;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = Math.max(1, minDim * 0.0012);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      if (waveHasData) {
        const step = wave.length / w;
        for (let x = 0; x < w; x++) {
          const idx = Math.floor(x * step);
          const v = (wave[idx] - 128) / 128;
          const y = midY + v * maxAmp * 0.4;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      } else {
        const t = Date.now() * 0.002;
        for (let x = 0; x < w; x++) {
          const y = midY + Math.sin(x * 0.02 + t) * maxAmp * 0.08;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      ctx.restore();
    };

    // 圆角矩形填充辅助
    const roundRectFill = (c, x, y, bw, bh, r) => {
      r = Math.min(r, bw / 2, bh / 2);
      c.beginPath();
      c.moveTo(x + r, y);
      c.arcTo(x + bw, y, x + bw, y + bh, r);
      c.arcTo(x + bw, y + bh, x, y + bh, r);
      c.arcTo(x, y + bh, x, y, r);
      c.arcTo(x, y, x + bw, y, r);
      c.closePath();
      c.fill();
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      const { data, hasData } = getSpectrumBars(NUM_BARS);
      if (mode === 'wave') {
        drawWave(data, hasData);
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
