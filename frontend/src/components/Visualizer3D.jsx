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
const GALAXY_ARMS = 5;            // 旋臂数（真实星系多为多臂）
const GALAXY_TWIST = 5.5;         // 旋臂总扭转（弧度），越大漩涡越紧
const GALAXY_BULGE_FRAC = 0.15;   // 中心核球粒子占比
const GALAXY_DISC_FRAC = 0.72;    // 盘面旋臂粒子占比
const GALAXY_HALO_FRAC = 0.13;    // 弥散晕/尘埃粒子占比
const GALAXY_R_MAX_RATIO = 0.96;  // 星系盘半径相对画面
const GALAXY_ARM_WIDTH_INNER = 0.18; // 内圈臂宽（rad）
const GALAXY_ARM_WIDTH_OUTER = 0.55; // 外圈臂宽（rad）
const RIPPLE_FREQ = 10;           // 径向涟漪空间频率
const RIPPLE_SPEED = 2.2;         // 涟漪向外传播速度
const TERRAIN_SIZE_RATIO = 1.35;  // 地形平面相对画面尺寸
const TERRAIN_GAIN = 0.30;        // 地形音频驱动高度增益（v1.21：0.22→0.30，动态更猛）
const BEAT_THRESHOLD = 0.07;      // 鼓点触发阈值（越低越敏感）
const BEAT_COOLDOWN = 0.05;       // 两次鼓点最小间隔（s）
const SPRING_K = 0.05;            // 冲击波回弹弹簧系数
const DAMPING = 0.88;             // 速度阻尼
const SHOCK_GAIN = 2.6;           // 鼓点冲击波冲量增益（× bass）——提速后鼓点更"重"
// —— 鼓点频率增强（与 beatPulse 平行的独立包络）——
const BEAT_FREQ_BOOST_DECAY = 0.96; // 频率增强包络每帧衰减（鼓点后持续更久）
const BEAT_PULSE_DECAY = 0.93;      // beatPulse 每帧衰减系数
const GALAXY_BEAT_FREQ_GAIN = 2.6;  // galaxy：鼓点时频谱响应放大倍数
const LIQUID_BEAT_FREQ_GAIN = 2.4;  // liquidmetal：鼓点时频谱响应放大倍数
const COVER_LAYERS = 4;             // 粒子封面错层层数（前清后糊）
const LAYER_GAP = 0.10;             // 错层间距（× planeSize）

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
  const prevMidRef = useRef(0);
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
    const galaxyTheta = new Float32Array(COUNT);             // 每粒子角位置（用于螺旋推进）
    const galaxyArm = new Int8Array(COUNT);                  // 所属旋臂索引（-1=弥散晕）
    const galaxyBulge = new Float32Array(COUNT);             // 1=核球粒子
    const basePositionsTerrain = new Float32Array(COUNT * 3);  // 地形基础坐标
      const terrainBand = new Uint8Array(COUNT);                 // 每粒子对应频段（中心=高频，外圈=低频）
    const coverColors = new Float32Array(COUNT * 3);         // 封面 RGB（取平均色用）
    const explodeVel = new Float32Array(COUNT * 3);          // 冲击波速度
    const explodePos = new Float32Array(COUNT * 3);          // 冲击波偏移（弹簧回弹）
    const coverLight = new Float32Array(COUNT);
    const bandArr = new Float32Array(COUNT);
    const freqBand = new Uint8Array(COUNT);
    const spectrumSmooth = new Float32Array(64);
    // 粒子封面「腻子脱落」：每粒子独立深度状态（0=前层完整封面, 1=后层光晕）
    const clayDepth = new Float32Array(COUNT);      // 当前深度 [0,1]
    const clayTarget = new Float32Array(COUNT);     // 目标深度 [0,1]
    const clayVel = new Float32Array(COUNT);         // 深度变化速度
    const clayPhaseX = new Float32Array(COUNT);     // 有机位移相位 X
    const clayPhaseY = new Float32Array(COUNT);     // 有机位移相位 Y
    const CLAY_FALL_RATE = 0.004;                  // 每帧随机脱落尝试系数（≈79 次/帧）
    const CLAY_SPECTRUM_TRIGGER = 0.55;            // 频谱触发脱落阈值
    const CLAY_RETURN_DECAY = 0.972;               // 目标回弹衰减（每帧）：越大→脱落挂得越久、回得越慢
    const MAX_CLAY_FALLEN = 2000;                  // 同时"脱落中"粒子硬上限（≈10%）→ 保证封面始终完整
    const CLAY_FALL_DEPTH_SCALE = 0.6;             // 脱落凹陷深度缩放（1=原0.30画幅，0.6≈0.18画幅，避免破洞）
    let clayFallenCount = 0;                       // 上一帧脱落中粒子数（用于上限约束）

    // 地形激活度：0=平坦圆盘, 1=全高山脉
    let terrainRise = 0;
    let riseKick = 0;        // 播放开始时的"长出来"过冲（短暂 >1 再收敛回 1.0）
    let wasHasData = false;  // 播放状态边沿检测（用于触发过冲）
    const TERRAIN_RISE_SPEED = 1.2;               // 播放时升起速度/秒
    const TERRAIN_FALL_SPEED = 0.5;                // 停播时回落速度/秒
    const TERRAIN_IDLE_RISE = 0.18;                // 待机时自然微隆起（让待机也有轻微起伏感）

    // 地形 fBm 参数（确定性随机相位/频率 → buildBase 与动画循环共享）
    const trg = mulberry32(0x51ed270b);
    const trPhase = [trg() * 6.2832, trg() * 6.2832, trg() * 6.2832, trg() * 6.2832];
    const trFreq = [2.3 + trg(), 4.1 + trg() * 0.8, 7.7 + trg() * 1.2, 14.3 + trg() * 2.0];

    const buildBase = () => {
      const grng = mulberry32(0x9e3779b9); // 稳定种子 → 星系形态固定
      const cph = mulberry32(0xC0FFEE);    // 错层黏土封面：每粒子有机位移相位（确定性）
      // 地形 fBm 参数已提升到外层作用域（trg/trPhase/trFreq），此处直接使用
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

          // coverflow 形态：全部粒子在同一平面（初始完整封面），深度由运行时 clayDepth 驱动
          clayPhaseX[idx] = cph(); // 有机位移相位（确定性）
          clayPhaseY[idx] = cph();
          clayDepth[idx] = 0;       // 初始全在前层
          clayTarget[idx] = 0;      // 目标也在前层
          clayVel[idx] = 0;         // 无速度
          // 轻微穹顶（无层偏移，所有粒子共面）
          const cbz = -planeSize * DOME_DEPTH_RATIO * (1 - Math.cos(dc * Math.PI / 2));
          basePositionsCover[idx * 3] = x;
          basePositionsCover[idx * 3 + 1] = y;
          basePositionsCover[idx * 3 + 2] = cbz;
          baseNormalsCover[idx * 3] = 0;
          baseNormalsCover[idx * 3 + 1] = 0;
          baseNormalsCover[idx * 3 + 2] = 1.0 - dc * 0.5;

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

          // 星河漩涡：真实对数螺旋星系盘 + 中心核球 + 弥散晕
          const galRoll = grng();
          const isBulge = galRoll < GALAXY_BULGE_FRAC;
          const isHalo = !isBulge && galRoll > (GALAXY_BULGE_FRAC + GALAXY_DISC_FRAC);
          let gx2, gy2, gz2, rr, th, armIdx = -1;

          if (isBulge) {
            // 中心核球：略呈椭球的密集亮核，密度随半径衰减
            rr = Math.pow(grng(), 0.35) * Rmax * 0.22;
            const phi2 = grng() * Math.PI * 2;
            const ct = grng() * 2 - 1;
            const st = Math.sqrt(Math.max(0, 1 - ct * ct));
            th = phi2;
            gx2 = rr * st * Math.cos(phi2);
            gy2 = rr * st * Math.sin(phi2);
            gz2 = rr * ct * 0.45;
          } else if (isHalo) {
            // 弥散晕/尘埃：填充旋臂之间，低密度散布
            rr = Rmax * (0.12 + 0.88 * Math.pow(grng(), 0.7));
            th = grng() * Math.PI * 2;
            const armPhase = (th / (Math.PI * 2) * GALAXY_ARMS) % GALAXY_ARMS;
            const nearestArmOffset = Math.min(
              ...Array.from({ length: GALAXY_ARMS }, (_, a) => Math.abs(armPhase - a))
            );
            // 让晕粒子略偏向旋臂之间的中点，形成暗隙
            const bias = (nearestArmOffset - GALAXY_ARMS * 0.5) * 0.08 * (rr / Rmax);
            th += bias;
            const haloScatter = (grng() - 0.5) * (0.6 + 0.5 * rr / Rmax);
            th += haloScatter;
            gx2 = Math.cos(th) * rr;
            gy2 = Math.sin(th) * rr;
            gz2 = (grng() - 0.5) * planeSize * 0.055 * (0.4 + 0.6 * rr / Rmax);
          } else {
            // 旋臂：对数螺旋，内圈窄外圈宽，密度内高外低
            armIdx = Math.floor(grng() * GALAXY_ARMS);
            // 半径分布：在中环（0.35-0.8 Rmax）密度最高
            const rT = Math.pow(grng(), 0.65);
            rr = Rmax * (0.06 + 0.94 * rT);
            // 对数螺旋：theta = 基准角 + twist * log(r)
            const baseAngle = armIdx * (Math.PI * 2 / GALAXY_ARMS);
            const twist = Math.log(Math.max(0.08, rr / Rmax)) * GALAXY_TWIST;
            const idealTh = baseAngle + twist;
            // 臂宽：内圈窄、外圈宽，用高斯散射
            const width = GALAXY_ARM_WIDTH_INNER + (GALAXY_ARM_WIDTH_OUTER - GALAXY_ARM_WIDTH_INNER) * (rr / Rmax);
            // Box-Muller 近似正态分布
            const u1 = grng(); const u2 = grng();
            const gauss = Math.sqrt(-2 * Math.log(Math.max(0.001, u1))) * Math.cos(Math.PI * 2 * u2);
            const scatter = gauss * width * 0.5;
            th = idealTh + scatter;
            // 轻微径向振动，让臂有厚度
            rr *= (1 + (grng() - 0.5) * 0.08 * width);
            gx2 = Math.cos(th) * rr;
            gy2 = Math.sin(th) * rr;
            gz2 = (grng() - 0.5) * planeSize * 0.04 * (1 - 0.35 * rr / Rmax);
          }
          basePositionsGalaxy[idx * 3] = gx2;
          basePositionsGalaxy[idx * 3 + 1] = gy2;
          basePositionsGalaxy[idx * 3 + 2] = gz2;
          galaxyR[idx] = Math.hypot(gx2, gy2);
          galaxyUX[idx] = Math.cos(th);
          galaxyUY[idx] = Math.sin(th);
          galaxyTheta[idx] = th;
          galaxyArm[idx] = armIdx;
          galaxyBulge[idx] = isBulge ? 1 : 0;

          // 地形：极坐标网格 + fBm 静态山脉；中心=低频(大起伏主峰)，外圈=高频(细密细节)
          const terrainSize = planeSize * TERRAIN_SIZE_RATIO;
          // u -> 角度，v -> 半径；把平面映射成圆盘
          const tTheta = u * Math.PI * 2;
          const rN = Math.sqrt(v); // 半径归一化，均匀分布面积
          const tR = rN * terrainSize * 0.5;
          const tx = Math.cos(tTheta) * tR;
          const tz = Math.sin(tTheta) * tR;
          // 多倍频 fBm 山脉（确定性相位 → 重建一致），中心高、边缘沉入的悬浮山岛
          // 振幅整体提升 ~60%，并新增 ridged noise 产生尖锐山脊
          let terH = 0;
          terH += Math.sin(tTheta * trFreq[0] + rN * 4.0 + trPhase[0]) * 1.6;   // 主脊
          terH += Math.sin(tTheta * trFreq[1] - rN * 7.0 + trPhase[1]) * 0.9;   // 次脊
          terH += Math.sin(tTheta * trFreq[2] + rN * 13.0 + trPhase[2]) * 0.45;  // 细褶
          terH += Math.sin(tTheta * trFreq[3] - rN * 21.0 + trPhase[3]) * 0.22;  // 微纹
          // ridged noise：|sin| 变换 → 尖锐山脊刃（像真实山脉）
          const ridge = Math.abs(Math.sin(tTheta * trFreq[0] * 0.7 + rN * 11.0 + trPhase[0] * 1.3));
          terH += (ridge * 2.0 - 1.0) * 0.6; // 映射到 [-0.6, +0.6]
          const radial = Math.pow(Math.max(0, 1 - rN), 1.2); // 衰减放缓，外圈保留台地感
          // tanh 软饱和归一化（避免高值区截断导致平顶，永远平滑）
          // 注意：fBm 高度不再写入静态坐标（初始平坦），仅在 animate 中运行时计算
          const hN = (Math.tanh(terH * 0.4) * 0.5 + 0.5) * radial;
          basePositionsTerrain[idx * 3] = tx;
          // 平坦圆盘 + 极微噪防 z-fighting：初始近乎平面，山脉由 terrainRise 驱动升起
          const microNoise = (Math.sin(u * 37 + v * 53) + Math.sin(u * 71 - v * 19)) * 0.0008;
          basePositionsTerrain[idx * 3 + 1] = (-0.32 + microNoise) * planeSize;
          basePositionsTerrain[idx * 3 + 2] = tz;
          // 频段反转：中心(半径小)=低频(0)，外圈=高频(63) —— 中间低频、周围高频
          terrainBand[idx] = Math.min(63, Math.floor(rN * 63));

          const initial = modeRef.current === 'liquidmetal' ? basePositionsLiquid
            : modeRef.current === 'galaxy' ? basePositionsGalaxy
              : modeRef.current === 'ocean' ? basePositionsTerrain
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

    // ═══ 发光湖面（倒影感）：悬浮山岛下方水面，随音频脉动发光 ═══
    const lakeGeo = new THREE.CircleGeometry(planeSize * TERRAIN_SIZE_RATIO * 0.55, 64);
    const lakeMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(accentRef.current || '#4FC3F7'),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const lakeMesh = new THREE.Mesh(lakeGeo, lakeMat);
    lakeMesh.rotation.x = -Math.PI / 2;        // 平铺成水面
    lakeMesh.position.y = -planeSize * 0.32;   // 贴着平盘基准（水面线）
    lakeMesh.visible = false;
    scene.add(lakeMesh);

    // ═══ 灵气悬浮光点：山峰上方漂浮的发光粒子，随低频上浮 ═══
    const SPIRIT_COUNT = 420;
    const spiritPos = new Float32Array(SPIRIT_COUNT * 3);
    const spiritBaseY = new Float32Array(SPIRIT_COUNT);
    const spiritSeed = new Float32Array(SPIRIT_COUNT);
    for (let i = 0; i < SPIRIT_COUNT; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * planeSize * TERRAIN_SIZE_RATIO * 0.5;
      const by = -planeSize * 0.30 + Math.random() * planeSize * 0.10;
      spiritPos[i * 3] = Math.cos(a) * rr;
      spiritPos[i * 3 + 1] = by;
      spiritPos[i * 3 + 2] = Math.sin(a) * rr;
      spiritBaseY[i] = by;
      spiritSeed[i] = Math.random() * 6.2832;
    }
    const spiritGeo = new THREE.BufferGeometry();
    spiritGeo.setAttribute('position', new THREE.BufferAttribute(spiritPos, 3));
    const spiritMat = new THREE.PointsMaterial({
      size: planeSize * 0.018,
      map: createParticleTexture(),
      color: new THREE.Color(accentRef.current || '#4FC3F7'),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
    });
    const spiritPoints = new THREE.Points(spiritGeo, spiritMat);
    spiritPoints.visible = false;
    scene.add(spiritPoints);

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
      if (!hasCoverRef.current || !isPlayingRef.current) return false;
      const accentRGB = hexToRGB(accentRef.current || '#4FC3F7');
      for (let i = 0; i < COUNT; i++) {
        const u = origUV[i * 2];
        const v = origUV[i * 2 + 1];
        const s = sampleCover(u, v);
        const boost = 1.45;
        const minBright = 0.35;
        // 动态深度混合：clayDepth 只做极轻微明暗/微染，脱落粒子仍保持封面色 → 封面始终清晰
        const cd = clayDepth[i]; // [0,1]
        const li = 1.0 - cd * 0.20;       // 深度0→亮1.0, 深度1→亮0.80（仍清晰可辨）
        const am = cd * 0.15;             // 深度0→纯封面, 深度1→仅15%主题色微染（立体感，不洗图案）
        colorAttr.array[i * 3]     = Math.min(1, (Math.max(s[0] * boost, minBright * (0.8 + s[0])) * (1 - am) + accentRGB.r * am) * li);
        colorAttr.array[i * 3 + 1] = Math.min(1, (Math.max(s[1] * boost, minBright * (0.8 + s[1])) * (1 - am) + accentRGB.g * am) * li);
        colorAttr.array[i * 3 + 2] = Math.min(1, (Math.max(s[2] * boost, minBright * (0.8 + s[2])) * (1 - am) + accentRGB.b * am) * li);
        coverLight[i] = s[0] * 0.299 + s[1] * 0.587 + s[2] * 0.114;
      }
      colorAttr.needsUpdate = true;
      return true;
    };

    // 取某形态的基础坐标集（coverflow / liquidmetal / galaxy 星河 / ocean 地形）
    const baseFor = (m) => {
      if (m === 'liquidmetal') return { pos: basePositionsLiquid, nrm: baseNormalsLiquid };
      if (m === 'galaxy') return { pos: basePositionsGalaxy, nrm: null };
      if (m === 'ocean') return { pos: basePositionsTerrain, nrm: null };
      return { pos: basePositionsCover, nrm: baseNormalsCover };
    };

    let firstFrame = true;
    let bassAttack = 0;
    let bassRelease = 0;
    let midSmooth = 0;
    let trebleSmooth = 0;

    // 错层黏土封面：每粒子独立深度状态（clayDepth/clayTarget/clayVel 已在上面分配）

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

          // 流星事件：更频繁，沿螺旋切向飞出
          if (!meteor.active && t > meteor.nextT) {
            let spawnIdx = -1;
            for (let mi = 0; mi < 60; mi++) {
              const ci = Math.floor(Math.random() * COUNT);
              if (galaxyR[ci] / Rmax > 0.45 && !galaxyBulge[ci]) {
                spawnIdx = ci; break;
              }
            }
            if (spawnIdx >= 0) {
              meteor.active = true;
              meteor.idx = spawnIdx;
              meteor.sx = basePositionsGalaxy[spawnIdx * 3];
              meteor.sy = basePositionsGalaxy[spawnIdx * 3 + 1];
              // 沿旋臂切向（螺旋方向）飞出
              const rN = galaxyR[spawnIdx] / Rmax;
              const tangX = -galaxyUY[spawnIdx];
              const tangY = galaxyUX[spawnIdx];
              const flyDist = planeSize * (0.35 + 0.35 * rN);
              meteor.ex = meteor.sx + tangX * flyDist;
              meteor.ey = meteor.sy + tangY * flyDist;
              meteor.prog = 0;
            }
            meteor.nextT = t + 4 + Math.random() * 5; // 流星更频繁
          }
          if (meteor.active) {
            meteor.prog += dt * 0.7; // 流星速度
            if (meteor.prog >= 1) meteor.active = false;
          }

          // 待机能量：让星系持续有缓慢呼吸与流转
          bass   = 0.08 + Math.sin(t * 0.15) * 0.04 + Math.sin(t * 0.05) * 0.02;
          mid    = 0.05 + Math.sin(t * 0.12 + 1) * 0.03;
          treble = 0.035 + Math.sin(t * 0.28 + 2) * 0.015;
        }
      }
      // 节拍包络提速：攻击更快、释放更慢，让鼓点"砸"得更干脆，余韵更久
      if (bass > bassAttack) bassAttack += (bass - bassAttack) * 0.70;
      else bassAttack += (bass - bassAttack) * 0.16;
      bassRelease += (bass - bassRelease) * 0.10;
      midSmooth += (mid - midSmooth) * 0.30;
      trebleSmooth += (treble - trebleSmooth) * 0.35;
      for (let i = 0; i < 64; i++) {
        const t = data[i];
        const k = t > spectrumSmooth[i] ? 0.45 : 0.22; // 上升沿更快，下降沿更柔，凸显节拍跳动
        spectrumSmooth[i] += (t - spectrumSmooth[i]) * k;
      }

      const bassPulse = Math.max(0, bassAttack - bassRelease);
      const totalEnergy = (bassAttack + midSmooth * 0.7 + trebleSmooth * 0.4) / 2.1;
      const beatFreqBoost = beatFreqBoostRef.current; // 鼓点频率增强包络（0..1，逐帧衰减），用于放大频谱响应

      const zAmp = planeSize * MAX_Z_RATIO;
      const isPlaying = isPlayingRef.current;
      const useCover = isPlaying && hasCoverRef.current;
      const isGalaxy = modeRef.current === 'galaxy';
      const isTerrain = modeRef.current === 'ocean';

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
        // 冲击波：仅非 galaxy 模式注入（用户要求星河去掉鼓点打击感）
        if (modeRef.current !== 'galaxy') {
          const imp = Math.min(1, bass) * SHOCK_GAIN * planeSize * 0.10;
          for (let i = 0; i < COUNT; i++) {
            explodeVel[i * 3] += galaxyUX[i] * imp;
            explodeVel[i * 3 + 1] += galaxyUY[i] * imp;
          }
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
        } else if (modeRef.current === 'ocean') {
          // 鼓点给地形一个整体脉冲 + 中心涟漪增强
          beatFreqBoostRef.current = Math.min(1, beatFreqBoostRef.current + 0.45);
        }
      }
      beatPulseRef.current *= Math.pow(BEAT_PULSE_DECAY, dt * 60);          // 帧率无关衰减
      beatFreqBoostRef.current *= Math.pow(BEAT_FREQ_BOOST_DECAY, dt * 60); // 频率增强包络衰减

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

      // ═══ 粒子封面「腻子脱落」模拟：每帧驱动 clayDepth ═══
      // 目标：让 ≈1500+ 粒子持续、随机地"掉到后层再浮回"，但封面始终完整
      //      （靠 MAX_CLAY_FALLEN 硬上限约束同时脱落数 → 最多 ~10% 粒子在后层）
      const fallBudget = Math.max(0, MAX_CLAY_FALLEN - clayFallenCount);
      // 1) 随机脱落（始终进行，完全随机位置；接近上限时自动收敛）
      if (hasData || Math.random() < 0.12) {       // 待机极少量"活"的呼吸，播放后大量脱落
        const attempts = Math.floor(COUNT * CLAY_FALL_RATE) + 1;
        for (let fi = 0; fi < attempts && fi < fallBudget; fi++) {
          const ri = Math.floor(Math.random() * COUNT);
          if (clayDepth[ri] < 0.12) {
            clayTarget[ri] = 0.5 + Math.random() * 0.5; // 掉到中后层（随机深度）
          }
        }
      }
      // 2) 频谱驱动脱落（播放时：能量高的区域更易脱落，与音乐联动）
      if (hasData && clayFallenCount < MAX_CLAY_FALLEN) {
        const spOff = Math.floor(time * 60) % COUNT; // 时间偏移避免每帧同一批粒子
        for (let di = 0; di < COUNT; di += 25) {
          const ri = (di + spOff) % COUNT;
          const bIdx = Math.min(63, Math.floor(distFromCenter[ri] * 63));
          if (spectrumSmooth[bIdx] > CLAY_SPECTRUM_TRIGGER && clayDepth[ri] < 0.18 && Math.random() < 0.07) {
            clayTarget[ri] = 0.4 + Math.random() * 0.6;
          }
        }
      }
      // 3) 每粒子弹簧积分（平滑深度过渡 + 自动回弹）+ 统计脱落中粒子数
      let fc = 0;
      for (let ci = 0; ci < COUNT; ci++) {
        const diff = clayTarget[ci] - clayDepth[ci];
        clayVel[ci] += diff * 8.0 * dt;
        clayVel[ci] *= Math.pow(0.92, dt * 60);   // 阻尼
        clayDepth[ci] += clayVel[ci] * dt;
        if (clayDepth[ci] < 0) clayDepth[ci] = 0;  // 钳制，避免弹簧过冲变负
        else if (clayDepth[ci] > 1) clayDepth[ci] = 1;
        clayTarget[ci] *= Math.pow(CLAY_RETURN_DECAY, dt * 60); // 目标衰减回0 → 自动浮回前层
        if (clayDepth[ci] > 0.12) fc++;
      }
      clayFallenCount = fc;

      // ═══ 地形激活度：平坦 → 播放时升起山脉 → 停播回落（带"长出来"过冲）═══
      {
        const targetRise = (hasData ? 1.0 : TERRAIN_IDLE_RISE) + riseKick;
        const speed = hasData ? TERRAIN_RISE_SPEED : TERRAIN_FALL_SPEED;
        terrainRise += (targetRise - terrainRise) * Math.min(1, dt * speed);
        if (terrainRise > 1.2) terrainRise = 1.2; // 过冲上限，避免穿帮
        // 播放开始边沿：给一次衰减过冲，让山脉"弹出来"
        if (hasData && !wasHasData) riseKick = 0.18;
        wasHasData = hasData;
        riseKick *= Math.pow(0.92, dt * 60); // 过冲缓慢收敛
      }

      for (let i = 0; i < COUNT; i++) {
        const u = origUV[i * 2];
        const v = origUV[i * 2 + 1];
        const dc = distFromCenter[i];

        let bx, by, bz, nx, ny, nz;
        if (isGalaxy) {
          const rN = Math.min(1, galaxyR[i] * invRmax);
          // 频谱映射：中心=高频，外圈=低频，把 64 段频谱绕成同心环
          const band = Math.min(63, Math.floor((1 - rN) * 63));

          // 由内向外的径向涟漪波（频段能量驱动——大幅增强可见度）
          const ripple = Math.sin(rN * RIPPLE_FREQ - time * RIPPLE_SPEED) * spectrumSmooth[band] * planeSize * 0.12 * (1 + beatFreqBoost * GALAXY_BEAT_FREQ_GAIN);

          // 径向频谱柱：不同半径的粒子被对应频段向外推，形成"音波环"
          const radialSpectrum = spectrumSmooth[band] * planeSize * 0.24 * (1 + beatFreqBoost * GALAXY_BEAT_FREQ_GAIN);

          // 低频推核球呼吸（越靠中心越强——大幅增强）
          const bassPush = bassAttack * planeSize * 0.18 * Math.pow(1 - rN, 1.4);

          // 臂波动：沿半径方向螺旋波，让旋臂像流体一样起伏——大幅增强
          const armWave = (hasData ? 1.0 : 0.7) * Math.sin(rN * 16 - time * 2.2 + (galaxyArm[i] >= 0 ? galaxyArm[i] : 0) * 1.1) * planeSize * 0.03 * (1 + beatFreqBoost * 0.6);

          // 垂直音浪：Z 轴随频段能量起伏——大幅增强
          const zWave = spectrumSmooth[band] * planeSize * 0.10 * (1 + beatFreqBoost) * Math.sin(rN * 8 + time * 3);

          const disp = ripple + radialSpectrum + bassPush + armWave;
          let sx = basePositionsGalaxy[i * 3] + galaxyUX[i] * disp + explodePos[i * 3];
          let sy = basePositionsGalaxy[i * 3 + 1] + galaxyUY[i] * disp + explodePos[i * 3 + 1];
          let sz = basePositionsGalaxy[i * 3 + 2] + zWave + explodePos[i * 3 + 2];

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
          // ═══ galaxy：差速旋转 + 螺旋推进 + 鼓点切向冲击 + 核心心跳 + 流星 ═══
          const rN = Math.min(1, galaxyR[i] * invRmax);

          // 差速旋转：内圈快 → 外圈慢，模拟真实星系漩涡
          const diffOmega = hasData ? 0.18 : 0.12;
          const innerOmega = diffOmega;
          const outerOmega = diffOmega * 0.28;
          const ang = time * (innerOmega + (outerOmega - innerOmega) * rN);
          const ca = Math.cos(ang), sa = Math.sin(ang);
          const rx = x * ca - y * sa;
          const ry = x * sa + y * ca;
          x = rx; y = ry;

          // （已移除鼓点切向冲击 beatSpin —— 用户要求去掉鼓点打击感，仅保留平滑频谱跟随）

          // 频谱细碎抖动增强流动感
          const jitter = (trebleSmooth + midSmooth * 0.5) * Math.sin(u * 50 + time * 5 + i * 0.3) * planeSize * 0.005 * (1 + beatFreqBoost * GALAXY_BEAT_FREQ_GAIN);
          x += nx * jitter; y += ny * jitter; z += nz * jitter;

          // 整体呼吸缩放（待机时更明显）
          const globalBreathe = 1 + (hasData ? 0.015 : 0.04) * Math.sin(time * (hasData ? 0.9 : 0.5));
          x *= globalBreathe; y *= globalBreathe; z *= globalBreathe;

          // 核心心跳：核球粒子做缓慢膨胀/收缩
          if (galaxyBulge[i]) {
            const heartPhase = Math.sin(time * Math.PI / (hasData ? 4 : 5));
            const breathe = 1 + heartPhase * (hasData ? 0.05 : 0.09);
            x *= breathe; y *= breathe; z *= breathe;
          }

          // 流星：选中的粒子做高速切向位移
          const meteor = idleMeteorRef.current;
          if (!hasData && meteor.active && meteor.idx === i) {
            const mp = meteor.prog;
            const easeP = mp < 0.12 ? mp / 0.12 : (mp > 0.88 ? (1 - mp) / 0.12 : 1);
            x = meteor.sx + (meteor.ex - meteor.sx) * mp;
            y = meteor.sy + (meteor.ey - meteor.sy) * mp;
            // 流星带一点弧线：向中心偏
            const arc = Math.sin(mp * Math.PI) * planeSize * 0.04;
            x += galaxyUX[i] * arc;
            y += galaxyUY[i] * arc;
          }
        } else if (targetShape === 'coverflow') {
          // ═══ 粒子封面「腻子脱落」动画：全部粒子初始在前层(完整封面)，播放时个别粒子掉到后层再浮回 ═══
          const cd = clayDepth[i];           // 当前深度 [0,1]
          const layerZ = cd * planeSize * LAYER_GAP * (COVER_LAYERS - 1) * CLAY_FALL_DEPTH_SCALE; // 深度→Z偏移（收敛，避免破洞）

          // 呼吸（整体轻微深度起伏，深层粒子相位略不同）
          const breathe = hasData
            ? (0.04 + totalEnergy * 0.12)
            : (0.03 + Math.sin(time * 0.4 + cd * 2.5) * 0.02);

          // 径向波纹（Z轴为主，深度影响相位）
          const bandIdx = Math.min(63, Math.floor(dc * 63));
          const localE = spectrumSmooth[bandIdx];
          const ripple = Math.sin(dc * 12 - time * 4 + cd * 2.2) * localE * zAmp * 0.40 * (1 + beatFreqBoost * 1.0);

          // 腻子有机位移（深层粒子扰动更大——更像松散的腻子碎屑）
          const clayWob = (Math.sin(u * 3 + time * 0.5 + clayPhaseX[i] * 6.2832) * 0.5
                        + Math.sin(v * 4 - time * 0.4 + clayPhaseY[i] * 6.2832) * 0.3)
                        * planeSize * (0.008 + cd * 0.014);

          // X/Y 极微扰（保持封面图案完整；深层略大但仍可读）
          const microXY = Math.sin(u * 18 + time * 2 + cd * 3) * Math.cos(v * 15 + time * 1.8)
                          * planeSize * (0.002 + cd * 0.003);

          x = bx + microXY;
          y = by + microXY * 0.7;
          z = bz + layerZ + breathe * planeSize * 0.08 + ripple + clayWob;
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

          const localPulse = (energy * 1.25 * (1 + beatFreqBoost * LIQUID_BEAT_FREQ_GAIN) + bassAttack * 1.1 + midSmooth * 0.5) * activeFactor; // 鼓点增强频谱能量位移
          const displacement = (localPulse + beatPulseRef.current * 0.5) * planeSize * 0.11; // 鼓点额外推动 + 整球脉冲

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
          const bassBoost = bassPulse * planeSize * 0.26 * activeFactor; // 鼓点强度增强（0.18→0.26）

          // 两端舒缓起伏（原有逻辑保留）
          const idleWave = idleFactor * Math.sin(v * 20 + time * 1.8 + i * 0.1) * Math.cos(u * 14 + time * 1.3) * planeSize * 0.06;

          // 金属光泽漂移：高光区缓慢移动（通过微小的额外位移实现）
          const shimmer = !hasData ? Math.sin(time * 0.15 + u * 10 + v * 7) * Math.cos(time * 0.11 - u * 5) * planeSize * 0.004 : 0;

          // 整球随拍一缩一放（squash）：赤道附近缩放更明显、两极收敛
          const beatScale = 1 + beatPulseRef.current * 0.10 * (1 - band * 0.4);
          const r = (baseR + displacement + wave + equatorWave + bassBoost + idleWave + hotDisp + dropletDisp + shimmer) * beatScale;
          x = nx * r;
          y = ny * r;
          z = nz * r;
        } else if (targetShape === 'ocean') {
          // ═══ 地形：初始平坦圆盘 → 播放时从音频能量中生长出山脉 ═══
          const rN = Math.sqrt(v);
          const tTheta = u * Math.PI * 2;
          const band = terrainBand[i];
          const energy = spectrumSmooth[band];
          const freqWeight = (1 - rN);

          // 运行时重新计算 fBm 山高（与 buildBase 同算法、同参数 → 形态一致）
          let terH = 0;
          terH += Math.sin(tTheta * trFreq[0] + rN * 4.0 + trPhase[0]) * 1.6;
          terH += Math.sin(tTheta * trFreq[1] - rN * 7.0 + trPhase[1]) * 0.9;
          terH += Math.sin(tTheta * trFreq[2] + rN * 13.0 + trPhase[2]) * 0.45;
          terH += Math.sin(tTheta * trFreq[3] - rN * 21.0 + trPhase[3]) * 0.22;
          const ridge = Math.abs(Math.sin(tTheta * trFreq[0] * 0.7 + rN * 11.0 + trPhase[0] * 1.3));
          terH += (ridge * 2.0 - 1.0) * 0.6;
          const radial = Math.pow(Math.max(0, 1 - rN), 1.2);
          const hN = (Math.tanh(terH * 0.4) * 0.5 + 0.5) * radial;

          // 静态山高 × 激活度（terrainRise=0→平坦, =1→全高山脉）
          const staticH = (hN - 0.35) * planeSize * 0.95 * terrainRise; // 0.70→0.95：山更高（v1.21）

          // 音频驱动高度（播放时即时响应，不受 terrainRise 限制）
          const audioH = hasData
            ? energy * planeSize * TERRAIN_GAIN * (0.35 + freqWeight * 1.8)
            : 0;

          // 鼓点脉冲（有山时才明显）
          const beatPulseH = bassAttack * planeSize * 0.22 * (1 + beatPulseRef.current * 3.0) // 0.16→0.22（v1.21）
                              * (0.4 + freqWeight) * terrainRise;

          // 涟漪波（鼓点从中心向外扩散）
          const ripple = beatPulseRef.current * planeSize * 0.07
            * Math.sin(rN * 14 - time * 6) * Math.exp(-rN * 2.8) * (1 + beatFreqBoost * 0.6);

          // 待机呼吸（比原来明显 ~3 倍；播放时也保留微量呼吸让山"活"）
          const idleBreathe = Math.sin(time * 0.35 + rN * 6 + u * 3) * planeSize * 0.028
                               * (hasData ? 0.25 : 1);

          let h = by + staticH + audioH + beatPulseH + ripple + idleBreathe;
          h = Math.max(-planeSize * 0.30, Math.min(planeSize * 0.95, h)); // 钳制上限 0.72→0.95（v1.21）

          x = bx; y = h; z = bz;
          nx = 0; ny = 1; nz = 0;
        }

        posAttr.array[i * 3] = x;
        posAttr.array[i * 3 + 1] = y;
        posAttr.array[i * 3 + 2] = z;

        if (isGalaxy) {
          // 星河着色：内核=主题色(炽热)，外圈=封面平均色(冷)，加色混合辉光
          const rN = Math.min(1, galaxyR[i] * invRmax);
          const isHaloNow = galaxyArm[i] < 0 && !galaxyBulge[i];
          const coreMix = Math.pow(1 - rN, 1.6);
          const cr = accentRGB.r, cg = accentRGB.g, cb = accentRGB.b;
          const ar = cavg.r, ag = cavg.g, ab = cavg.b;
          let r = cr * coreMix + ar * (1 - coreMix);
          let g = cg * coreMix + ag * (1 - coreMix);
          let b = cb * coreMix + ab * (1 - coreMix);

          // 弥散晕偏冷、偏暗，形成背景星尘
          if (isHaloNow) {
            r = r * 0.6 + 0.1; g = g * 0.65 + 0.12; b = b * 0.85 + 0.18;
          }

          // 星云漂移：外圈颜色在封面平均色与 accent 之间极慢往复
          if (!hasData && rN > 0.5) {
            const nebulaPhase = Math.sin(time * Math.PI / 12) * 0.5 + 0.5;
            r = r * (1 - nebulaPhase * 0.2) + ar * nebulaPhase * 0.2;
            g = g * (1 - nebulaPhase * 0.2) + ag * nebulaPhase * 0.2;
            b = b * (1 - nebulaPhase * 0.2) + ab * nebulaPhase * 0.2;
          }

          const band = Math.min(63, Math.floor(rN * 63));
          const localE = spectrumSmooth[band];
          let intensity = 0.45 + bassAttack * 0.6 + localE * 2.4 * (1 + beatFreqBoost * GALAXY_BEAT_FREQ_GAIN); // 去掉beatPulse，增强频谱驱动
          if (galaxyBulge[i]) intensity += 0.7 + bassAttack * 0.5; // 核心略亮（去掉鼓点冲击）
          if (isHaloNow) intensity *= 0.55;

          // 星星闪烁叠加
          let twinkleBoost = 0;
          if (idleTwinkleRef.current) {
            twinkleBoost = idleTwinkleRef.current[i] * (!hasData ? 1.4 : 0.6);
          }
          // 流星粒子额外增亮，并拖出尾迹感（通过周围粒子也增亮一点）
          const meteor = idleMeteorRef.current;
          if (!hasData && meteor.active) {
            const dx = basePositionsGalaxy[i * 3] - meteor.sx;
            const dy = basePositionsGalaxy[i * 3 + 1] - meteor.sy;
            const dMeteor = Math.hypot(dx, dy);
            if (meteor.idx === i) twinkleBoost += 2.2;
            else if (dMeteor < planeSize * 0.08) twinkleBoost += 0.25 * (1 - dMeteor / (planeSize * 0.08));
          }

          colorAttr.array[i * 3]     = Math.min(1, r * intensity + twinkleBoost);
          colorAttr.array[i * 3 + 1] = Math.min(1, g * intensity + twinkleBoost);
          colorAttr.array[i * 3 + 2] = Math.min(1, b * intensity + twinkleBoost);
        } else if (isTerrain) {
          // 地形着色：色带 + 雾气 + 峰顶辉光 + 动态等高线 + 音频点亮
          const rN = Math.sqrt(v); // 0=中心, 1=外圈
          const band = terrainBand[i];
          const energy = spectrumSmooth[band];
          const normH = Math.max(0, Math.min(1, (y / planeSize + 0.30) / 0.98));

          // 谷底深色
          let r = accentRGB.r * 0.06 + 0.015;
          let g = accentRGB.g * 0.06 + 0.02;
          let b = accentRGB.b * 0.10 + 0.03;

          // 坡面 accent
          r += normH * accentRGB.r * 0.72;
          g += normH * accentRGB.g * 0.72;
          b += normH * accentRGB.b * 0.72;

          // 峰顶泛白（雪顶）
          const crest = Math.max(0, (normH - 0.62) / 0.38);
          r += crest * 0.7;   // 0.5→0.7：雪顶更亮（v1.21）
          g += crest * 0.7;
          b += crest * 0.72;

          // 谷底压暗（增加纵深）
          const vally = Math.max(0, (0.30 - normH) / 0.30);
          r *= (1 - vally * 0.55);
          g *= (1 - vally * 0.55);
          b *= (1 - vally * 0.55);

          // 伪漫反射：固定光源(右上)方向，用高度坡度近似法线 → 立体感
          const slopeProxy = Math.abs(rN - 0.35) * 1.6 + Math.sin(u * 50 + i * 0.03) * 0.2;
          const diffuse = 0.55 + 0.45 * Math.max(0, Math.cos(slopeProxy * Math.PI * 0.8 + 0.4));
          r *= diffuse; g *= diffuse; b *= diffuse;

          // —— 低处流动雾（平坦时雾浓，升起后雾散；雾随时间缓慢漂移，更"活"）——
          const fogDensity = Math.max(0, (0.20 - normH) / 0.20) * 0.50 * (1 - terrainRise * 0.7)
                             * (0.8 + 0.2 * Math.sin(time * 0.25 + u * 5 + v * 3)); // 流动相位（v1.21）
          r += fogDensity * 0.12;
          g += fogDensity * 0.15;
          b += fogDensity * 0.22;

          // —— 峰顶音频辉光（播放时山峰发光）——
          const audioGlow = energy * 0.55 * terrainRise * crest; // 0.40→0.55（v1.21）
          r += audioGlow * accentRGB.r * 0.5;
          g += audioGlow * accentRGB.g * 0.5;
          b += audioGlow * accentRGB.b * 0.6;

          // 等高线：全高时亮度 ×2（更惊艳）
          const N = 11;
          const cf = Math.abs((normH * N - Math.floor(normH * N)) - 0.5);
          const contourBoost = 1 + terrainRise * 1.6; // 1.0→1.6：等高线更明显（v1.21）
          const contour = Math.max(0, 0.045 - cf) / 0.045 * 0.16 * contourBoost;
          r += contour; g += contour; b += contour;

          // 中心主峰(低频)更亮
          const centerGlow = (1 - rN) * 0.22;
          r += centerGlow * accentRGB.r;
          g += centerGlow * accentRGB.g;
          b += centerGlow * accentRGB.b;

          // 音频能量点亮局部
          const intensity = 0.6 + energy * 1.0 * (1 + beatFreqBoost * 0.8) + bassAttack * 0.4 + beatPulseRef.current * 0.6;

          colorAttr.array[i * 3]     = Math.min(1, r * intensity);
          colorAttr.array[i * 3 + 1] = Math.min(1, g * intensity);
          colorAttr.array[i * 3 + 2] = Math.min(1, b * intensity);
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
          // 错层：后层仅轻微变暗（动态 clayDepth 驱动，脱落粒子仍清晰可见）
          const layerDim = 1.0 - clayDepth[i] * 0.20; // 深度0→亮1.0, 深度1→亮0.80
          // 全息微闪：高频时粒子亮度随机微跳（仅 coverflow）
          const holoFlicker = (targetShape === 'coverflow') ? trebleSmooth * 0.12 * ((i * 0.13) % 1) : 0;
          colorAttr.array[i * 3]     = Math.min(1, ar_mod * intensity * outFactor * layerDim + bassPulse * 0.65 + holoFlicker);
          colorAttr.array[i * 3 + 1] = Math.min(1, ag_mod * intensity * outFactor * layerDim + bassPulse * 0.65 + holoFlicker);
          colorAttr.array[i * 3 + 2] = Math.min(1, ab_mod * intensity * outFactor * layerDim + bassPulse * 0.65 + windGlow * 0.35 + holoFlicker * 1.2);
        }
      }
      posAttr.needsUpdate = true;
      if (!useCover || isGalaxy || isTerrain) colorAttr.needsUpdate = true;

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

      // ═══ 湖面 + 灵气光点（仅地形模式显现）═══
      if (isTerrain) {
        lakeMesh.visible = true;
        lakeMat.color.setRGB(accentRGB.r, accentRGB.g, accentRGB.b);
        lakeMat.opacity = terrainRise * (0.06 + bassAttack * 0.18); // 随音频脉动发光
        const lakeScale = 1 + bassAttack * 0.04;
        lakeMesh.scale.set(lakeScale, lakeScale, 1);
        spiritPoints.visible = true;
        spiritMat.color.setRGB(accentRGB.r, accentRGB.g, accentRGB.b);
        spiritMat.opacity = terrainRise * 0.5;
        for (let i = 0; i < SPIRIT_COUNT; i++) {
          const ph = spiritSeed[i];
          spiritPos[i * 3 + 1] = spiritBaseY[i]
            + Math.sin(time * 0.6 + ph) * planeSize * 0.03
            + bassAttack * planeSize * 0.06 * (0.5 + 0.5 * Math.sin(time * 1.3 + ph));
          // 缓慢径向漂移，让灵气"流动"
          const dx = spiritPos[i * 3], dz = spiritPos[i * 3 + 2];
          const ang = Math.atan2(dz, dx) + dt * 0.05;
          const rad = Math.hypot(dx, dz);
          spiritPos[i * 3] = Math.cos(ang) * rad;
          spiritPos[i * 3 + 2] = Math.sin(ang) * rad;
        }
        spiritGeo.attributes.position.needsUpdate = true;
      } else {
        lakeMesh.visible = false;
        spiritPoints.visible = false;
      }

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
