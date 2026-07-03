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
  const shockwavesRef = useRef([]);       // bass 冲击波池（手机限 3 个）
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
        inner: `hsla(${H}, 78%, 56%, 0.78)`,
        mid:   `hsla(${H + 18}, 66%, 63%, 0.6)`,
        outer: `hsla(${H + 36}, 54%, 76%, 0.42)`,
        tip:   `hsla(${H + 40}, 48%, 86%, 0.32)`,
        coreBright: (a) => `hsla(${H}, 85%, 90%, ${a})`,
        coreMain:   (a) => `hsla(${H}, 75%, 60%, ${a})`,
        halo:       (a) => `hsla(${H}, 70%, 58%, ${a})`,
        glass: `hsla(${H}, 72%, 72%, 0.55)`,
        glow:  `hsla(${H}, 75%, 60%, 0.7)`,
        stroke: `hsla(${H + 10}, 80%, 88%, 0.72)`,
        waveCore: `hsl(${H}, 82%, 62%)`,
        waveGlow: `hsla(${H}, 80%, 60%, 1)`,
      };
    };

    const drawRadialWave = (spectrum, hasData) => {
      const C = palette();
      const data = spectrum;
      const [H] = hexToHsl(accentRef.current);

      const smooth = smoothRef.current;
      for (let i = 0; i < NUM_BARS; i++) {
        smooth[i] += (data[i] - smooth[i]) * 0.32;
      }

      // 频段提取：bass / mid / treble
      const tNow = Date.now() * 0.001;
      let bass = 0, mid = 0, treble = 0;
      if (hasData) {
        for (let i = 0; i < 8; i++) bass += smooth[i];
        bass /= 8;
        for (let i = 8; i < 28; i++) mid += smooth[i];
        mid /= 20;
        for (let i = 28; i < NUM_BARS; i++) treble += smooth[i];
        treble /= (NUM_BARS - 28);
      } else {
        // 待机动画：缓慢呼吸
        bass = 0.08 + Math.sin(tNow * 0.8) * 0.04;
        mid = 0.05 + Math.sin(tNow * 1.2 + 1) * 0.03;
        treble = 0.03 + Math.sin(tNow * 1.6 + 2) * 0.02;
      }
      bassSmoothRef.current += (bass - bassSmoothRef.current) * 0.18;
      const bassSmooth = bassSmoothRef.current;

      // ===== bass 峰值检测 → 生成冲击波（手机限 3 个，避免堆积）=====
      const bassDelta = bass - bassPrevRef.current;
      bassPrevRef.current = bass;
      if (hasData && bass > 0.4 && bassDelta > 0.1) {
        shockwavesRef.current.push({
          radius: minDim * 0.05,
          alpha: 0.7,
          speed: minDim * 0.01,
          width: Math.max(2, minDim * 0.003),
        });
      }
      if (shockwavesRef.current.length > 3) {
        shockwavesRef.current.splice(0, shockwavesRef.current.length - 3);
      }

      // ===== 整体呼吸缩放（表现力增强，待机也活）=====
      const breathScale = 1 + Math.sin(tNow * 0.9) * 0.03 + bassSmooth * 0.14;

      const INNER_R = minDim * 0.04 * breathScale;
      const MAX_R = minDim * 0.5 * 0.88 * breathScale;

      // === 1. 中心填充：径向频谱（低频在中心，向外渐变到高频）===
      // 性能优化：层数 24→10，步数 120→64，手机带得动
      const FILL_STEPS = 64;
      const FILL_RINGS = 10;
      for (let layer = FILL_RINGS - 1; layer >= 0; layer--) {
        const layerProgress = layer / FILL_RINGS; // 0=中心, 1=边缘
        const layerR = INNER_R + (MAX_R * 0.65 - INNER_R) * layerProgress;
        // 频率映射：中心=低频，边缘=高频
        const freqIdx = Math.min(NUM_BARS - 1, Math.floor(layerProgress * NUM_BARS * 0.8));
        const layerValue = hasData ? smooth[freqIdx] : (0.04 + Math.sin(tNow * 0.8 + layer * 0.3) * 0.03);
        const alpha = (1 - layerProgress) * 0.06 + 0.02;
        const hue = H + layerProgress * 30;
        const lightness = 60 - layerProgress * 15;

        ctx.save();
        ctx.fillStyle = `hsla(${hue}, 75%, ${lightness}%, ${alpha + layerValue * 0.15})`;
        ctx.beginPath();
        for (let s = 0; s <= FILL_STEPS; s++) {
          const angle = (s / FILL_STEPS) * Math.PI * 2;
          const angleWave = Math.sin(tNow * 1.5 + angle * 3 + layer * 0.4) * 0.08;
          const amp = layerValue * minDim * 0.04 * (1 - layerProgress * 0.3);
          const r = layerR + amp + angleWave * minDim * 0.01;
          const x = cx + Math.cos(angle) * r;
          const y = cy + Math.sin(angle) * r;
          if (s === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // === 2. 中心发光核心（跟随低频脉动，增强脉冲范围）===
      const coreR = INNER_R * (3.0 + bassSmooth * 5.5);
      const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
      coreGrad.addColorStop(0, `hsla(${H}, 90%, 92%, ${0.8 + bassSmooth * 0.2})`);
      coreGrad.addColorStop(0.2, `hsla(${H}, 85%, 70%, ${0.5 + bassSmooth * 0.3})`);
      coreGrad.addColorStop(0.5, `hsla(${H}, 75%, 55%, ${0.25 + bassSmooth * 0.15})`);
      coreGrad.addColorStop(0.8, `hsla(${H}, 70%, 50%, 0.08)`);
      coreGrad.addColorStop(1, `hsla(${H}, 70%, 50%, 0)`);
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.fill();

      // === 3. 中心波形线（实时波形穿过中心，shadowBlur 减半省性能）===
      const wave = readTimeDomainData();
      const waveHasData = wave.length > 0 && isPlaying;
      ctx.save();
      ctx.strokeStyle = `hsla(${H}, 85%, 75%, ${hasData ? 0.6 : 0.25})`;
      ctx.lineWidth = Math.max(1, minDim * 0.0015);
      ctx.shadowColor = C.glow;
      ctx.shadowBlur = minDim * 0.008;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const waveR = MAX_R * 0.3;
      if (waveHasData) {
        const step = wave.length / FILL_STEPS;
        for (let s = 0; s <= FILL_STEPS; s++) {
          const angle = (s / FILL_STEPS) * Math.PI * 2;
          const idx = Math.floor(s * step) % wave.length;
          const v = (wave[idx] - 128) / 128;
          const r = waveR + v * minDim * 0.03;
          const x = cx + Math.cos(angle) * r;
          const y = cy + Math.sin(angle) * r;
          if (s === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      } else {
        // 待机：缓慢旋转的波形
        for (let s = 0; s <= FILL_STEPS; s++) {
          const angle = (s / FILL_STEPS) * Math.PI * 2;
          const v = Math.sin(angle * 3 + tNow * 0.8) * 0.15 + Math.sin(angle * 5 - tNow * 1.2) * 0.1;
          const r = waveR + v * minDim * 0.02;
          const x = cx + Math.cos(angle) * r;
          const y = cy + Math.sin(angle) * r;
          if (s === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      }
      ctx.closePath();
      ctx.stroke();
      ctx.restore();

      // === 4. 辐射波浪环：内圈=低频，外圈=高频 ===
      // 性能优化：环数 5→3，步数 180→96，shadowBlur 减半
      const NUM_RINGS = 3;
      for (let ring = 0; ring < NUM_RINGS; ring++) {
        const ringProgress = (ring + 1) / NUM_RINGS;
        const baseR = MAX_R * 0.35 + (MAX_R - MAX_R * 0.35) * ringProgress;
        const phase = ring * 0.8;
        const alpha = 0.75 - ring * 0.1;

        // 频率映射：内圈低频，外圈高频
        const freqStart = Math.floor(ringProgress * NUM_BARS * 0.6);
        const freqEnd = Math.min(NUM_BARS, Math.floor((ringProgress * 0.6 + 0.4) * NUM_BARS));
        const freqRange = Math.max(1, freqEnd - freqStart);

        ctx.save();
        ctx.strokeStyle = `hsla(${H + ring * 12}, 80%, ${70 - ring * 5}%, ${alpha})`;
        ctx.lineWidth = Math.max(1.0, minDim * (0.0025 - ring * 0.0003));
        ctx.shadowColor = C.glow;
        ctx.shadowBlur = minDim * (0.008 - ring * 0.001);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        ctx.beginPath();
        const STEPS = 96;
        for (let s = 0; s <= STEPS; s++) {
          const angle = (s / STEPS) * Math.PI * 2;
          const angleFreq = Math.abs(Math.sin(angle)) * freqRange;
          const freqIdx = Math.min(NUM_BARS - 1, freqStart + Math.floor(angleFreq));
          const breathe = (Math.sin(tNow * 1.4 + angle * 3 + phase) * 0.5 + 0.5) * 0.05;
          const value = hasData ? Math.max(smooth[freqIdx], breathe) : 0.03 + breathe;
          // 行波：从中心向外扩散
          const waveOffset = Math.sin(tNow * 2.2 - ring * 0.7 + angle * 4) * 0.1;
          const ampScale = (1 - ringProgress * 0.3);
          const amp = value * (MAX_R - INNER_R) * 0.14 * ampScale * (hasData ? 1 : 0.35);
          const r = baseR + amp + waveOffset * minDim * 0.005;
          const x = cx + Math.cos(angle) * r;
          const y = cy + Math.sin(angle) * r;
          if (s === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      }

      // === 5. bass 冲击波（扩散环，表现力增强）===
      const shocks = shockwavesRef.current;
      for (let i = shocks.length - 1; i >= 0; i--) {
        const sw = shocks[i];
        sw.radius += sw.speed;
        sw.alpha *= 0.955;
        if (sw.alpha < 0.015 || sw.radius > minDim * 0.55) {
          shocks.splice(i, 1);
          continue;
        }
        ctx.save();
        ctx.strokeStyle = `hsla(${H}, 90%, 75%, ${sw.alpha})`;
        ctx.lineWidth = sw.width;
        ctx.beginPath();
        ctx.arc(cx, cy, sw.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // === 6. 外圈光晕 ===
      const outerGrad = ctx.createRadialGradient(cx, cy, MAX_R * 0.7, cx, cy, MAX_R);
      outerGrad.addColorStop(0, `hsla(${H}, 70%, 55%, 0)`);
      outerGrad.addColorStop(0.7, `hsla(${H}, 70%, 55%, ${0.03 + bassSmooth * 0.04})`);
      outerGrad.addColorStop(1, `hsla(${H}, 70%, 55%, 0)`);
      ctx.fillStyle = outerGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, MAX_R, 0, Math.PI * 2);
      ctx.fill();

      // === 7. 待机时的扩散涟漪（性能：3→2）===
      if (!hasData) {
        for (let i = 0; i < 2; i++) {
          const ripplePhase = (tNow * 0.3 + i * 0.33) % 1;
          const rippleR = INNER_R + (MAX_R - INNER_R) * ripplePhase;
          const rippleAlpha = (1 - ripplePhase) * 0.15;
          ctx.save();
          ctx.strokeStyle = `hsla(${H}, 75%, 65%, ${rippleAlpha})`;
          ctx.lineWidth = Math.max(1, minDim * 0.001);
          ctx.beginPath();
          ctx.arc(cx, cy, rippleR, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }

      // === 8. 中心亮点（bass 命中增强闪烁）===
      const sparkR = INNER_R * (0.8 + bassSmooth * 1.6);
      const sparkGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, sparkR);
      sparkGrad.addColorStop(0, `rgba(255,255,255,${0.85 + bassSmooth * 0.15})`);
      sparkGrad.addColorStop(0.5, `hsla(${H}, 85%, 85%, 0.4)`);
      sparkGrad.addColorStop(1, `hsla(${H}, 85%, 85%, 0)`);
      ctx.fillStyle = sparkGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, sparkR, 0, Math.PI * 2);
      ctx.fill();
    };

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
      bandGrad.addColorStop(0, C.halo(0));
      bandGrad.addColorStop(0.5, C.halo(0.06));
      bandGrad.addColorStop(1, C.halo(0));
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
        gUp.addColorStop(0, C.outer);
        gUp.addColorStop(0.5, C.mid);
        gUp.addColorStop(1, C.inner);
        ctx.fillStyle = gUp;
        roundRectFill(ctx, x, midY - amp, innerW, amp, innerW * 0.35);

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
