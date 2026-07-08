import { useEffect, useRef, memo } from 'react';
import * as THREE from 'three';
import { getSpectrumBars } from '../audio/engine';
import { getProxyUrl } from '../api/music';

const TARGET_PARTICLES = 20000; // 三套形态统一目标粒子数（「两万左右」）
const GRID = Math.round(Math.sqrt(TARGET_PARTICLES)); // ≈141 → COUNT ≈ 19881，覆盖全部 3D 形态
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
const SHOCK_GAIN = 1.6;           // 鼓点冲击波冲量增益（× bass）— 增强鼓点强度
// —— 鼓点频率增强（本次新增，与 beatPulse 平行的独立包络）——
const BEAT_FREQ_BOOST_DECAY = 0.90; // 频率增强包络每帧衰减（≈鼓点后 0.3s 归零）
const GALAXY_BEAT_FREQ_GAIN = 2.2;  // galaxy：鼓点时频谱响应放大倍数（涟漪/抖动/颜色）
const LIQUID_BEAT_FREQ_GAIN = 1.6;  // liquidmetal：鼓点时频谱响应放大倍数（位移）

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
  const beatFreqBoostRef = useRef(0); // 鼓点频率增强包络（与 beatPulse 平行，独立衰减）
  // ====== 待机动画专用状态 ======
  const idleWindRef = useRef({ phase: 0, lastGust: 0, gustDir: 1, gustAmp: 0 });
  const idleHotspotsRef = useRef(null);        // 液态金属：对流热点 [{cx,cy,period,phase}]
  const idleDropletRef = useRef({ idx: -1, phase: 0, life: 0 }); // 液态金属：液滴粒子
  const idleTwinkleRef = useRef(null);         // 星河：闪烁亮度数组 Float32Array(COUNT)
  const idleMeteorRef = useRef({ active: false, idx: -1, prog: 0, sx: 0, sy: 0, ex: 0, ey: 0, nextT: 3 + Math.random() * 7 });
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
    let Rmax = 0; // 星系盘半径，顶层变量：buildBase / 星空待机(流星) / 着色 均可见，避免 TDZ 崩溃

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
      Rmax = planeSize * GALAXY_R_MAX_RATIO;
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

      // 时间步长必须在待机(standby)分支使用 time/dt 之前计算，否则命中 const 的
      // 暂时性死区(TDZ) → ReferenceError → 被 ErrorBoundary 捕获显示「页面渲染出错」
      const now = performance.now();
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;
      const time = now * 0.001;

      let bass = 0, mid = 0, treble = 0;
      if (hasData) {
        for (let i = 0; i < 8; i++) bass += data[i];
        bass /= 8;
        for (let i = 8; i < 32; i++) mid += data[i];
        mid /= 24;
        for (let i = 0; i < 32; i++) treble += data[i];
        treble /= 32;
      } else {
        // ====== 三种模式各自独立的特色待机动画 ======
        const t = time; // 复用 animate 已计算的 time
        const modeIdle = modeRef.current;

        // --- 懒初始化待机状态数组 ---
        if (!idleTwinkleRef.current) idleTwinkleRef.current = new Float32Array(COUNT);
        if (!idleHotspotsRef.current) {
          // 8 个对流热点（球面坐标）— 数量增强
          const hs = [];
          for (let h = 0; h < 8; h++) {
            const theta = (h / 8) * Math.PI * 2 + Math.random() * 0.8;
            const phi = (Math.random() - 0.5) * Math.PI * 1.4;
            hs.push({ cx: Math.cos(phi) * Math.cos(theta), cy: Math.sin(phi), cz: Math.cos(phi) * Math.sin(theta),
              period: 3 + Math.random() * 4, phase: Math.random() * Math.PI * 2, amp: 0.9 + Math.random() * 0.9 });
          }
          idleHotspotsRef.current = hs;
        }

        if (modeIdle === 'coverflow') {
          // ═══ coverflow 待机：绸缎飘风 ═══
          const wind = idleWindRef.current;

          // 阵风：每 6~9 秒一次，振幅缓起缓落
          const sinceGust = t - wind.lastGust;
          const gustCycle = 7.5; // 平均阵风周期
          if (sinceGust > gustCycle + Math.random() * 2) {
            wind.lastGust = t;
            wind.gustDir = Math.random() > 0.5 ? 1 : -1;
          }
          // 包络线：smoothstep 缓起缓落的阵风强度
          const gustProg = sinceGust / gustCycle;
          const gustEnv = gustProg < 0.25 ? gustProg / 0.25 : (gustProg < 0.75 ? 1 : 1 - (gustProg - 0.75) / 0.25);
          wind.gustAmp = gustEnv * gustEnv * (0.35 + 0.25 * Math.sin(sinceGust * 2.5));

          bass = 0.12 + Math.sin(t * 0.45) * 0.06 + wind.gustAmp * 0.15;
          mid   = 0.08 + Math.sin(t * 0.70 + 0.8) * 0.04 + Math.sin(t * 1.6) * 0.03 * wind.gustAmp;
          treble= 0.05 + Math.sin(t * 1.1 + 1.5) * 0.02 + wind.gustAmp * 0.08;

        } else if (modeIdle === 'liquidmetal') {
          // ═══ liquidmetal 待机：熔岩对流 ═══
          const hotspots = idleHotspotsRef.current;
          const droplet = idleDropletRef.current;

          // 液滴事件：随机选择一个粒子短暂凸起后缩回
          droplet.life -= dt;
          if (droplet.life <= 0) {
            droplet.idx = -1; // 复位：避免粒子永久凹陷，也让鼓点事件可再次触发
            if (Math.random() < 0.008) { // ~每 2s 触发一次新液滴
              droplet.idx = Math.floor(Math.random() * COUNT);
              droplet.phase = 0;
              droplet.life = 1.5; // 持续 1.5 秒
            }
          }

          let maxHot = 0;
          for (let h = 0; h < hotspots.length; h++) {
            const sp = hotspots[h];
            const pulse = Math.sin(t / sp.period * Math.PI * 2 + sp.phase);
            const v = (pulse * 0.5 + 0.5) * sp.amp;
            if (v > maxHot) maxHot = v;
          }

          // 整体呼吸脉动（8s 周期）
          const breathe = 0.85 + Math.sin(t * Math.PI / 4) * 0.15;

          bass = 0.08 + maxHot * 0.18 + breathe * 0.06;
          mid   = 0.06 + maxHot * 0.12 + Math.sin(t * 0.55) * 0.03 * breathe;
          treble= 0.04 + Math.sin(t * 0.9 + 1) * 0.025;

        } else {
          // ═══ galaxy 待机：深空星尘 ═══
          const twinkle = idleTwinkleRef.current;
          const meteor = idleMeteorRef.current;

          // 星星闪烁：每帧随机选 ~0.3% 粒子做亮度脉冲
          for (let ti = 0; ti < COUNT * 0.003 + 1; ti++) {
            const ri = Math.floor(Math.random() * COUNT);
            if (galaxyBulge[ri]) continue; // 核球不闪烁
            twinkle[ri] = 1.0; // 触发亮度
          }
          // 衰减所有闪烁值（指数衰减）
          for (let di = 0; di < COUNT; di++) {
            if (twinkle[di] > 0.01) twinkle[di] *= 0.94;
            else twinkle[di] = 0;
          }

          // 流星事件
          if (!meteor.active && t > meteor.nextT) {
            // 从外圈随机选一个粒子作为起点（放宽阈值+增加尝试次数，确保流星可靠生成）
            let spawnIdx = -1;
            for (let mi = 0; mi < 40; mi++) {
              const ci = Math.floor(Math.random() * COUNT);
              if (galaxyR[ci] / Rmax > 0.55 && !galaxyBulge[ci]) {
                spawnIdx = ci; break;
              }
            }
            if (spawnIdx >= 0) {
              meteor.active = true;
              meteor.idx = spawnIdx;
              meteor.sx = basePositionsGalaxy[spawnIdx * 3];
              meteor.sy = basePositionsGalaxy[spawnIdx * 3 + 1];
              // 切向方向飞出
              const tangX = -galaxyUY[spawnIdx];
              const tangY = galaxyUX[spawnIdx];
              const flyDist = planeSize * 0.5;
              meteor.ex = meteor.sx + tangX * flyDist;
              meteor.ey = meteor.sy + tangY * flyDist;
              meteor.prog = 0;
            }
            meteor.nextT = t + 10 + Math.random() * 8; // 下次流星
          }
          if (meteor.active) {
            meteor.prog += dt * 0.7; // 流星速度
            if (meteor.prog >= 1) meteor.active = false;
          }

          // 极慢的整体能量（星系几乎是静止的）
          bass   = 0.06 + Math.sin(t * 0.12) * 0.03;   // 16s 周期的核心心跳
          mid    = 0.04 + Math.sin(t * 0.09 + 0.5) * 0.02;
          treble = 0.025;
        }
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
      const beatFreqBoost = beatFreqBoostRef.current; // 鼓点频率增强包络（0..1，逐帧衰减），用于放大频谱响应

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
        beatFreqBoostRef.current = 1; // 同步触发频率增强包络

        // ═══ 鼓点驱动的模式专属事件（增强"数量"）═══
        if (modeRef.current === 'liquidmetal') {
          // 鼓点触发液滴凸起（若当前无活跃液滴）→ 更多粒子随鼓点跃动
          const dl = idleDropletRef.current;
          if (dl.idx < 0 && dl.life <= 0) {
            dl.idx = Math.floor(Math.random() * COUNT);
            dl.phase = 0;
            dl.life = 1.5;
          }
        } else if (modeRef.current === 'galaxy') {
          // 鼓点触发流星（约 40% 概率）+ 闪烁爆发 → 鼓点瞬间点亮一批星
          const mt = idleMeteorRef.current;
          if (!mt.active && Math.random() < 0.4) mt.nextT = nowS;
          if (idleTwinkleRef.current) {
            for (let bi = 0; bi < COUNT * 0.01; bi++) {
              const ri = Math.floor(Math.random() * COUNT);
              if (!galaxyBulge[ri]) idleTwinkleRef.current[ri] = 1.0;
            }
          }
        }
      }
      beatPulseRef.current *= Math.pow(0.90, dt * 60);          // 帧率无关衰减（60fps 等价于 ×0.90）
      beatFreqBoostRef.current *= Math.pow(BEAT_FREQ_BOOST_DECAY, dt * 60); // 频率增强包络衰减（同）

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

      const invRmax = 1 / Rmax; // 预计算倒数，避免每粒子多次除法

      for (let i = 0; i < COUNT; i++) {
        const u = origUV[i * 2];
        const v = origUV[i * 2 + 1];
        const dc = distFromCenter[i];

        let bx, by, bz, nx, ny, nz;
        if (isGalaxy) {
          const rN = Math.min(1, galaxyR[i] * invRmax);
          // 由内向外的径向涟漪波（随该频段能量起伏）
          const band = Math.min(63, Math.floor(rN * 63));
          const ripple = Math.sin(rN * RIPPLE_FREQ - time * RIPPLE_SPEED) * spectrumSmooth[band] * planeSize * 0.05 * (1 + beatFreqBoost * GALAXY_BEAT_FREQ_GAIN); // 鼓点增强频率响应
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
          // ═══ galaxy 待机：深空星尘 — 差速旋转 + 核心心跳 + 流星 ═══
          const rN = Math.min(1, galaxyR[i] * invRmax);

          // 差速旋转：内圈快(0.08 rad/s) → 外圈慢(0.02 rad/s)，模拟真实星系
          const diffOmega = hasData ? 0.12 : 0.08; // 有音频时稍快
          const innerOmega = diffOmega;
          const outerOmega = diffOmega * 0.22;
          const ang = time * (innerOmega + (outerOmega - innerOmega) * rN);
          const ca = Math.cos(ang), sa = Math.sin(ang);
          const rx = x * ca - y * sa;
          const ry = x * sa + y * ca;
          x = rx; y = ry;
          // 频谱细碎抖动增强流动感
          const jitter = trebleSmooth * 0.5 * Math.sin(u * 50 + time * 5 + i * 0.3) * planeSize * 0.004 * (1 + beatFreqBoost * GALAXY_BEAT_FREQ_GAIN); // 鼓点增强频率响应
          x += nx * jitter; y += ny * jitter; z += nz * jitter;

          // 核心心跳：核球粒子做 12s 周期的极慢膨胀/收缩（待机时更明显）
          if (galaxyBulge[i] && !hasData) {
            const heartPhase = Math.sin(time * Math.PI / 6); // 12s 周期
            const breathe = 1 + heartPhase * 0.05; // ±5% 半径
            x *= breathe; y *= breathe; z *= breathe;
          }

          // 流星：选中的粒子做高速切向位移
          const meteor = idleMeteorRef.current;
          if (!hasData && meteor.active && meteor.idx === i) {
            const mp = meteor.prog;
            // 缓入缓出的流星轨迹
            const easeP = mp < 0.15 ? mp / 0.15 : (mp > 0.85 ? (1 - mp) / 0.15 : 1);
            x = meteor.sx + (meteor.ex - meteor.sx) * mp;
            y = meteor.sy + (meteor.ey - meteor.sy) * mp;
          }
        } else if (targetShape === 'coverflow') {
          // ═══ coverflow 待机：绸缎飘风 ═══
          const audioAmp = hasData ? (0.45 + totalEnergy * 1.3) : (0.35 + bass * 1.8);
          const wind = idleWindRef.current;
          const t2 = time;

          // 主褶皱层：多频率叠加模拟布料自然折叠（Perlin-like）
          const fold1 = Math.sin(u * 4 * Math.PI + t2 * 0.55) * Math.cos(v * 2.5 * Math.PI + t2 * 0.35) * 0.18;
          const fold2 = Math.sin((u - v) * 3 * Math.PI + t2 * 0.75) * Math.sin(v * 6 * Math.PI - t2 * 0.45) * 0.14;
          // 细纹层：高频微扰模拟织物纹理
          const micro = Math.sin(u * 28 + t2 * 2.5) * Math.cos(v * 22 + t2 * 1.8) * 0.04;
          // 阵风扫过：方向性波浪，从一侧吹向另一侧
          const gustX = wind.gustAmp * Math.sin(v * 3 * Math.PI + u * 8 * Math.PI * wind.gustDir - t2 * 3) * 0.35;
          const gustY = wind.gustAmp * Math.cos(u * 3 * Math.PI + v * 6 * Math.PI * wind.gustDir - t2 * 2.5) * 0.30;

          const waveX = fold1 + gustX;
          const waveY = fold2 + gustY;
          const waveZ = micro + Math.sin((u + v) * 6 * Math.PI + t2 * 0.9) * 0.20 + Math.sin(dc * 8 - t2 * 1.1) * 0.06
                      + (!hasData ? wind.gustAmp * Math.sin(dc * 12 - t2 * 4) * 0.15 : 0);
          const amp = zAmp * audioAmp;
          x = bx + waveX * amp;
          y = by + waveY * amp;
          z = bz + waveZ * amp;
        } else if (targetShape === 'liquidmetal') {
          // ═══ liquidmetal 待机：熔岩对流 ═══
          const band = bandArr[i]; // 0=赤道(最中间), 1=两极(两端)

          const activeRange = 0.80; // 数量增强：约 80% 表面跟随节奏（原 72%）
          const activeFactor = band < activeRange ? Math.pow(1 - band / activeRange, 0.55) : 0;
          const idleFactor = 1 - activeFactor;

          const coarseBand = Math.min(7, Math.floor(freqBand[i] / 8));
          let energy = 0;
          for (let k = coarseBand * 8; k < (coarseBand + 1) * 8 && k < 64; k++) energy += spectrumSmooth[k];
          energy /= 8;

          const localPulse = (energy * 1.15 * (1 + beatFreqBoost * LIQUID_BEAT_FREQ_GAIN) + bassAttack * 0.7 + midSmooth * 0.5) * activeFactor; // 鼓点增强频谱能量位移
          const displacement = localPulse * planeSize * 0.09;

          // 整体呼吸脉动（待机时更明显）
          const breathe = hasData ? 1.0 : (0.97 + Math.sin(time * Math.PI / 4) * 0.03);

          const baseR = planeSize * LIQUID_RADIUS_RATIO * (0.82 + (coverLight[i] || 0.5) * 0.36) * breathe;

          // 对流热点：球面上多个热源产生向外推的脉冲
          let hotDisp = 0;
          if (!hasData || idleHotspotsRef.current) {
            const hotspots = idleHotspotsRef.current || [];
            for (let h = 0; h < hotspots.length; h++) {
              const sp = hotspots[h];
              // 粒子到热点的球面距离
              const dot = nx * sp.cx + ny * sp.cy + nz * sp.cz;
              const heatDist = Math.acos(Math.max(-1, Math.min(1, dot))); // 0=同点, π=对跖
              const heatFalloff = Math.exp(-heatDist * heatDist * 3); // 高斯衰减
              const pulse = (Math.sin(time / sp.period * Math.PI * 2 + sp.phase) * 0.5 + 0.5) * sp.amp;
              hotDisp += pulse * heatFalloff * planeSize * (hasData ? 0.03 : 0.07);
            }
          }

          // 液滴事件：单个粒子短暂凸起
          let dropletDisp = 0;
          if (!hasData && idleDropletRef.current.idx === i) {
            const dp = idleDropletRef.current.phase;
            // 快速升起 → 停留 → 缓慢缩回
            const dropletShape = dp < 0.25 ? dp / 0.25 : (dp < 0.7 ? 1 : 1 - (dp - 0.7) / 0.3);
            dropletDisp = dropletShape * dropletShape * planeSize * 0.12;
            idleDropletRef.current.phase += dt / 1.5; // 1.5s 周期
          }

          // 表面张力波：多波长沿法向振动，相位差营造流动感
          const wave = (midSmooth * 0.9 + bassAttack * 0.6) * Math.sin(u * 56 + time * 5 + i * 0.5) * planeSize * 0.008 * activeFactor;
          const equatorWave = (midSmooth * 0.8 + bassAttack * 0.6) * Math.sin(u * 48 + time * 4.5 + i * 0.5) * planeSize * 0.011 * activeFactor;
          const bassBoost = bassPulse * planeSize * 0.14 * activeFactor; // 鼓点强度增强（原 0.09）

          // 两端舒缓起伏（原有逻辑保留）
          const idleWave = idleFactor * Math.sin(v * 20 + time * 1.8 + i * 0.1) * Math.cos(u * 14 + time * 1.3) * planeSize * 0.06;

          // 金属光泽漂移：高光区缓慢移动（通过微小的额外位移实现）
          const shimmer = !hasData ? Math.sin(time * 0.15 + u * 10 + v * 7) * Math.cos(time * 0.11 - u * 5) * planeSize * 0.004 : 0;

          const r = baseR + displacement + wave + equatorWave + bassBoost + idleWave + hotDisp + dropletDisp + shimmer;
          x = nx * r;
          y = ny * r;
          z = nz * r;
        }

        posAttr.array[i * 3] = x;
        posAttr.array[i * 3 + 1] = y;
        posAttr.array[i * 3 + 2] = z;

        if (isGalaxy) {
          // 星河着色：内核=主题色(炽热)，外圈=封面平均色(冷)，加色混合辉光
          const rN = Math.min(1, galaxyR[i] * invRmax);
          const coreMix = Math.pow(1 - rN, 1.6);
          const cr = accentRGB.r, cg = accentRGB.g, cb = accentRGB.b;
          const ar = cavg.r, ag = cavg.g, ab = cavg.b;
          let r = cr * coreMix + ar * (1 - coreMix);
          let g = cg * coreMix + ag * (1 - coreMix);
          let b = cb * coreMix + ab * (1 - coreMix);

          // 星云漂移：外圈颜色在封面平均色与 accent 之间极慢往复（30s 周期）
          if (!hasData && rN > 0.5) {
            const nebulaPhase = Math.sin(time * Math.PI / 15) * 0.5 + 0.5; // 30s
            r = r * (1 - nebulaPhase * 0.15) + ar * nebulaPhase * 0.15;
            g = g * (1 - nebulaPhase * 0.15) + ag * nebulaPhase * 0.15;
            b = b * (1 - nebulaPhase * 0.15) + ab * nebulaPhase * 0.15;
          }

          const band = Math.min(63, Math.floor(rN * 63));
          const localE = spectrumSmooth[band];
          const intensity = 0.42 + bassAttack * 1.1 + localE * 1.6 * (1 + beatFreqBoost * GALAXY_BEAT_FREQ_GAIN) + beatPulseRef.current * 0.9 + galaxyBulge[i] * bassAttack * 0.6; // 鼓点增强频段亮度

          // 星星闪烁叠加（待机时更明显）
          let twinkleBoost = 0;
          if (idleTwinkleRef.current) {
            twinkleBoost = idleTwinkleRef.current[i] * (!hasData ? 1.2 : 0.5);
          }
          // 流星粒子额外增亮
          if (!hasData && idleMeteorRef.current.active && idleMeteorRef.current.idx === i) {
            twinkleBoost += 2.0; // 流星很亮
          }

          colorAttr.array[i * 3]     = Math.min(1, r * intensity + twinkleBoost);
          colorAttr.array[i * 3 + 1] = Math.min(1, g * intensity + twinkleBoost);
          colorAttr.array[i * 3 + 2] = Math.min(1, b * intensity + twinkleBoost);
        } else if (!useCover) {
          const windGlow = targetShape === 'coverflow' ? Math.abs(z - bz) / (planeSize * 0.12 + 0.001) * 0.12 : 0;
          const intensity = 0.42 + totalEnergy * 1.6 + windGlow;

          // coverflow 待机色彩漂移：accent 色在 HSL 空间做 ±15° 往复漂移（极光感）
          let ar_mod = accentRGB.r, ag_mod = accentRGB.g, ab_mod = accentRGB.b;
          if (targetShape === 'coverflow' && !hasData) {
            const driftPhase = Math.sin(time * 0.08); // ~78s 完整周期
            // 简化色相偏移：在蓝→青→紫之间微调
            const shift = driftPhase * 0.12;
            ar_mod = Math.min(1, accentRGB.r + shift * 0.3);
            ag_mod = Math.min(1, accentRGB.g - shift * 0.05 + Math.abs(driftPhase) * 0.15);
            ab_mod = Math.max(0.3, accentRGB.b - shift * 0.2);
          }

          const outFactor = 1 - dc * 0.25;
          colorAttr.array[i * 3]     = Math.min(1, ar_mod * intensity * outFactor + bassPulse * 0.65);
          colorAttr.array[i * 3 + 1] = Math.min(1, ag_mod * intensity * outFactor + bassPulse * 0.65);
          colorAttr.array[i * 3 + 2] = Math.min(1, ab_mod * intensity * outFactor + bassPulse * 0.65 + windGlow * 0.35);
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
      // 帧率无关缓动：60fps 时等价于原 0.18 系数；掉帧时按真实时间推进，拖拽/缩放跟手一致
      const LERP = 1 - Math.pow(1 - 0.18, dt * 60);
      g.zoom += (g.targetZoom - g.zoom) * LERP;
      g.rotationY += (g.targetRotationY - g.rotationY) * LERP;
      g.rotationX += (g.targetRotationX - g.rotationX) * LERP;
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
