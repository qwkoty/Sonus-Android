import { useEffect, useRef } from 'react';
import { getSpectrumBars, readTimeDomainData } from '../audio/engine';

const NUM_BARS = 64;

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
  const bassPrevRef = useRef(0);          // bass 峰值检测
  const shockwavesRef = useRef([]);       // 冲击波池
  const breathPhaseRef = useRef(0);       // 呼吸相位（待机节奏）
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

    const palette = () => {
      const [H] = hexToHsl(accentRef.current);
      return {
        H,
        glow:  `hsla(${H}, 80%, 60%, 0.7)`,
        waveCore: `hsl(${H}, 82%, 65%)`,
        stroke: `hsla(${H + 10}, 80%, 88%, 0.72)`,
      };
    };

    // ============ 环形：强呼吸 + 冲击波 + 光刺 ============
    const drawRadialWave = (spectrum, hasData) => {
      const C = palette();
      const data = spectrum;
      const [H] = hexToHsl(accentRef.current);

      const smooth = smoothRef.current;
      for (let i = 0; i < NUM_BARS; i++) {
        smooth[i] += (data[i] - smooth[i]) * 0.35;
      }

      const tNow = Date.now() * 0.001;

      // 频段提取
      let bass = 0, mid = 0, treble = 0;
      if (hasData) {
        for (let i = 0; i < 8; i++) bass += smooth[i];
        bass /= 8;
        for (let i = 8; i < 28; i++) mid += smooth[i];
        mid /= 20;
        for (let i = 28; i < NUM_BARS; i++) treble += smooth[i];
        treble /= (NUM_BARS - 28);
      } else {
        // 待机呼吸：明显 4 拍节奏
        bass = 0.10 + Math.sin(tNow * 1.6) * 0.06;
        mid = 0.07 + Math.sin(tNow * 2.2 + 1) * 0.04;
        treble = 0.04 + Math.sin(tNow * 2.8 + 2) * 0.03;
      }

      bassSmoothRef.current += (bass - bassSmoothRef.current) * 0.22;
      const bassSmooth = bassSmoothRef.current;

      // ===== bass 峰值检测 → 生成冲击波 =====
      const bassDelta = bass - bassPrevRef.current;
      bassPrevRef.current = bass;
      if (hasData && bass > 0.42 && bassDelta > 0.12) {
        shockwavesRef.current.push({
          radius: minDim * 0.06,
          alpha: 0.85,
          speed: minDim * 0.012,
          width: Math.max(2, minDim * 0.004),
        });
      }
      // 冲击波上限，避免堆积
      if (shockwavesRef.current.length > 6) {
        shockwavesRef.current.splice(0, shockwavesRef.current.length - 6);
      }

      // ===== 强力呼吸缩放 =====
      breathPhaseRef.current += 0.018;
      const idleBreath = Math.sin(breathPhaseRef.current) * 0.04;       // 待机 ±4%
      const bassBreath = bassSmooth * 0.18;                              // bass 命中 +18%
      const breath = 1 + idleBreath + bassBreath;

      const INNER_R = minDim * 0.05 * breath;
      const MAX_R = minDim * 0.5 * 0.9 * breath;

      // === 1. 外圈大光晕（随 bass 亮度脉冲）===
      const haloR = MAX_R * 1.15;
      const haloGrad = ctx.createRadialGradient(cx, cy, MAX_R * 0.5, cx, cy, haloR);
      haloGrad.addColorStop(0, `hsla(${H}, 75%, 55%, 0)`);
      haloGrad.addColorStop(0.6, `hsla(${H}, 78%, 58%, ${0.04 + bassSmooth * 0.08})`);
      haloGrad.addColorStop(1, `hsla(${H}, 75%, 55%, 0)`);
      ctx.fillStyle = haloGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
      ctx.fill();

      // === 2. 冲击波（扩散环 + 衰减）===
      const shocks = shockwavesRef.current;
      for (let i = shocks.length - 1; i >= 0; i--) {
        const s = shocks[i];
        s.radius += s.speed;
        s.alpha *= 0.955;
        if (s.alpha < 0.015 || s.radius > minDim * 0.6) {
          shocks.splice(i, 1);
          continue;
        }
        ctx.save();
        ctx.strokeStyle = `hsla(${H}, 90%, 75%, ${s.alpha})`;
        ctx.lineWidth = s.width;
        ctx.shadowColor = `hsla(${H}, 90%, 70%, 0.9)`;
        ctx.shadowBlur = minDim * 0.02;
        ctx.beginPath();
        ctx.arc(cx, cy, s.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // === 3. 64 根光刺辐射（频谱驱动，核心爽点）===
      const spikeBaseR = INNER_R * 2.2;
      const spikeMaxLen = (MAX_R - spikeBaseR) * 0.95;
      const spikeWidth = Math.max(2, (Math.PI * 2 * spikeBaseR) / NUM_BARS * 0.55);

      for (let i = 0; i < NUM_BARS; i++) {
        const angle = (i / NUM_BARS) * Math.PI * 2 - Math.PI / 2;
        const v = hasData ? smooth[i] : (0.05 + Math.sin(tNow * 1.6 + i * 0.2) * 0.04);
        // 待机时也保证光刺有最小长度，呼吸可见
        const len = Math.max(minDim * 0.015, v * spikeMaxLen + minDim * 0.012);
        const x0 = cx + Math.cos(angle) * spikeBaseR;
        const y0 = cy + Math.sin(angle) * spikeBaseR;
        const x1 = cx + Math.cos(angle) * (spikeBaseR + len);
        const y1 = cy + Math.sin(angle) * (spikeBaseR + len);

        // 颜色：低频暖色（H 偏红），高频冷色（H 偏蓝），能量高增亮
        const hueShift = (i / NUM_BARS) * 60;
        const lightness = 55 + v * 30;
        const alpha = 0.55 + v * 0.45;

        const grad = ctx.createLinearGradient(x0, y0, x1, y1);
        grad.addColorStop(0, `hsla(${H + hueShift}, 85%, ${lightness}%, ${alpha * 0.3})`);
        grad.addColorStop(0.4, `hsla(${H + hueShift}, 90%, ${lightness + 10}%, ${alpha * 0.8})`);
        grad.addColorStop(1, `hsla(${H + hueShift}, 95%, ${Math.min(92, lightness + 25)}%, ${alpha})`);

        ctx.save();
        ctx.strokeStyle = grad;
        ctx.lineWidth = spikeWidth;
        ctx.lineCap = 'round';
        ctx.shadowColor = `hsla(${H + hueShift}, 90%, 65%, 0.8)`;
        ctx.shadowBlur = minDim * 0.012;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        ctx.restore();
      }

      // === 4. 中心发光核心（随 bass 强力脉冲）===
      const coreR = INNER_R * (2.8 + bassSmooth * 4.5);
      const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
      coreGrad.addColorStop(0, `hsla(${H}, 95%, 95%, ${0.85 + bassSmooth * 0.15})`);
      coreGrad.addColorStop(0.2, `hsla(${H}, 90%, 72%, ${0.55 + bassSmooth * 0.3})`);
      coreGrad.addColorStop(0.5, `hsla(${H}, 80%, 58%, ${0.28 + bassSmooth * 0.18})`);
      coreGrad.addColorStop(0.8, `hsla(${H}, 75%, 52%, 0.08)`);
      coreGrad.addColorStop(1, `hsla(${H}, 75%, 50%, 0)`);
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.fill();

      // === 5. 中心实时波形圈 ===
      const wave = readTimeDomainData();
      const waveHasData = wave.length > 0 && isPlaying;
      ctx.save();
      ctx.strokeStyle = `hsla(${H}, 88%, 78%, ${hasData ? 0.7 : 0.3})`;
      ctx.lineWidth = Math.max(1.2, minDim * 0.0018);
      ctx.shadowColor = C.glow;
      ctx.shadowBlur = minDim * 0.018;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const waveR = MAX_R * 0.28;
      const STEPS = 120;
      if (waveHasData) {
        const step = wave.length / STEPS;
        for (let s = 0; s <= STEPS; s++) {
          const angle = (s / STEPS) * Math.PI * 2;
          const idx = Math.floor(s * step) % wave.length;
          const vv = (wave[idx] - 128) / 128;
          const r = waveR + vv * minDim * 0.035;
          const x = cx + Math.cos(angle) * r;
          const y = cy + Math.sin(angle) * r;
          if (s === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      } else {
        for (let s = 0; s <= STEPS; s++) {
          const angle = (s / STEPS) * Math.PI * 2;
          const vv = Math.sin(angle * 3 + tNow * 0.9) * 0.15 + Math.sin(angle * 5 - tNow * 1.3) * 0.1;
          const r = waveR + vv * minDim * 0.025;
          const x = cx + Math.cos(angle) * r;
          const y = cy + Math.sin(angle) * r;
          if (s === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      }
      ctx.closePath();
      ctx.stroke();
      ctx.restore();

      // === 6. 中心亮点（bass 命中闪烁）===
      const sparkR = INNER_R * (0.9 + bassSmooth * 1.6);
      const sparkGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, sparkR);
      sparkGrad.addColorStop(0, `rgba(255,255,255,${0.7 + bassSmooth * 0.3})`);
      sparkGrad.addColorStop(0.5, `hsla(${H}, 90%, 88%, 0.35)`);
      sparkGrad.addColorStop(1, `hsla(${H}, 90%, 85%, 0)`);
      ctx.fillStyle = sparkGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, sparkR, 0, Math.PI * 2);
      ctx.fill();

      // === 7. 待机涟漪（无数据时缓慢扩散）===
      if (!hasData) {
        for (let i = 0; i < 2; i++) {
          const ripplePhase = (tNow * 0.25 + i * 0.5) % 1;
          const rippleR = INNER_R + (MAX_R - INNER_R) * ripplePhase;
          const rippleAlpha = (1 - ripplePhase) * 0.12;
          ctx.save();
          ctx.strokeStyle = `hsla(${H}, 78%, 68%, ${rippleAlpha})`;
          ctx.lineWidth = Math.max(1, minDim * 0.0012);
          ctx.beginPath();
          ctx.arc(cx, cy, rippleR, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }
    };

    // ============ 波形条（保留原样）============
    const drawWave = (spectrum, hasData) => {
      const C = palette();
      const data = spectrum;

      const smooth = smoothRef.current;
      for (let i = 0; i < NUM_BARS; i++) {
        smooth[i] += (data[i] - smooth[i]) * 0.32;
      }

      const midY = cy;
      const maxAmp = h * 0.34;
      const barW = w / NUM_BARS;
      const gap = Math.max(1, barW * 0.18);
      const innerW = Math.max(1, barW - gap);

      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, midY);
      ctx.lineTo(w, midY);
      ctx.stroke();

      const bandH = h * 0.16;
      const bandGrad = ctx.createLinearGradient(0, midY - bandH, 0, midY + bandH);
      bandGrad.addColorStop(0, `hsla(${C.H}, 70%, 58%, 0)`);
      bandGrad.addColorStop(0.5, `hsla(${C.H}, 70%, 58%, 0.06)`);
      bandGrad.addColorStop(1, `hsla(${C.H}, 70%, 58%, 0)`);
      ctx.fillStyle = bandGrad;
      ctx.fillRect(0, midY - bandH, w, bandH * 2);

      const halfBarsW = NUM_BARS / 2;
      const tNowW = Date.now() * 0.001;
      for (let i = 0; i < NUM_BARS; i++) {
        const d = i <= halfBarsW ? halfBarsW - i : i - halfBarsW;
        const freqIdx = Math.round((d / halfBarsW) * (NUM_BARS - 1));
        const breathe = (Math.sin(tNowW * 1.6 + i * 0.15) * 0.5 + 0.5) * 0.08;
        const value = hasData
          ? Math.max(smooth[freqIdx], breathe)
          : 0.04 + breathe;
        const amp = Math.max(2, value * maxAmp * (hasData ? 1 : 0.4));
        const x = i * barW + gap / 2;

        const gUp = ctx.createLinearGradient(0, midY - amp, 0, midY);
        gUp.addColorStop(0, `hsla(${C.H + 36}, 54%, 76%, 0.42)`);
        gUp.addColorStop(0.5, `hsla(${C.H + 18}, 66%, 63%, 0.6)`);
        gUp.addColorStop(1, `hsla(${C.H}, 78%, 56%, 0.78)`);
        ctx.fillStyle = gUp;
        roundRectFill(ctx, x, midY - amp, innerW, amp, innerW * 0.35);

        const gDown = ctx.createLinearGradient(0, midY, 0, midY + amp);
        gDown.addColorStop(0, `hsla(${C.H}, 78%, 56%, 0.78)`);
        gDown.addColorStop(0.5, `hsla(${C.H + 18}, 66%, 63%, 0.6)`);
        gDown.addColorStop(1, `hsla(${C.H + 36}, 54%, 76%, 0.42)`);
        ctx.save();
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = gDown;
        roundRectFill(ctx, x, midY, innerW, amp, innerW * 0.35);
        ctx.restore();
      }

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
    bassPrevRef.current = 0;
    shockwavesRef.current = [];
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
