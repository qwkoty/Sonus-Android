import { useEffect, useRef, memo } from 'react';
import * as THREE from 'three';
import { getSpectrumBars } from '../audio/engine';
import { getProxyUrl } from '../api/music';

const GRID = 142;             // 142x142 = 20164 ≈ 2 万粒子
const FOV = 55;

function hexToRGB(hex) {
  const c = hex.replace('#', '');
  const bigint = parseInt(c.length === 3 ? c.split('').map(x => x + x).join('') : c, 16);
  return {
    r: ((bigint >> 16) & 255) / 255,
    g: ((bigint >> 8) & 255) / 255,
    b: (bigint & 255) / 255,
  };
}

// 圆形粒子纹理：让点变成柔和的圆点，而非方形像素
function createParticleTexture() {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.42, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

// 3D 封面粒子画：2 万粒子构成可切换的动画形态
// 电影镜头：用户双指捏合缩放 + 双指划拉旋转（手势驱动），关闭自动旋转
// 动画预设：coverflow（粒子封面） / liquidmetal（液态金属）
function Visualizer3D({ accent = '#4FC3F7', cover = '', mode = 'coverflow', isPlaying = false, onReady }) {
  const containerRef = useRef(null);
  const accentRef = useRef(accent);
  const coverRef = useRef(cover);
  const isPlayingRef = useRef(isPlaying);
  const imageDataRef = useRef(null);  // 封面像素 RGBA
  const hasCoverRef = useRef(false);
  const coverVersionRef = useRef(0);
  const appliedCoverVersionRef = useRef(-1);
  const onReadyRef = useRef(onReady);
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);
  useEffect(() => { accentRef.current = accent; }, [accent]);
  useEffect(() => { coverRef.current = cover; }, [cover]);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
    // 恢复播放时重新应用封面色
    if (isPlaying) appliedCoverVersionRef.current = -1;
  }, [isPlaying]);

  // 3D 形态切换时做粒子重组动画
  const modeRef = useRef(mode);
  const transitionRef = useRef({ active: false, from: mode, to: mode, progress: 1 });
  useEffect(() => {
    if (modeRef.current !== mode) {
      transitionRef.current = { active: true, from: modeRef.current, to: mode, progress: 0 };
      modeRef.current = mode;
    }
  }, [mode]);

  // 手势状态（双指缩放 + 旋转；单指划动旋转）
  const gestureRef = useRef({
    zoom: 1.0,
    rotation: 0,
    targetZoom: 1.0,
    targetRotation: 0,
    pinching: false,
    startDist: 0,
    startAngle: 0,
    startZoom: 1.0,
    startRot: 0,
    dragging: false,
    startX: 0,
    autoRotate: true,
    lastInteractTime: 0,
  });

  // 加载封面并采样为 ImageData
  useEffect(() => {
    coverVersionRef.current += 1;
    if (!cover) { imageDataRef.current = null; hasCoverRef.current = false; return; }
    let cancelled = false;
    (async () => {
      try {
        const proxyUrl = await getProxyUrl(cover);
        if (cancelled) return;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          if (cancelled) return;
          try {
            const SIZE = GRID;
            const c = document.createElement('canvas');
            c.width = SIZE; c.height = SIZE;
            const cx = c.getContext('2d');
            const iw = img.width, ih = img.height;
            const s = Math.min(iw, ih);
            const sx = (iw - s) / 2, sy = (ih - s) / 2;
            cx.drawImage(img, sx, sy, s, s, 0, 0, SIZE, SIZE);
            imageDataRef.current = cx.getImageData(0, 0, SIZE, SIZE).data;
            hasCoverRef.current = true;
          } catch {
            imageDataRef.current = null;
            hasCoverRef.current = false;
          }
        };
        img.onerror = () => { imageDataRef.current = null; hasCoverRef.current = false; };
        img.src = proxyUrl;
      } catch {
        const img = new Image();
        img.onload = () => {
          if (cancelled) return;
          try {
            const SIZE = GRID;
            const c = document.createElement('canvas');
            c.width = SIZE; c.height = SIZE;
            const cx = c.getContext('2d');
            const iw = img.width, ih = img.height;
            const s = Math.min(iw, ih);
            const sx = (iw - s) / 2, sy = (ih - s) / 2;
            cx.drawImage(img, sx, sy, s, s, 0, 0, SIZE, SIZE);
            imageDataRef.current = cx.getImageData(0, 0, SIZE, SIZE).data;
            hasCoverRef.current = true;
          } catch {
            imageDataRef.current = null;
            hasCoverRef.current = false;
          }
        };
        img.onerror = () => { imageDataRef.current = null; hasCoverRef.current = false; };
        img.src = cover;
      }
    })();
    return () => { cancelled = true; };
  }, [cover]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const dpr = window.devicePixelRatio || 1;
    let W = container.offsetWidth;
    let H = container.offsetHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV, W / H, 0.1, 5000);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(dpr);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    container.appendChild(renderer.domElement);

    const FILL = 1.0;
    const MAX_Z_RATIO = 0.045;
    const DOME_DEPTH_RATIO = 0.02;       // 压平穹顶，侧面看不再膨胀
    const LIQUID_RADIUS_RATIO = 0.56;

    let planeSize, cameraZ;

    const computeLayout = () => {
      W = container.offsetWidth;
      H = container.offsetHeight;
      const aspect = W / H;
      const minDim = Math.min(W, H);
      cameraZ = minDim * 2.4;
      const halfFovRad = (FOV / 2) * Math.PI / 180;
      const visibleHalf = cameraZ * Math.tan(halfFovRad);
      planeSize = visibleHalf * FILL;
      camera.aspect = aspect;
      camera.position.z = cameraZ;
      camera.updateProjectionMatrix();
    };
    computeLayout();

    const COUNT = GRID * GRID;
    const positions = new Float32Array(COUNT * 3);
    const colors = new Float32Array(COUNT * 3);
    const origUV = new Float32Array(COUNT * 2);
    const distFromCenter = new Float32Array(COUNT);
    const basePositionsCover = new Float32Array(COUNT * 3);
    const baseNormalsCover = new Float32Array(COUNT * 3);
    const basePositionsLiquid = new Float32Array(COUNT * 3);
    const baseNormalsLiquid = new Float32Array(COUNT * 3);
    const coverLight = new Float32Array(COUNT);
    const bandArr = new Float32Array(COUNT);
    const freqBand = new Uint8Array(COUNT);
    const spectrumSmooth = new Float32Array(64);

    const buildBase = () => {
      let idx = 0;
      const half = planeSize;
      const step = (planeSize * 2) / (GRID - 1);
      for (let gy = 0; gy < GRID; gy++) {
        for (let gx = 0; gx < GRID; gx++) {
          const x = -half + gx * step;
          const y = half - gy * step;
          const u = gx / (GRID - 1);
          const v = gy / (GRID - 1);
          const dx = u - 0.5, dy = v - 0.5;
          const dc = Math.min(1, Math.sqrt(dx * dx + dy * dy) * 2);
          origUV[idx * 2] = u;
          origUV[idx * 2 + 1] = v;
          distFromCenter[idx] = dc;
          const band = Math.min(1, Math.abs(v - 0.5) * 2);
          bandArr[idx] = band;
          // 中间横面（band≈0）对应高频，向两极（band≈1）依次降低
          freqBand[idx] = Math.min(63, Math.floor((1 - band) * 63));

          // coverflow 默认形态：轻微穹顶平面
          const cbz = -planeSize * DOME_DEPTH_RATIO * (1 - Math.cos(dc * Math.PI / 2));
          basePositionsCover[idx * 3] = x;
          basePositionsCover[idx * 3 + 1] = y;
          basePositionsCover[idx * 3 + 2] = cbz;
          baseNormalsCover[idx * 3] = 0;
          baseNormalsCover[idx * 3 + 1] = 0;
          baseNormalsCover[idx * 3 + 2] = 1;

          // 液态金属：球面
          const theta = u * Math.PI * 2;
          const phi = (v - 0.5) * Math.PI;
          const r = planeSize * LIQUID_RADIUS_RATIO;
          const lx = r * Math.cos(phi) * Math.cos(theta);
          const ly = r * Math.sin(phi);
          const lz = r * Math.cos(phi) * Math.sin(theta);
          const len = Math.hypot(lx, ly, lz) || 1;
          basePositionsLiquid[idx * 3] = lx;
          basePositionsLiquid[idx * 3 + 1] = ly;
          basePositionsLiquid[idx * 3 + 2] = lz;
          baseNormalsLiquid[idx * 3] = lx / len;
          baseNormalsLiquid[idx * 3 + 1] = ly / len;
          baseNormalsLiquid[idx * 3 + 2] = lz / len;

          const initial = modeRef.current === 'liquidmetal' ? basePositionsLiquid : basePositionsCover;
          positions[idx * 3] = initial[idx * 3];
          positions[idx * 3 + 1] = initial[idx * 3 + 1];
          positions[idx * 3 + 2] = initial[idx * 3 + 2];
          idx++;
        }
      }
    };
    buildBase();

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: planeSize * 2 / GRID * 1.35,   // 粒子稍大，封面更清晰可见
      map: createParticleTexture(),
      vertexColors: true,
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
      sizeAttenuation: true,
      alphaTest: 0.02,
      blending: THREE.AdditiveBlending,
    });

    const points = new THREE.Points(geometry, material);
    scene.add(points);

    let raf;
    let lastTime = performance.now();
    const posAttr = geometry.attributes.position;
    const colorAttr = geometry.attributes.color;

    const sampleCover = (u, v) => {
      const d = imageDataRef.current;
      if (!d) return null;
      const px = Math.min(GRID - 1, Math.max(0, Math.floor(u * GRID)));
      const py = Math.min(GRID - 1, Math.max(0, Math.floor(v * GRID)));
      const i = (py * GRID + px) * 4;
      return [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255];
    };
    const applyCoverColors = () => {
      // 仅在播放中且已加载封面时应用封面颜色；暂停/未播放时使用主题色
      if (!hasCoverRef.current || !isPlayingRef.current) return false;
      for (let i = 0; i < COUNT; i++) {
        const u = origUV[i * 2];
        const v = origUV[i * 2 + 1];
        const s = sampleCover(u, v);
        const boost = 1.45;
        const minBright = 0.35;
        colorAttr.array[i * 3]     = Math.min(1, Math.max(s[0] * boost, minBright * (0.8 + s[0])));
        colorAttr.array[i * 3 + 1] = Math.min(1, Math.max(s[1] * boost, minBright * (0.8 + s[1])));
        colorAttr.array[i * 3 + 2] = Math.min(1, Math.max(s[2] * boost, minBright * (0.8 + s[2])));
        coverLight[i] = s[0] * 0.299 + s[1] * 0.587 + s[2] * 0.114;
      }
      colorAttr.needsUpdate = true;
      return true;
    };

    let firstFrame = true;
    let bassAttack = 0;
    let bassRelease = 0;
    let midSmooth = 0;
    let trebleSmooth = 0;

    const animate = () => {
      const { data, hasData } = getSpectrumBars(64);

      let bass = 0, mid = 0, treble = 0;
      if (hasData) {
        for (let i = 0; i < 8; i++) bass += data[i];
        bass /= 8;
        for (let i = 8; i < 32; i++) mid += data[i];
        mid /= 24;
        for (let i = 32; i < 64; i++) treble += data[i];
        treble /= 32;
      } else {
        const t = Date.now() * 0.001;
        bass = 0.20 + Math.sin(t * 0.60) * 0.10 + Math.sin(t * 1.25) * 0.06;
        mid = 0.14 + Math.sin(t * 0.90 + 1) * 0.07;
        treble = 0.10 + Math.sin(t * 1.20 + 2) * 0.05;
      }
      if (bass > bassAttack) bassAttack += (bass - bassAttack) * 0.55;
      else bassAttack += (bass - bassAttack) * 0.28;
      bassRelease += (bass - bassRelease) * 0.12;
      midSmooth += (mid - midSmooth) * 0.22;
      trebleSmooth += (treble - trebleSmooth) * 0.28;
      for (let i = 0; i < 64; i++) {
        spectrumSmooth[i] += (data[i] - spectrumSmooth[i]) * 0.25;
      }

      const bassPulse = Math.max(0, bassAttack - bassRelease);
      const totalEnergy = (bassAttack + midSmooth * 0.7 + trebleSmooth * 0.4) / 2.1;

      const now = performance.now();
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;
      const time = now * 0.001;
      const zAmp = planeSize * MAX_Z_RATIO;
      const isPlaying = isPlayingRef.current;
      const useCover = isPlaying && hasCoverRef.current;

      if (useCover && appliedCoverVersionRef.current !== coverVersionRef.current) {
        if (applyCoverColors()) appliedCoverVersionRef.current = coverVersionRef.current;
      }

      // 未播放/暂停时强制回到主题色
      const needColorUpdate = !useCover;
      const accentRGB = hexToRGB(accentRef.current || '#4FC3F7');

      // 形态切换：粒子从旧形态插值到新形态
      const tr = transitionRef.current;
      let morphT = 1;
      let targetShape = modeRef.current || 'coverflow';
      let fromBase = null, toBase = null, toNormals = null;
      if (tr.active) {
        tr.progress += dt / 0.85;
        if (tr.progress >= 1) {
          tr.progress = 1;
          tr.active = false;
        }
        morphT = 1 - Math.pow(1 - tr.progress, 3);
        targetShape = tr.to || 'coverflow';
        fromBase = tr.from === 'liquidmetal' ? basePositionsLiquid : basePositionsCover;
        toBase = tr.to === 'liquidmetal' ? basePositionsLiquid : basePositionsCover;
        toNormals = tr.to === 'liquidmetal' ? baseNormalsLiquid : baseNormalsCover;
      } else {
        toBase = targetShape === 'liquidmetal' ? basePositionsLiquid : basePositionsCover;
        toNormals = targetShape === 'liquidmetal' ? baseNormalsLiquid : baseNormalsCover;
        fromBase = toBase;
      }

      for (let i = 0; i < COUNT; i++) {
        const u = origUV[i * 2];
        const v = origUV[i * 2 + 1];
        const dc = distFromCenter[i];

        let bx, by, bz, nx, ny, nz;
        if (tr.active) {
          const fbx = fromBase[i * 3];
          const fby = fromBase[i * 3 + 1];
          const fbz = fromBase[i * 3 + 2];
          const tbx = toBase[i * 3];
          const tby = toBase[i * 3 + 1];
          const tbz = toBase[i * 3 + 2];
          bx = fbx + (tbx - fbx) * morphT;
          by = fby + (tby - fby) * morphT;
          bz = fbz + (tbz - fbz) * morphT;
          nx = toNormals[i * 3];
          ny = toNormals[i * 3 + 1];
          nz = toNormals[i * 3 + 2];
        } else {
          bx = toBase[i * 3];
          by = toBase[i * 3 + 1];
          bz = toBase[i * 3 + 2];
          nx = toNormals[i * 3];
          ny = toNormals[i * 3 + 1];
          nz = toNormals[i * 3 + 2];
        }

        let x = bx, y = by, z = bz;

        // 8 个粒子一组，共享相位和基础律动，避免零碎跳动
        const group = Math.floor(i / 8);
        const groupPhase = group * 0.85;

        if (targetShape === 'coverflow') {
          // 粒子封面：整个面 3D 飘动，幅度随整体能量起伏，连续细腻
          const audioAmp = 0.45 + totalEnergy * 1.3;
          const waveX = Math.sin(u * 5 * Math.PI + time * 0.8) * Math.cos(v * 3 * Math.PI + time * 0.5) * 0.22;
          const waveY = Math.cos(u * 4 * Math.PI + time * 0.6) * Math.sin(v * 5 * Math.PI + time * 0.7) * 0.22;
          const waveZ = Math.sin((u + v) * 6 * Math.PI + time * 0.9) * 0.28 + Math.sin(dc * 8 - time * 1.2) * 0.08;
          const amp = zAmp * audioAmp;
          x = bx + waveX * amp;
          y = by + waveY * amp;
          z = bz + waveZ * amp;
        } else if (targetShape === 'liquidmetal') {
          // 液态金属：球体中间横面为高频+节奏律动，向两极依次降低；两端做舒缓起伏
          const band = bandArr[i]; // 0=赤道(最中间), 1=两极(两端)

          // 中间活跃区：约 72% 范围跟随节奏，超出后快速衰减
          const activeRange = 0.72;
          const activeFactor = band < activeRange ? Math.pow(1 - band / activeRange, 0.55) : 0;
          const idleFactor = 1 - activeFactor;

          // 64 个频谱条压缩为 8 个粗频段，8 个粒子共享一个频段能量
          // 中间对应高频 coarseBand=7，向两极依次降低
          const coarseBand = Math.min(7, Math.floor(freqBand[i] / 8));
          let energy = 0;
          for (let k = coarseBand * 8; k < (coarseBand + 1) * 8 && k < 64; k++) energy += spectrumSmooth[k];
          energy /= 8;

          // 中间区域整体律动，向边缘按 activeFactor 衰减
          const localPulse = (energy * 1.15 + bassAttack * 0.7 + midSmooth * 0.5) * activeFactor;
          const displacement = localPulse * planeSize * 0.09;

          const baseR = planeSize * LIQUID_RADIUS_RATIO * (0.82 + (coverLight[i] || 0.5) * 0.36);

          // 中间横面波纹，越往中间越明显
          const wave = (midSmooth * 0.9 + bassAttack * 0.6) * Math.sin(u * 56 + time * 5 + groupPhase) * planeSize * 0.008 * activeFactor;
          // 赤道起伏：中间有舒缓横波，向边缘衰减
          const equatorWave = (midSmooth * 0.8 + bassAttack * 0.6) * Math.sin(u * 48 + time * 4.5 + groupPhase) * planeSize * 0.011 * activeFactor;
          // 鼓点冲击集中在中间横面
          const bassBoost = bassPulse * planeSize * 0.09 * activeFactor;

          // 两端独立的舒缓起伏动画，不跟节奏但让整体更合群
          const idleWave = idleFactor * Math.sin(v * 20 + time * 1.8 + groupPhase * 0.4) * Math.cos(u * 14 + time * 1.3) * planeSize * 0.06;

          const r = baseR + displacement + wave + equatorWave + bassBoost + idleWave;
          x = nx * r;
          y = ny * r;
          z = nz * r;
        }

        posAttr.array[i * 3] = x;
        posAttr.array[i * 3 + 1] = y;
        posAttr.array[i * 3 + 2] = z;

        if (needColorUpdate) {
          const windGlow = targetShape === 'coverflow' ? Math.abs(z - bz) / (planeSize * 0.12 + 0.001) * 0.12 : 0;
          const intensity = 0.42 + totalEnergy * 1.6 + windGlow;
          const outFactor = 1 - dc * 0.25;
          colorAttr.array[i * 3]     = Math.min(1, accentRGB.r * intensity * outFactor + bassPulse * 0.65);
          colorAttr.array[i * 3 + 1] = Math.min(1, accentRGB.g * intensity * outFactor + bassPulse * 0.65);
          colorAttr.array[i * 3 + 2] = Math.min(1, accentRGB.b * intensity * outFactor + bassPulse * 0.65 + windGlow * 0.35);
        }
      }
      posAttr.needsUpdate = true;
      if (needColorUpdate) colorAttr.needsUpdate = true;

      // 360° 自动旋转：无手势交互 1.5s 后缓慢旋转，交互时暂停
      const g = gestureRef.current;
      if (g.autoRotate && !g.dragging && !g.pinching && now - g.lastInteractTime > 1500) {
        g.targetRotation += dt * 0.35;
      }
      g.zoom += (g.targetZoom - g.zoom) * 0.18;
      g.rotation += (g.targetRotation - g.rotation) * 0.18;
      const clampedZoom = Math.max(0.4, Math.min(3.0, g.zoom));
      camera.position.z = cameraZ / clampedZoom;
      points.rotation.y = g.rotation;
      points.rotation.x = -0.12;
      points.rotation.z = 0;
      camera.position.x = 0;
      camera.position.y = 0;
      camera.lookAt(0, 0, 0);

      points.scale.set(1, 1, 1);

      renderer.render(scene, camera);

      if (firstFrame) {
        firstFrame = false;
        if (onReadyRef.current) onReadyRef.current();
      }
      raf = requestAnimationFrame(animate);
    };
    animate();

    // 手势控制
    const dom = renderer.domElement;
    const dist = (t1, t2) => Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
    const angle = (t1, t2) => Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX);
    const ROTATE_SENSITIVITY = 0.006;
    const onTouchStart = (e) => {
      const g = gestureRef.current;
      g.lastInteractTime = performance.now();
      if (e.touches.length === 1) {
        g.dragging = true;
        g.startX = e.touches[0].clientX;
        g.startRot = g.targetRotation;
      } else if (e.touches.length === 2) {
        g.pinching = true;
        g.dragging = false;
        g.startDist = dist(e.touches[0], e.touches[1]);
        g.startAngle = angle(e.touches[0], e.touches[1]);
        g.startZoom = g.targetZoom;
        g.startRot = g.targetRotation;
      }
    };
    const onTouchMove = (e) => {
      const g = gestureRef.current;
      g.lastInteractTime = performance.now();
      if (g.pinching && e.touches.length === 2) {
        e.preventDefault();
        const d = dist(e.touches[0], e.touches[1]);
        const a = angle(e.touches[0], e.touches[1]);
        const scale = d / Math.max(1, g.startDist);
        g.targetZoom = Math.max(0.4, Math.min(3.0, g.startZoom * scale));
        g.targetRotation = g.startRot + (a - g.startAngle);
      } else if (g.dragging && e.touches.length === 1) {
        e.preventDefault();
        const dx = e.touches[0].clientX - g.startX;
        g.targetRotation = g.startRot + dx * ROTATE_SENSITIVITY;
      }
    };
    const onTouchEnd = (e) => {
      const g = gestureRef.current;
      if (e.touches.length < 2) g.pinching = false;
      if (e.touches.length < 1) g.dragging = false;
      g.lastInteractTime = performance.now();
    };
    const onWheel = (e) => {
      const g = gestureRef.current;
      g.lastInteractTime = performance.now();
      g.targetZoom = Math.max(0.4, Math.min(3.0, g.targetZoom * (e.deltaY > 0 ? 0.92 : 1.08)));
    };
    dom.style.touchAction = 'none';
    dom.addEventListener('touchstart', onTouchStart, { passive: false });
    dom.addEventListener('touchmove', onTouchMove, { passive: false });
    dom.addEventListener('touchend', onTouchEnd);
    dom.addEventListener('wheel', onWheel, { passive: true });

    const handleResize = () => {
      computeLayout();
      buildBase();
      posAttr.needsUpdate = true;
      material.size = planeSize * 2 / GRID * 1.35;
      renderer.setSize(W, H);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', handleResize);
      dom.removeEventListener('touchstart', onTouchStart);
      dom.removeEventListener('touchmove', onTouchMove);
      dom.removeEventListener('touchend', onTouchEnd);
      dom.removeEventListener('wheel', onWheel);
      renderer.dispose();
      geometry.dispose();
      material.dispose();
      if (material.map) material.map.dispose();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
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

export default memo(Visualizer3D);
