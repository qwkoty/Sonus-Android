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

      const smooth = smoothRef.current;
      for (let i = 0; i < NUM_BARS; i++) {
        smooth[i] += (data[i] - smooth[i]) * 0.32;
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

      const INNER_R = minDim * 0.08;
      const MAX_R = minDim * 0.5 * 0.88;
      const tNow = Date.now() * 0.001;

      const coreR = INNER_R * (2.2 + bassSmooth * 1.2);
      const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
      coreGrad.addColorStop(0, C.coreBright(0.85 + bassSmooth * 0.15));
      coreGrad.addColorStop(0.3, C.coreMain(0.5 + bassSmooth * 0.2));
      coreGrad.addColorStop(0.7, C.halo(0.2));
      coreGrad.addColorStop(1, C.halo(0));
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.fill();

      const NUM_RINGS = 5;
      const halfBars = NUM_BARS / 2;

      for (let ring = 0; ring < NUM_RINGS; ring++) {
        const baseR = INNER_R + (MAX_R - INNER_R) * ((ring + 1) / NUM_RINGS);
        const phase = ring * 0.8;
        const alpha = 0.75 - ring * 0.12;

        ctx.save();
        ctx.strokeStyle = `hsla(${hexToHsl(accentRef.current)[0] + ring * 8}, 80%, ${68 - ring * 4}%, ${alpha})`;
        ctx.lineWidth = Math.max(1.2, minDim * (0.0024 - ring * 0.0003));
        ctx.shadowColor = C.glow;
        ctx.shadowBlur = minDim * (0.02 - ring * 0.003);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        ctx.beginPath();
        const STEPS = 180;
        for (let s = 0; s <= STEPS; s++) {
          const angle = (s / STEPS) * Math.PI * 2;
          const dNorm = Math.abs(Math.sin(angle));
          const freqIdx = Math.min(NUM_BARS - 1, Math.floor(dNorm * NUM_BARS));
          const breathe = (Math.sin(tNow * 1.4 + angle * 3 + phase) * 0.5 + 0.5) * 0.06;
          const value = hasData ? Math.max(smooth[freqIdx], breathe) : 0.04 + breathe;
          const wave = Math.sin(tNow * 2.2 - ring * 0.6 + angle * 5) * 0.15;
          const amp = value * (MAX_R - INNER_R) * 0.18 * (hasData ? 1 : 0.4);
          const r = baseR + amp + wave * minDim * 0.008;
          const x = cx + Math.cos(angle) * r;
          const y = cy + Math.sin(angle) * r;
          if (s === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      }

      const outerGrad = ctx.createRadialGradient(cx, cy, MAX_R * 0.7, cx, cy, MAX_R);
      outerGrad.addColorStop(0, C.halo(0));
      outerGrad.addColorStop(0.7, C.halo(0.04 + bassSmooth * 0.03));
      outerGrad.addColorStop(1, C.halo(0));
      ctx.fillStyle = outerGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, MAX_R, 0, Math.PI * 2);
      ctx.fill();

      const sparkR = INNER_R * (0.6 + bassSmooth * 0.5);
      const sparkGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, sparkR);
      sparkGrad.addColorStop(0, 'rgba(255,255,255,0.9)');
      sparkGrad.addColorStop(0.5, C.coreBright(0.5));
      sparkGrad.addColorStop(1, C.coreBright(0));
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
