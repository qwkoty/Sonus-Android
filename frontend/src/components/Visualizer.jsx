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
        inner: `hsla(${H}, 82%, 60%, 0.88)`,
        mid:   `hsla(${H + 15}, 74%, 66%, 0.72)`,
        outer: `hsla(${H + 30}, 62%, 76%, 0.55)`,
        tip:   `hsla(${H + 40}, 85%, 90%, 0.85)`,
        coreBright: (a) => `hsla(${H}, 92%, 92%, ${a})`,
        coreMain:   (a) => `hsla(${H}, 80%, 64%, ${a})`,
        halo:       (a) => `hsla(${H}, 78%, 60%, ${a})`,
        glass: `hsla(${H}, 72%, 78%, 0.6)`,
        glow:  `hsla(${H}, 80%, 62%, 0.72)`,
        stroke: `hsla(${H + 10}, 82%, 88%, 0.75)`,
        waveCore: `hsl(${H}, 84%, 64%)`,
      };
    };

    const drawRing = (spectrum, hasData) => {
      const C = palette();
      const smooth = smoothRef.current;
      for (let i = 0; i < NUM_BARS; i++) {
        const target = spectrum[i];
        const k = target > smooth[i] ? 0.5 : 0.2;
        smooth[i] += (target - smooth[i]) * k;
      }

      let bass = 0;
      if (hasData) {
        for (let i = 0; i < 6; i++) bass += smooth[i];
        bass /= 6;
      } else {
        bass = 0.06 + Math.sin(Date.now() * 0.0012) * 0.04;
      }
      bassSmoothRef.current += (bass - bassSmoothRef.current) * 0.18;
      const bassSmooth = bassSmoothRef.current;

      const INNER_R = minDim * 0.12;
      const MAX_OUTER = minDim * 0.46;
      const MAX_BAR = MAX_OUTER - INNER_R - minDim * 0.02;

      const numBars = NUM_BARS;
      const angleStep = (Math.PI * 2) / numBars;
      const angleAt = (i) => i * angleStep - Math.PI / 2;
      const radPos = (a, r) => ({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
      const halfBars = numBars / 2;

      const haloR = INNER_R * (1.9 + bassSmooth * 0.35);
      const haloGrad = ctx.createRadialGradient(cx, cy, INNER_R * 0.3, cx, cy, haloR);
      haloGrad.addColorStop(0, C.coreBright(0.35 + bassSmooth * 0.2));
      haloGrad.addColorStop(0.4, C.coreMain(0.18 + bassSmooth * 0.1));
      haloGrad.addColorStop(1, C.halo(0));
      ctx.fillStyle = haloGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
      ctx.fill();

      const barLen = [];
      const tNow = Date.now() * 0.001;
      for (let i = 0; i < numBars; i++) {
        const d = i <= halfBars ? i : numBars - i;
        const freqIdx = Math.round((d / halfBars) * (NUM_BARS - 1));
        const breathe = (Math.sin(tNow * 1.6 + i * 0.18) * 0.5 + 0.5) * 0.06;
        const value = hasData ? Math.max(smooth[freqIdx], breathe) : 0.04 + breathe;
        barLen.push(Math.max(minDim * 0.006, value * MAX_BAR * (hasData ? 1.0 : 0.4)));
      }

      const BAR_RATIO = 0.78;
      const barHalfSpan = angleStep * BAR_RATIO / 2;

      const fillGrad = ctx.createRadialGradient(cx, cy, INNER_R, cx, cy, MAX_OUTER);
      fillGrad.addColorStop(0, C.inner);
      fillGrad.addColorStop(0.45, C.mid);
      fillGrad.addColorStop(0.82, C.outer);
      fillGrad.addColorStop(1, C.tip);

      ctx.save();
      ctx.shadowColor = C.glow;
      ctx.shadowBlur = minDim * 0.022;
      ctx.fillStyle = fillGrad;
      for (let i = 0; i < numBars; i++) {
        const a = angleAt(i);
        const rOut = INNER_R + barLen[i];
        const aL = a - barHalfSpan;
        const aR = a + barHalfSpan;
        const steps = 4;
        ctx.beginPath();
        for (let s = 0; s <= steps; s++) {
          const aa = aL + (aR - aL) * (s / steps);
          const p = radPos(aa, INNER_R);
          if (s === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        for (let s = 0; s <= steps; s++) {
          const aa = aR - (aR - aL) * (s / steps);
          const p = radPos(aa, rOut);
          ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = C.tip;
      ctx.globalAlpha = 0.65;
      ctx.lineWidth = Math.max(1, minDim * 0.0014);
      ctx.lineCap = 'round';
      ctx.shadowColor = C.glow;
      ctx.shadowBlur = minDim * 0.015;
      for (let i = 0; i < numBars; i++) {
        const a = angleAt(i);
        const rOut = INNER_R + barLen[i];
        const aL = a - barHalfSpan;
        const aR = a + barHalfSpan;
        ctx.beginPath();
        for (let s = 0; s <= 5; s++) {
          const aa = aL + (aR - aL) * (s / 5);
          const p = radPos(aa, rOut);
          if (s === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }
      ctx.restore();

      const coreR = INNER_R * (0.9 + bassSmooth * 0.15);
      const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
      coreGrad.addColorStop(0, 'rgba(255,255,255,0.92)');
      coreGrad.addColorStop(0.25, C.coreBright(0.9));
      coreGrad.addColorStop(0.6, C.coreMain(0.75));
      coreGrad.addColorStop(1, C.coreMain(0));
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.strokeStyle = C.glass;
      ctx.lineWidth = Math.max(1, minDim * 0.002);
      ctx.shadowColor = C.glow;
      ctx.shadowBlur = minDim * 0.015;
      ctx.beginPath();
      ctx.arc(cx, cy, INNER_R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = Math.max(0.8, minDim * 0.001);
      ctx.beginPath();
      ctx.arc(cx, cy, INNER_R - minDim * 0.006, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = C.glass;
      ctx.globalAlpha = 0.2;
      ctx.lineWidth = Math.max(0.5, minDim * 0.0006);
      ctx.setLineDash([minDim * 0.005, minDim * 0.009]);
      ctx.beginPath();
      ctx.arc(cx, cy, MAX_OUTER, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    };

    const drawWave = (spectrum, hasData) => {
      const C = palette();
      const smooth = smoothRef.current;
      for (let i = 0; i < NUM_BARS; i++) {
        const target = spectrum[i];
        const k = target > smooth[i] ? 0.5 : 0.2;
        smooth[i] += (target - smooth[i]) * k;
      }

      const midY = cy;
      const maxAmp = h * 0.34;
      const barW = w / NUM_BARS;
      const gap = Math.max(1, barW * 0.2);
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
      ctx.shadowColor = C.glow;
      ctx.shadowBlur = minDim * 0.015;
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
