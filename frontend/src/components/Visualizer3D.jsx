import { useEffect, useRef, memo } from 'react';
import * as THREE from 'three';
import { getSpectrumBars } from '../audio/engine';
import { getProxyUrl } from '../api/music';

const GRID = 180;             // 180x180 = 32400 粒子（统一用于全部 3D 形态）
const FOV = 55;
const AUTO_ROTATE_SPEED = 0.35;   // 自动偏航角速度 rad/s（≈20°/s）— 默认关闭
const AUTO_RESUME_MS = 2500;      // 停止交互后多久恢复自动旋转（ms）
const PITCH_LIMIT = 1.48;         // 俯仰角限制 ≈ ±85°，避免上下翻转
const ROTATE_SENSITIVITY = 0.006; // 滑动旋转灵敏度 rad/px

// —— 星河漩涡（galaxy）参数 ——
const GALAXY_DPR_CAP = 2;         // 高 dpi 渲染上限，保帧
const GALAXY_ARMS = 3;            // 旋臂数
const GALAXY_TWIST = 3.4;         // 旋臂总扭转（弧度）
const GALAXY_BULGE_FRAC = 0.24;   // 中心核球粒子占比
const GALAXY_R_MAX_RATIO = 0.96;  // 星系盘半径相对画面
const RIPPLE_FREQ = 14;           // 径向涟漪空间频率
const RIPPLE_SPEED = 3.0;         // 涟漪向外传播速度
const BEAT_THRESHOLD = 0.16;      // 低频能量一阶导超此值触发冲击波
const BEAT_COOLDOWN = 0.11;       // 两次冲击波最小间隔（s）
const SPRING_K = 0.05;            // 冲击波回弹弹簧系数
const DAMPING = 0.88;             // 速度阻尼
const SHOCK_GAIN = 0.9;           // 鼓点冲击波冲量增益（× bass）

// 稳定伪随机（保证星系形态每次重建一致）
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

