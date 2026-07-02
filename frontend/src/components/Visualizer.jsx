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

    // ---- 模式：辐射波浪（从中心向外多层圆环波浪扩散 · 紧凑高强度 · 自适应） ----
    const drawRadialWave = (spectrum, hasData) => {
      const C = palette();
      const data = spectrum;

      // 平滑
      const smooth = smoothRef.current;
      for (let i = 0; i < NUM_BARS; i++) {
        smooth[i] += (data[i] - smooth[i]) * 0.32;
      }

      // 低频能量（中心脉动）
      let bass = 0;
      if (hasData) {
        for (let i = 0; i < 8; i++) bass += smooth[i];
        bass /= 8;
      } else {
        bass = 0.05 + Math.sin(Date.now() * 0.001) * 0.03;
      }
      bassSmoothRef.current += (bass - bassSmoothRef.current) * 0.2;
      const bassSmooth = bassSmoothRef.current;

      const tNow = Date.now() * 0.001;
      const MAX_R = minDim * 0.5 * 0.9;

      // ---- 中心核心：发光圆盘随低频脉动（紧凑，不撑大） ----
      const coreR = minDim * 0.05 * (1.4 + bassSmooth * 0.8);
      const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
      coreGrad.addColorStop(0, C.coreBright(0.95));
      coreGrad.addColorStop(0.3, C.coreMain(0.6 + bassSmooth * 0.25));
      coreGrad.addColorStop(0.75, C.halo(0.28));
      coreGrad.addColorStop(1, C.halo(0));
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.fill();

      // ---- 多层辐射波浪环（紧贴核心，无空隙，高强度跳动） ----
      const NUM_RINGS = 7;
      // 每环间距：紧凑等分，第一环紧贴核心
      const ringStep = (MAX_R - coreR) / NUM_RINGS;

      for (let ring = 0; ring < NUM_RINGS; ring++) {
        // 每环基础半径：第一环 = coreR + ringStep，紧贴核心，无空隙
        const baseR = coreR + ringStep * (ring + 1);
        // 每环扩散相位（错开，制造向外流动感）
        const phase = ring * 0.9;
        // 透明度从内到外递减
        const alpha = 0.82 - ring * 0.1;
        // 频段映射：内层环=低频，外层环=高频（中心低频，周围高频）
        const freqIdx = Math.min(NUM_BARS - 1, Math.floor((ring / (NUM_RINGS - 1)) * NUM_BARS));
        const ringFreq = hasData ? smooth[freqIdx] : 0.04;

        ctx.save();
        ctx.strokeStyle = `hsla(${hexToHsl(accentRef.current)[0] + ring * 10}, 82%, ${70 - ring * 4}%, ${alpha})`;
        // 线宽稍粗，增强强度感
        ctx.lineWidth = Math.max(1.5, minDim * (0.003 - ring * 0.00025));
        ctx.shadowColor = C.glow;
        ctx.shadowBlur = minDim * (0.025 - ring * 0.0025);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        ctx.beginPath();
        const STEPS = 200;
        for (let s = 0; s <= STEPS; s++) {
          const angle = (s / STEPS) * Math.PI * 2;
          // 基础呼吸波动：保证即使频谱为0也起伏
          const breathe = (Math.sin(tNow * 1.5 + angle * 3 + phase) * 0.5 + 0.5) * 0.08;
          const value = hasData ? Math.max(ringFreq, breathe) : 0.04 + breathe;
          // 行波：让波形随时间向外传播，增强流动感
          const wave = Math.sin(tNow * 2.4 - ring * 0.7 + angle * 6) * 0.18;
          // 振幅加大，强度更强
          const amp = value * ringStep * 1.1 * (hasData ? 1 : 0.45);
          const r = baseR + amp + wave * minDim * 0.007;
          const x = cx + Math.cos(angle) * r;
          const y = cy + Math.sin(angle) * r;
          if (s === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      }

      // ---- 外层柔光填充（最外圈淡淡的渐变环，增加层次） ----
      const outerGrad = ctx.createRadialGradient(cx, cy, MAX_R * 0.65, cx, cy, MAX_R);
      outerGrad.addColorStop(0, C.halo(0));
      outerGrad.addColorStop(0.7, C.halo(0.05 + bassSmooth * 0.04));
      outerGrad.addColorStop(1, C.halo(0));
      ctx.fillStyle = outerGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, MAX_R, 0, Math.PI * 2);
      ctx.fill();

      // ---- 中心亮点（最内核高光，随低频闪烁） ----
      const sparkR = coreR * (0.4 + bassSmooth * 0.3);
      const sparkGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, sparkR);
      sparkGrad.addColorStop(0, 'rgba(255,255,255,0.95)');
      sparkGrad.addColorStop(0.5, C.coreBright(0.55));
      sparkGrad.addColorStop(1, C.coreBright(0));
      ctx.fillStyle = sparkGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, sparkR, 0, Math.PI * 2);
      ctx.fill();
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

      // 中线两侧柔光带（增加层次与氛围）
      const bandH = h * 0.16;
      const bandGrad = ctx.createLinearGradient(0, midY - bandH, 0, midY + bandH);
      bandGrad.addColorStop(0, C.halo(0));
      bandGrad.addColorStop(0.5, C.halo(0.06));
      bandGrad.addColorStop(1, C.halo(0));
      ctx.fillStyle = bandGrad;
      ctx.fillRect(0, midY - bandH, w, bandH * 2);

      // 镜像频谱柱：上下对称，每根柱子用垂直渐变填充
      // 频段映射：屏幕中心 = 高频，向两侧递减到低频
      // 频谱 smooth[0]=低频 .. smooth[NUM_BARS-1]=高频
      const halfBarsW = NUM_BARS / 2;
      const tNowW = Date.now() * 0.001;
      for (let i = 0; i < NUM_BARS; i++) {
        // 距中心的步数（0..halfBarsW）
        const d = i <= halfBarsW ? halfBarsW - i : i - halfBarsW;
        // 映射频段：d=0 → 最低频，d=halfBarsW → 最高频
        const freqIdx = Math.round((d / halfBarsW) * (NUM_BARS - 1));
        // 基础呼吸波动：即使频谱为 0 也有起伏
        const breathe = (Math.sin(tNowW * 1.6 + i * 0.15) * 0.5 + 0.5) * 0.08;
        const value = hasData
          ? Math.max(smooth[freqIdx], breathe)
          : 0.04 + breathe;
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
        drawRadialWave(data, hasData);
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
