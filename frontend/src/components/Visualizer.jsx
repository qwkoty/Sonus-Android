import { useEffect, useRef, memo } from 'react';
import { getSpectrumBars, readTimeDomainData } from '../audio/engine';

const NUM_BARS = 64;

// 解析 HEX 为 HSL；用户选灰色时，保留其低饱和度
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

// 把用户选的真实 HSL 转成 canvas 可用颜色，不再硬改饱和度/亮度
const hsl = (h, s, l, a = 1) => `hsla(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%, ${a})`;

function Visualizer({ isPlaying, mode = 'ring', accent = '#4FC3F7' }) {
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
      canvas.style.touchAction = 'none';
    };
    resize();
    window.addEventListener('resize', resize);

    // 阻止 wave 模式下双指/多指手势触发浏览器默认行为（缩放、滚动），避免卡顿
    const preventTouch = (e) => { if (e.touches.length > 1) e.preventDefault(); };
    canvas.addEventListener('touchstart', preventTouch, { passive: false });
    canvas.addEventListener('touchmove', preventTouch, { passive: false });

    // 触摸涟漪反馈：轻点可视化产生扩散涟漪（复用冲击波池，任意落点）
    let tapStart = null;
    const onTapStart = (e) => {
      const t = e.touches ? e.touches[0] : e;
      tapStart = { x: t.clientX, y: t.clientY, moved: false };
    };
    const onTapMove = (e) => {
      if (!tapStart) return;
      const t = e.touches ? e.touches[0] : e;
      if (Math.hypot(t.clientX - tapStart.x, t.clientY - tapStart.y) > 10) tapStart.moved = true;
    };
    const onTapEnd = () => {
      if (!tapStart || tapStart.moved) { tapStart = null; return; }
      const rect = canvas.getBoundingClientRect();
      const px = (tapStart.x - rect.left) * dpr;
      const py = (tapStart.y - rect.top) * dpr;
      shockwavesRef.current.push({
        radius: minDim * 0.02,
        alpha: 0.6,
        speed: minDim * 0.012,
        width: Math.max(2, minDim * 0.0035),
        cx: px, cy: py,
      });
      if (shockwavesRef.current.length > 4) {
        shockwavesRef.current.splice(0, shockwavesRef.current.length - 4);
      }
      tapStart = null;
    };
    canvas.addEventListener('touchstart', onTapStart, { passive: true });
    canvas.addEventListener('touchmove', onTapMove, { passive: true });
    canvas.addEventListener('touchend', onTapEnd, { passive: true });

    const palette = () => {
      const [H, S, L] = hexToHsl(accentRef.current);
      // 完全基于用户选中的颜色做层次感：
      // - 浅灰用户 → 整体灰度（S≈0）
      // - 鲜艳用户 → 保持鲜艳
      return {
        inner: hsl(H, S, L + 6, 0.78),
        mid:   hsl(H, S, L + 14, 0.6),
        outer: hsl(H, S, L + 24, 0.42),
        tip:   hsl(H, S, L + 36, 0.32),
        coreBright: (a) => hsl(H, S, Math.min(98, L + 40), a),
        coreMain:   (a) => hsl(H, S, L + 8, a),
        halo:       (a) => hsl(H, S, L + 4, a),
        glass: hsl(H, S, L + 18, 0.55),
        glow:  hsl(H, S, L + 2, 0.7),
        stroke: hsl(H, S, Math.min(98, L + 34), 0.72),
        waveCore: hsl(H, S, L + 10, 1),
        waveGlow: hsl(H, S, L, 1),
      };
    };

    const drawRadialWave = (spectrum, hasData) => {
      const C = palette();
      const data = spectrum;
      const [H, S] = hexToHsl(accentRef.current);

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
      if (hasData && bass > 0.45 && bassDelta > 0.14) { // 阈值调高（v1.22）：仅真·重低音才出冲击波，不连发
        shockwavesRef.current.push({
          radius: minDim * 0.05,
          alpha: 0.7,
          speed: minDim * 0.01,
          width: Math.max(2, minDim * 0.003),
          cx, cy, // 默认中心，触摸涟漪可自定义落点
        });
      }
      if (shockwavesRef.current.length > 4) { // 3→4：兼容触摸涟漪（v1.21）
        shockwavesRef.current.splice(0, shockwavesRef.current.length - 4);
      }

      // ===== 整体呼吸缩放（表现力增强，待机也活）=====
      const breathScale = 1 + Math.sin(tNow * 0.9) * 0.03 + bassSmooth * 0.14; // 0.20→0.14：呼吸收敛（v1.22）

      const INNER_R = minDim * 0.04 * breathScale;
      const MAX_R = minDim * 0.5 * 0.90 * breathScale; // 0.94→0.90：留 10% 边距，外圈不再贴边（v1.22）

      // === 1. 中心填充：径向频谱（低频在中心，向外渐变到高频）===
      // 性能优化：层数 24→10，步数 120→64，手机带得动
      const FILL_STEPS = 64;
      const FILL_RINGS = 12; // 10→12：层次更密（v1.21）
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
        ctx.fillStyle = `hsla(${hue}, ${S}%, ${lightness}%, ${alpha + layerValue * 0.15})`;
        ctx.beginPath();
        for (let s = 0; s <= FILL_STEPS; s++) {
          const angle = (s / FILL_STEPS) * Math.PI * 2;
          const angleWave = Math.sin(tNow * 1.5 + angle * 3 + layer * 0.4) * 0.08;
          const amp = layerValue * minDim * 0.045 * (1 - layerProgress * 0.3); // 0.06→0.045：中心填充收敛（v1.22）
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
      coreGrad.addColorStop(0, `hsla(${H}, ${S}%, 92%, ${0.8 + bassSmooth * 0.2})`);
      coreGrad.addColorStop(0.2, `hsla(${H}, ${S}%, 70%, ${0.5 + bassSmooth * 0.3})`);
      coreGrad.addColorStop(0.5, `hsla(${H}, ${S}%, 55%, ${0.25 + bassSmooth * 0.15})`);
      coreGrad.addColorStop(0.8, `hsla(${H}, ${S}%, 50%, 0.08)`);
      coreGrad.addColorStop(1, `hsla(${H}, ${S}%, 50%, 0)`);
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.fill();

      // === 3. 中心波形线（实时波形穿过中心，shadowBlur 减半省性能）===
      const wave = readTimeDomainData();
      const waveHasData = wave.length > 0 && isPlaying;
      ctx.save();
      ctx.strokeStyle = `hsla(${H}, ${S}%, 75%, ${hasData ? 0.6 : 0.25})`;
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
      const NUM_RINGS = 4; // 3→4：多一圈高频环（v1.21）
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
        ctx.strokeStyle = `hsla(${H + ring * 12}, ${S}%, ${70 - ring * 5}%, ${alpha})`;
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
          const amp = value * (MAX_R - INNER_R) * 0.15 * ampScale * (hasData ? 1 : 0.35); // 0.20→0.15：辐射环振幅收敛（v1.22）
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

      // === 4.5 频谱尖刺：外圈向外发射的声波刺，增强范围感与动感（开销低：64 条短线）===
      ctx.save();
      ctx.strokeStyle = `hsla(${H}, ${S}%, 82%, 0.5)`;
      ctx.lineWidth = Math.max(1, minDim * 0.0016);
      ctx.shadowColor = C.glow;
      ctx.shadowBlur = minDim * 0.006;
      ctx.lineCap = 'round';
      for (let s = 0; s < NUM_BARS; s++) {
        const angle = (s / NUM_BARS) * Math.PI * 2;
        const v = hasData ? smooth[s] : (0.03 + Math.sin(tNow * 2 + s) * 0.02);
        const len = v * minDim * 0.04; // 0.06→0.04：频谱尖刺收敛（v1.22）
        if (len < 1) continue;
        const r0 = MAX_R;
        const r1 = MAX_R + len;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * r0, cy + Math.sin(angle) * r0);
        ctx.lineTo(cx + Math.cos(angle) * r1, cy + Math.sin(angle) * r1);
        ctx.stroke();
      }
      ctx.restore();

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
        ctx.strokeStyle = `hsla(${H}, ${S}%, 75%, ${sw.alpha})`;
        ctx.lineWidth = sw.width;
        ctx.beginPath();
        ctx.arc(sw.cx !== undefined ? sw.cx : cx, sw.cy !== undefined ? sw.cy : cy, sw.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // === 6. 外圈光晕 ===
      const outerGrad = ctx.createRadialGradient(cx, cy, MAX_R * 0.7, cx, cy, MAX_R);
      outerGrad.addColorStop(0, `hsla(${H}, ${S}%, 55%, 0)`);
      outerGrad.addColorStop(0.7, `hsla(${H}, ${S}%, 55%, ${0.03 + bassSmooth * 0.04})`);
      outerGrad.addColorStop(1, `hsla(${H}, ${S}%, 55%, 0)`);
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
          ctx.strokeStyle = `hsla(${H}, ${S}%, 65%, ${rippleAlpha})`;
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
      sparkGrad.addColorStop(0.5, `hsla(${H}, ${S}%, 85%, 0.4)`);
      sparkGrad.addColorStop(1, `hsla(${H}, ${S}%, 85%, 0)`);
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
        smooth[i] += (data[i] - smooth[i]) * 0.28;
      }

      const midY = cy;
      const maxAmp = h * 0.36; // 0.48→0.36：留出动态空间，安静段明显更低（v1.22）
      const barW = w / NUM_BARS;
      // 细条：只留 1px 间距，形成一条连续的镜像频谱带
      const gap = Math.max(0.5, barW * 0.08);
      const innerW = Math.max(0.8, barW - gap);

      // 低频在中间、高频向两侧展开
      const halfBarsW = NUM_BARS / 2;
      const tNowW = Date.now() * 0.001;
      const pointsUp = [];
      const pointsDown = [];

      for (let i = 0; i < NUM_BARS; i++) {
        const d = i <= halfBarsW ? halfBarsW - i : i - halfBarsW;
        const freqIdx = Math.round((d / halfBarsW) * (NUM_BARS - 1));
        const breathe = (Math.sin(tNowW * 1.4 + i * 0.12) * 0.5 + 0.5) * 0.05;
        const value = hasData
          ? Math.max(smooth[freqIdx], breathe)
          : 0.03 + breathe;
        const amp = Math.max(1, value * maxAmp * (hasData ? 1 : 0.35));
        const x = i * barW + gap / 2 + innerW / 2;
        const yUp = midY - amp;
        const yDown = midY + amp;
        pointsUp.push({ x, y: yUp });
        pointsDown.push({ x, y: yDown });

        // 每一根细柱：从中心向两侧由浅到深
        const colAlpha = 0.25 + value * 0.55;
        const gUp = ctx.createLinearGradient(0, midY, 0, yUp);
        gUp.addColorStop(0, hslaWithAlpha(C.inner, colAlpha));
        gUp.addColorStop(1, hslaWithAlpha(C.outer, colAlpha * 0.6));
        ctx.fillStyle = gUp;
        roundRectFill(ctx, x - innerW / 2, yUp, innerW, midY - yUp, innerW * 0.2);

        const gDown = ctx.createLinearGradient(0, midY, 0, yDown);
        gDown.addColorStop(0, hslaWithAlpha(C.inner, colAlpha));
        gDown.addColorStop(1, hslaWithAlpha(C.outer, colAlpha * 0.45));
        ctx.fillStyle = gDown;
        roundRectFill(ctx, x - innerW / 2, midY, innerW, yDown - midY, innerW * 0.2);
      }

      // 顶部的发光描边（让镜像频谱更连贯柔和）
      ctx.save();
      ctx.shadowColor = C.glow;
      ctx.shadowBlur = minDim * 0.008;
      ctx.strokeStyle = C.stroke;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = Math.max(0.8, minDim * 0.0012);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      pointsUp.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      ctx.stroke();
      ctx.beginPath();
      pointsDown.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      ctx.stroke();
      ctx.restore();

      // 中心时间域波形线（更细的镜像线）
      const wave = readTimeDomainData();
      const waveHasData = wave.length > 0 && isPlaying;
      ctx.save();
      ctx.strokeStyle = C.waveCore;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = Math.max(0.7, minDim * 0.0009);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = C.glow;
      ctx.shadowBlur = minDim * 0.004;
      ctx.beginPath();
      if (waveHasData) {
        const step = wave.length / w;
        for (let px = 0; px < w; px++) {
          const idx = Math.floor(px * step);
          const v = (wave[idx] - 128) / 128;
          const y = midY + v * maxAmp * 0.28;
          if (px === 0) ctx.moveTo(px, y);
          else ctx.lineTo(px, y);
        }
      } else {
        const t = Date.now() * 0.002;
        for (let px = 0; px < w; px++) {
          const y = midY + Math.sin(px * 0.02 + t) * maxAmp * 0.06;
          if (px === 0) ctx.moveTo(px, y);
          else ctx.lineTo(px, y);
        }
      }
      ctx.stroke();
      ctx.restore();
    };

    // 辅助：从 hsla(...) 字符串中替换 alpha
    const hslaWithAlpha = (color, alpha) => {
      return color.replace(/hsla?\(([^)]+)\)/, (_, body) => {
        const parts = body.split(',').map(s => s.trim());
        const a = parts.length >= 4 ? parseFloat(parts[3]) : 1;
        return `hsla(${parts[0]}, ${parts[1]}, ${parts[2]}, ${a * alpha})`;
      });
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
      canvas.removeEventListener('touchstart', preventTouch);
      canvas.removeEventListener('touchmove', preventTouch);
      canvas.removeEventListener('touchstart', onTapStart);
      canvas.removeEventListener('touchmove', onTapMove);
      canvas.removeEventListener('touchend', onTapEnd);
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
        touchAction: 'none',
      }}
    />
  );
}

export default memo(Visualizer);