// 3D 粒子可视化：coverflow（粒子封面）/ liquidmetal（液态金属）/ galaxy（星河漩涡）
// 手势驱动：单指/鼠标拖拽 = 偏航(360°)+俯仰(±85°)；双指捏合缩放+扭转；滚轮缩放
function Visualizer3D({ accent = '#4FC3F7', cover = '', mode = 'coverflow', isPlaying = false, onReady }) {
  const containerRef = useRef(null);
  const accentRef = useRef(accent);
  const coverRef = useRef(cover);
  const isPlayingRef = useRef(isPlaying);
  const imageDataRef = useRef(null);  // 封面像素 RGBA
  const hasCoverRef = useRef(false);
  const coverVersionRef = useRef(0);
  const appliedCoverVersionRef = useRef(-1);
  const coverAvgRef = useRef({ r: 0.3, g: 0.5, b: 0.95 }); // 封面平均色（星河外圈着色用）
  // 星河漩涡跨渲染状态（必须置于组件顶层，遵守 hooks 规则）
  const albumBuiltRef = useRef(-1);
  const prevBassRef = useRef(0);
  const lastBeatRef = useRef(0);
  const beatPulseRef = useRef(0);
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

  // 手势状态（360° 旋转：单指滑动 = 偏航(yaw)+俯仰(pitch)；双指捏合缩放+扭转；滚轮缩放）
  // 默认关闭自动旋转（用户要求「永远不转」），仅保留手动拖拽
  const gestureRef = useRef({
    zoom: 1.0,
    targetZoom: 1.0,
    rotationY: 0.0,            // 偏航（绕 Y 轴，水平方向，可 360°）
    targetRotationY: 0.0,
    rotationX: -0.12,          // 俯仰（绕 X 轴，垂直方向，初始轻微下俯保持原有观感）
    targetRotationX: -0.12,
    pinching: false,
    startDist: 0,
    startAngle: 0,
    startZoom: 1.0,
    startRotY: 0,
    dragging: false,
    startX: 0,
    startY: 0,
    startRotX: 0,
    autoRotate: false,
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

    const dpr = Math.min(window.devicePixelRatio || 1, GALAXY_DPR_CAP);
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
    const basePositionsGalaxy = new Float32Array(COUNT * 3); // 星河漩涡基础坐标
    const galaxyR = new Float32Array(COUNT);                 // 每粒子半径
    const galaxyUX = new Float32Array(COUNT);                // 径向单位向量 X
    const galaxyUY = new Float32Array(COUNT);                // 径向单位向量 Y
    const galaxyBulge = new Float32Array(COUNT);             // 1=核球粒子
    const coverColors = new Float32Array(COUNT * 3);         // 封面 RGB（取平均色用）
    const explodeVel = new Float32Array(COUNT * 3);          // 冲击波速度
    const explodePos = new Float32Array(COUNT * 3);          // 冲击波偏移（弹簧回弹）
    const coverLight = new Float32Array(COUNT);
    const bandArr = new Float32Array(COUNT);
    const freqBand = new Uint8Array(COUNT);
    const spectrumSmooth = new Float32Array(64);

    const buildBase = () => {
      const Rmax = planeSize * GALAXY_R_MAX_RATIO;
      const grng = mulberry32(0x9e3779b9); // 稳定种子 → 星系形态固定
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

          // 星河漩涡：对数螺旋星系盘 + 中心核球
          const arm = Math.floor(grng() * GALAXY_ARMS);
          const isBulge = grng() < GALAXY_BULGE_FRAC;
          let gx2, gy2, gz2, rr, th;
          if (isBulge) {
            // 中心核球：略呈球状的密集亮核
            rr = Math.pow(grng(), 0.5) * Rmax * 0.26;
            const phi2 = grng() * Math.PI * 2;
            const ct = grng() * 2 - 1;
            const st = Math.sqrt(Math.max(0, 1 - ct * ct));
            th = phi2;
            gx2 = rr * st * Math.cos(phi2);
            gy2 = rr * st * Math.sin(phi2);
            gz2 = rr * ct * 0.55;
          } else {
            // 旋臂：半径越外扭转越多；越靠中心散布越宽
            rr = Rmax * Math.pow(grng(), 0.82);
            const twist = (rr / Rmax) * GALAXY_TWIST;
            const scatter = (grng() - 0.5) * (0.62 * (1 - 0.45 * rr / Rmax));
            th = arm * (Math.PI * 2 / GALAXY_ARMS) + twist + scatter;
            gx2 = Math.cos(th) * rr;
            gy2 = Math.sin(th) * rr;
            gz2 = (grng() - 0.5) * planeSize * 0.045 * (1 - 0.4 * rr / Rmax);
          }
          basePositionsGalaxy[idx * 3] = gx2;
          basePositionsGalaxy[idx * 3 + 1] = gy2;
          basePositionsGalaxy[idx * 3 + 2] = gz2;
          galaxyR[idx] = rr;
          galaxyUX[idx] = Math.cos(th);
          galaxyUY[idx] = Math.sin(th);
          galaxyBulge[idx] = isBulge ? 1 : 0;

          const initial = modeRef.current === 'liquidmetal' ? basePositionsLiquid
            : modeRef.current === 'galaxy' ? basePositionsGalaxy
              : basePositionsCover;
          positions[idx * 3] = initial[idx * 3];
          positions[idx * 3 + 1] = initial[idx * 3 + 1];
          positions[idx * 3 + 2] = initial[idx * 3 + 2];
          idx++;
        }
      }
    };
    buildBase();

    // 按当前封面采样颜色，并求平均色（星河外圈着色用）
    const rebuildAlbumBase = () => {
      const d = imageDataRef.current;
      const accentRGB = hexToRGB(accentRef.current || '#4FC3F7');
      let sr = 0, sg = 0, sb = 0, sn = 0;
      for (let i = 0; i < COUNT; i++) {
        const u = origUV[i * 2];
        const v = origUV[i * 2 + 1];
        let r = accentRGB.r, g = accentRGB.g, b = accentRGB.b;
        if (d) {
          const px = Math.min(GRID - 1, Math.max(0, Math.floor(u * GRID)));
          const py = Math.min(GRID - 1, Math.max(0, Math.floor(v * GRID)));
          const o = (py * GRID + px) * 4;
          r = d[o] / 255; g = d[o + 1] / 255; b = d[o + 2] / 255;
        }
        coverColors[i * 3] = r; coverColors[i * 3 + 1] = g; coverColors[i * 3 + 2] = b;
        // 加权平均（按亮度加权，避免被大块暗部拉偏）
        const w = 0.2 + 0.8 * (0.299 * r + 0.587 * g + 0.114 * b);
        sr += r * w; sg += g * w; sb += b * w; sn += w;
      }
      if (sn > 0) coverAvgRef.current = { r: sr / sn, g: sg / sn, b: sb / sn };
    };

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: planeSize * 2 / GRID * 1.2,   // 粒子稍大，星系更清晰可见
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

    // 取某形态的基础坐标集（coverflow / liquidmetal / galaxy 星河）
    const baseFor = (m) => {
      if (m === 'liquidmetal') return { pos: basePositionsLiquid, nrm: baseNormalsLiquid };
      if (m === 'galaxy') return { pos: basePositionsGalaxy, nrm: null };
      return { pos: basePositionsCover, nrm: baseNormalsCover };
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
        for (let i = 0; i < 32; i++) treble += data[i];
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
      const isGalaxy = modeRef.current === 'galaxy';

      if (useCover && appliedCoverVersionRef.current !== coverVersionRef.current) {
        if (applyCoverColors()) appliedCoverVersionRef.current = coverVersionRef.current;
      }

      // 封面变化 → 重建封面平均色
      if (albumBuiltRef.current !== coverVersionRef.current) {
        rebuildAlbumBase();
        albumBuiltRef.current = coverVersionRef.current;
      }

      // 节拍检测：低频能量一阶导超阈值 → 触发径向冲击波
      const nowS = now * 0.001;
      const dBas = bass - prevBassRef.current;
      prevBassRef.current = bass;
      if (dBas > BEAT_THRESHOLD && (nowS - lastBeatRef.current) > BEAT_COOLDOWN) {
        lastBeatRef.current = nowS;
        const imp = Math.min(1, bass) * SHOCK_GAIN * planeSize * 0.10;
        for (let i = 0; i < COUNT; i++) {
          explodeVel[i * 3] += galaxyUX[i] * imp;
          explodeVel[i * 3 + 1] += galaxyUY[i] * imp;
        }
        beatPulseRef.current = 1;
      }
      beatPulseRef.current *= 0.90;

      const accentRGB = hexToRGB(accentRef.current || '#4FC3F7');
      const cavg = coverAvgRef.current;

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
        fromBase = baseFor(tr.from).pos;
        toBase = baseFor(tr.to).pos;
        toNormals = (tr.to === 'liquidmetal') ? baseNormalsLiquid : baseNormalsCover;
      } else {
        toBase = baseFor(targetShape).pos;
        toNormals = (targetShape === 'liquidmetal') ? baseNormalsLiquid : baseNormalsCover;
        fromBase = toBase;
      }

      // 冲击波偏移积分（弹簧回弹）
      for (let i = 0; i < COUNT; i++) {
        for (let k = 0; k < 3; k++) {
          const o = i * 3 + k;
          explodeVel[o] += (0 - explodePos[o]) * SPRING_K;
          explodeVel[o] *= DAMPING;
          explodePos[o] += explodeVel[o];
        }
      }

      const Rmax = planeSize * GALAXY_R_MAX_RATIO;

      for (let i = 0; i < COUNT; i++) {
        const u = origUV[i * 2];
        const v = origUV[i * 2 + 1];
        const dc = distFromCenter[i];

        let bx, by, bz, nx, ny, nz;
        if (isGalaxy) {
          const rN = Math.min(1, galaxyR[i] / Rmax);
          // 由内向外的径向涟漪波（随该频段能量起伏）
          const band = Math.min(63, Math.floor(rN * 63));
          const ripple = Math.sin(rN * RIPPLE_FREQ - time * RIPPLE_SPEED) * spectrumSmooth[band] * planeSize * 0.05;
          // 低频推核球呼吸（越靠中心越强）
          const bassPush = bassAttack * planeSize * 0.10 * (1 - rN * 0.6);
          const disp = ripple + bassPush;
          let sx = basePositionsGalaxy[i * 3] + galaxyUX[i] * disp + explodePos[i * 3];
          let sy = basePositionsGalaxy[i * 3 + 1] + galaxyUY[i] * disp + explodePos[i * 3 + 1];
          let sz = basePositionsGalaxy[i * 3 + 2] + explodePos[i * 3 + 2];
          if (tr.active) {
            // 跨模式进入星河时，从源形态基础坐标平滑过渡到星河基础坐标
            const fb = baseFor(tr.from).pos;
            const mt = morphT;
            sx = fb[i * 3] * (1 - mt) + sx * mt;
            sy = fb[i * 3 + 1] * (1 - mt) + sy * mt;
            sz = fb[i * 3 + 2] * (1 - mt) + sz * mt;
          }
          bx = sx; by = sy; bz = sz;
          nx = galaxyUX[i]; ny = galaxyUY[i]; nz = 0;
        } else if (tr.active) {
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

        if (isGalaxy) {
          // 星河内部缓慢公转（盘面内旋转成漩涡感，非镜头自转）
          const ang = time * 0.12;
          const ca = Math.cos(ang), sa = Math.sin(ang);
          const rx = x * ca - y * sa;
          const ry = x * sa + y * ca;
          x = rx; y = ry;
          // 频谱细碎抖动增强流动感
          const jitter = trebleSmooth * 0.5 * Math.sin(u * 50 + time * 5 + i * 0.3) * planeSize * 0.004;
          x += nx * jitter; y += ny * jitter; z += nz * jitter;
        } else if (targetShape === 'coverflow') {
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
          const wave = (midSmooth * 0.9 + bassAttack * 0.6) * Math.sin(u * 56 + time * 5 + i * 0.5) * planeSize * 0.008 * activeFactor;
          // 赤道起伏：中间有舒缓横波，向边缘衰减
          const equatorWave = (midSmooth * 0.8 + bassAttack * 0.6) * Math.sin(u * 48 + time * 4.5 + i * 0.5) * planeSize * 0.011 * activeFactor;
          // 鼓点冲击集中在中间横面
          const bassBoost = bassPulse * planeSize * 0.09 * activeFactor;

          // 两端独立的舒缓起伏动画，不跟节奏但让整体更合群
          const idleWave = idleFactor * Math.sin(v * 20 + time * 1.8 + i * 0.1) * Math.cos(u * 14 + time * 1.3) * planeSize * 0.06;

          const r = baseR + displacement + wave + equatorWave + bassBoost + idleWave;
          x = nx * r;
          y = ny * r;
          z = nz * r;
        }

        posAttr.array[i * 3] = x;
        posAttr.array[i * 3 + 1] = y;
        posAttr.array[i * 3 + 2] = z;

        if (isGalaxy) {
          // 星河着色：内核=主题色(炽热)，外圈=封面平均色(冷)，加色混合辉光
          const rN = Math.min(1, galaxyR[i] / Rmax);
          const coreMix = Math.pow(1 - rN, 1.6);
          const cr = accentRGB.r, cg = accentRGB.g, cb = accentRGB.b;
          const ar = cavg.r, ag = cavg.g, ab = cavg.b;
          let r = cr * coreMix + ar * (1 - coreMix);
          let g = cg * coreMix + ag * (1 - coreMix);
          let b = cb * coreMix + ab * (1 - coreMix);
          const band = Math.min(63, Math.floor(rN * 63));
          const localE = spectrumSmooth[band];
          const intensity = 0.42 + bassAttack * 1.1 + localE * 1.6 + beatPulseRef.current * 0.9 + galaxyBulge[i] * bassAttack * 0.6;
          colorAttr.array[i * 3]     = Math.min(1, r * intensity);
          colorAttr.array[i * 3 + 1] = Math.min(1, g * intensity);
          colorAttr.array[i * 3 + 2] = Math.min(1, b * intensity);
        } else if (!useCover) {
          const windGlow = targetShape === 'coverflow' ? Math.abs(z - bz) / (planeSize * 0.12 + 0.001) * 0.12 : 0;
          const intensity = 0.42 + totalEnergy * 1.6 + windGlow;
          const outFactor = 1 - dc * 0.25;
          colorAttr.array[i * 3]     = Math.min(1, accentRGB.r * intensity * outFactor + bassPulse * 0.65);
          colorAttr.array[i * 3 + 1] = Math.min(1, accentRGB.g * intensity * outFactor + bassPulse * 0.65);
          colorAttr.array[i * 3 + 2] = Math.min(1, accentRGB.b * intensity * outFactor + bassPulse * 0.65 + windGlow * 0.35);
        }
      }
      posAttr.needsUpdate = true;
      if (!useCover || isGalaxy) colorAttr.needsUpdate = true;

      // 360° 旋转控制
      const g = gestureRef.current;
      // 交互结束后短暂保持用户当前视角，空闲超过阈值再恢复匀速偏航旋转（默认关闭）
      const idle = (performance.now() - g.lastInteractTime) > AUTO_RESUME_MS;
      if (g.autoRotate && !g.dragging && !g.pinching && idle) {
        g.targetRotationY += dt * AUTO_ROTATE_SPEED;
      }
      g.zoom += (g.targetZoom - g.zoom) * 0.18;
      g.rotationY += (g.targetRotationY - g.rotationY) * 0.18;
      g.rotationX += (g.targetRotationX - g.rotationX) * 0.18;
      const clampedZoom = Math.max(0.4, Math.min(3.0, g.zoom));
      camera.position.z = cameraZ / clampedZoom * (1 - beatPulseRef.current * 0.05);
      // 鼓点短促 punch-in（FOV 微缩）
      camera.fov = FOV - beatPulseRef.current * 6;
      camera.updateProjectionMatrix();
      // 单指/鼠标滑动即可绕任意方向 360° 旋转：偏航(水平) + 俯仰(垂直)
      points.rotation.y = g.rotationY;
      points.rotation.x = g.rotationX;
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
    const onTouchStart = (e) => {
      const g = gestureRef.current;
      g.lastInteractTime = performance.now();
      if (e.touches.length === 1) {
        g.dragging = true;
        g.startX = e.touches[0].clientX;
        g.startY = e.touches[0].clientY;
        g.startRotX = g.targetRotationX;
        g.startRotY = g.targetRotationY;
      } else if (e.touches.length === 2) {
        g.pinching = true;
        g.dragging = false;
        g.startDist = dist(e.touches[0], e.touches[1]);
        g.startAngle = angle(e.touches[0], e.touches[1]);
        g.startZoom = g.targetZoom;
        g.startRotY = g.targetRotationY;
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
        g.targetRotationY = g.startRotY + (a - g.startAngle);
      } else if (g.dragging && e.touches.length === 1) {
        e.preventDefault();
        const dx = e.touches[0].clientX - g.startX;
        const dy = e.touches[0].clientY - g.startY;
        // 水平滑动 → 偏航（360°）；垂直滑动 → 俯仰（限制在 ±85° 防翻转）
        g.targetRotationY = g.startRotY + dx * ROTATE_SENSITIVITY;
        g.targetRotationX = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, g.startRotX + dy * ROTATE_SENSITIVITY));
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
    // 桌面端鼠标拖拽（便于开发预览，行为同单指滑动）
    let mouseDown = false;
    const onMouseDown = (e) => {
      const g = gestureRef.current;
      g.lastInteractTime = performance.now();
      mouseDown = true;
      g.dragging = true;
      g.startX = e.clientX;
      g.startY = e.clientY;
      g.startRotX = g.targetRotationX;
      g.startRotY = g.targetRotationY;
    };
    const onMouseMove = (e) => {
      if (!mouseDown || !gestureRef.current.dragging) return;
      const g = gestureRef.current;
      g.lastInteractTime = performance.now();
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      g.targetRotationY = g.startRotY + dx * ROTATE_SENSITIVITY;
      g.targetRotationX = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, g.startRotX + dy * ROTATE_SENSITIVITY));
    };
    const onMouseUp = () => {
      mouseDown = false;
      gestureRef.current.dragging = false;
      gestureRef.current.lastInteractTime = performance.now();
    };
    dom.style.touchAction = 'none';
    dom.style.cursor = 'grab';
    dom.addEventListener('touchstart', onTouchStart, { passive: false });
    dom.addEventListener('touchmove', onTouchMove, { passive: false });
    dom.addEventListener('touchend', onTouchEnd);
    dom.addEventListener('wheel', onWheel, { passive: true });
    dom.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    const handleResize = () => {
      computeLayout();
      buildBase();
      rebuildAlbumBase();
      posAttr.needsUpdate = true;
      material.size = planeSize * 2 / GRID * 1.2;
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
      dom.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
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
