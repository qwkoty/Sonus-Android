import { useEffect, useRef } from 'react';
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

// 3D 封面粒子画：2 万粒子构成一个轻微弯曲的“封面穹顶”
// 电影镜头：用户双指捏合缩放 + 双指划拉旋转（手势驱动）
// 布幔动画：多层正弦波像液体绸缎一样在封面上流动，音频能量让整体穹顶像鼓皮一样膨胀
// 视觉优化：粒子使用圆形纹理、间距加大；不再做中心低频/外圈高频的分层，整体随音乐呼吸起伏
export default function Visualizer3D({ accent = '#4FC3F7', cover = '', onReady }) {
  const containerRef = useRef(null);
  const accentRef = useRef(accent);
  const coverRef = useRef(cover);
  const imageDataRef = useRef(null);  // 封面像素 RGBA
  const hasCoverRef = useRef(false);
  const onReadyRef = useRef(onReady);
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);
  useEffect(() => { accentRef.current = accent; }, [accent]);
  useEffect(() => { coverRef.current = cover; }, [cover]);

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
  });

  // 加载封面并采样为 ImageData
  // 通过本地代理加载，代理返回 CORS 头，img 设 crossOrigin 后 canvas 不会被污染
  useEffect(() => {
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
          } catch (e) {
            imageDataRef.current = null;
            hasCoverRef.current = false;
          }
        };
        img.onerror = () => { imageDataRef.current = null; hasCoverRef.current = false; };
        img.src = proxyUrl;
      } catch {
        // 代理不可用时直接加载（canvas 会被污染，退化为渐变色）
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

    // 安卓原生 GPU 性能充足，使用完整 dpr + 抗锯齿
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

    const FILL = 1.0;            // 平面占可见区比例，1.0 = 撑满短边
    const MAX_Z_RATIO = 0.09;    // Z 起伏最大占可见半边比例
    const DOME_DEPTH_RATIO = 0.18; // 封面穹顶边缘向后的弯曲深度

    let planeSize, cameraZ;

    const computeLayout = () => {
      W = container.offsetWidth;
      H = container.offsetHeight;
      const aspect = W / H;
      const minDim = Math.min(W, H);
      cameraZ = minDim * 2.4;
      const halfFovRad = (FOV / 2) * Math.PI / 180;
      const visibleHalf = cameraZ * Math.tan(halfFovRad);
      planeSize = visibleHalf * FILL;   // 撑满短边方向
      camera.aspect = aspect;
      camera.position.z = cameraZ;
      camera.updateProjectionMatrix();
    };
    computeLayout();

    // ---- 粒子网格：X-Y 平面排满 planeSize x planeSize 正方形 ----
    const COUNT = GRID * GRID;
    const positions = new Float32Array(COUNT * 3);
    const colors = new Float32Array(COUNT * 3);
    const origUV = new Float32Array(COUNT * 2);       // 原始归一化 uv (0..1)
    const distFromCenter = new Float32Array(COUNT);   // 距中心归一化距离
    const baseZ = new Float32Array(COUNT);            // 穹顶基础曲面

    const buildGrid = () => {
      let idx = 0;
      const half = planeSize;
      const step = (planeSize * 2) / (GRID - 1);
      for (let gy = 0; gy < GRID; gy++) {
        for (let gx = 0; gx < GRID; gx++) {
          const x = -half + gx * step;
          const y = half - gy * step; // y 翻转匹配图像坐标
          const u = gx / (GRID - 1);
          const v = gy / (GRID - 1);
          const dx = u - 0.5, dy = v - 0.5;
          const dc = Math.min(1, Math.sqrt(dx * dx + dy * dy) * 2);
          distFromCenter[idx] = dc;
          // 穹顶：中心平、边缘向后弯曲，让方形封面看起来更圆、更有立体感
          baseZ[idx] = -planeSize * DOME_DEPTH_RATIO * (1 - Math.cos(dc * Math.PI / 2));
          positions[idx * 3] = x;
          positions[idx * 3 + 1] = y;
          positions[idx * 3 + 2] = baseZ[idx];
          origUV[idx * 2] = u;
          origUV[idx * 2 + 1] = v;
          idx++;
        }
      }
    };
    buildGrid();

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: planeSize * 2 / GRID * 0.55,   // 粒子变小、间距拉开，呈现细腻圆点阵
      map: createParticleTexture(),
      vertexColors: true,
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
      sizeAttenuation: true,
      alphaTest: 0.05,
      blending: THREE.NormalBlending,
    });

    const points = new THREE.Points(geometry, material);
    scene.add(points);

    let raf;
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

    // 封面颜色只设置一次（封面固定时大幅省性能）；无封面时每帧用渐变 + 能量
    let coverColorApplied = false;
    const applyCoverColors = () => {
      if (!hasCoverRef.current) return false;
      for (let i = 0; i < COUNT; i++) {
        const u = origUV[i * 2];
        const v = origUV[i * 2 + 1];
        const s = sampleCover(u, v);
        const boost = 0.95;
        const minBright = 0.12;   // 暗部保底，避免深色背景里消失
        colorAttr.array[i * 3]     = Math.max(s[0] * boost, minBright * (0.6 + s[0]));
        colorAttr.array[i * 3 + 1] = Math.max(s[1] * boost, minBright * (0.6 + s[1]));
        colorAttr.array[i * 3 + 2] = Math.max(s[2] * boost, minBright * (0.6 + s[2]));
      }
      colorAttr.needsUpdate = true;
      return true;
    };

    let firstFrame = true;
    // 整体能量平滑
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
        // 待机动画：明显律动的能量起伏，让布幔效果始终可见
        const t = Date.now() * 0.001;
        bass = 0.20 + Math.sin(t * 0.60) * 0.10 + Math.sin(t * 1.25) * 0.06;
        mid = 0.14 + Math.sin(t * 0.90 + 1) * 0.07;
        treble = 0.10 + Math.sin(t * 1.20 + 2) * 0.05;
      }
      // bass attack/release 保留鼓点冲击感
      if (bass > bassAttack) bassAttack += (bass - bassAttack) * 0.55;
      else bassAttack += (bass - bassAttack) * 0.28;
      bassRelease += (bass - bassRelease) * 0.12;
      midSmooth += (mid - midSmooth) * 0.22;
      trebleSmooth += (treble - trebleSmooth) * 0.28;

      const bassPulse = Math.max(0, bassAttack - bassRelease);
      const totalEnergy = (bassAttack + midSmooth * 0.7 + trebleSmooth * 0.4) / 2.1;

      const time = Date.now() * 0.001;
      const breath = 1 + Math.sin(time * 0.6) * 0.020 + totalEnergy * 0.06 + bassPulse * 0.10;
      const zAmp = planeSize * MAX_Z_RATIO;
      const hasCover = hasCoverRef.current;

      // 封面就绪后应用一次颜色
      if (hasCover && !coverColorApplied) {
        coverColorApplied = applyCoverColors();
      } else if (!hasCover) {
        coverColorApplied = false;
      }

      // 每帧更新 Z；无封面时同时更新 color
      const needColorUpdate = !hasCover;
      // 布幔波动参数：多层正弦波叠加，像液体绸缎
      const windSpeed = 1.6;
      const accentRGB = hexToRGB(accentRef.current || '#4FC3F7');

      for (let i = 0; i < COUNT; i++) {
        const u = origUV[i * 2];
        const v = origUV[i * 2 + 1];
        const dc = distFromCenter[i]; // 0 中心 ~ 1 边角

        // 液体绸缎式波动：X、Y、对角线三层波叠加
        const wave1 = Math.sin(u * 4 * Math.PI + time * windSpeed) * 0.22;
        const wave2 = Math.sin(v * 3 * Math.PI + time * windSpeed * 0.8 + 1.2) * 0.18;
        const wave3 = Math.sin((u + v) * 5 * Math.PI + time * windSpeed * 1.3) * 0.10;
        const swirl = Math.sin(dc * 8 - time * 1.2) * 0.08;
        const windZ = (wave1 + wave2 + wave3 + swirl) * (1 + totalEnergy * 0.4);

        // 整体能量让穹顶像鼓皮一样整体膨胀（中心更明显）
        const inflate = totalEnergy * Math.cos(dc * Math.PI / 2) * 0.7;
        // bass 鼓点：中心短促冲击，向外快速衰减
        const pulse = bassPulse * Math.exp(-dc * dc * 4) * 1.3;

        posAttr.array[i * 3 + 2] = baseZ[i] + (windZ + inflate + pulse) * zAmp;

        if (needColorUpdate) {
          const windGlow = Math.abs(windZ) * 0.35;
          const intensity = 0.18 + totalEnergy * 1.4 + windGlow;
          const outFactor = 1 - dc * 0.35;
          colorAttr.array[i * 3]     = Math.min(1, accentRGB.r * intensity * outFactor + pulse * 0.5);
          colorAttr.array[i * 3 + 1] = Math.min(1, accentRGB.g * intensity * outFactor + pulse * 0.5);
          colorAttr.array[i * 3 + 2] = Math.min(1, accentRGB.b * intensity * outFactor + pulse * 0.5 + windGlow * 0.3);
        }
      }
      posAttr.needsUpdate = true;
      if (needColorUpdate) colorAttr.needsUpdate = true;

      // ===== 电影镜头：手势驱动 =====
      const g = gestureRef.current;
      g.zoom += (g.targetZoom - g.zoom) * 0.18;
      g.rotation += (g.targetRotation - g.rotation) * 0.18;
      // 缩放限制 0.4 ~ 3.0
      const clampedZoom = Math.max(0.4, Math.min(3.0, g.zoom));
      camera.position.z = cameraZ / clampedZoom;
      // 用户手势旋转
      points.rotation.y = g.rotation;
      // 微俯仰 + 随风轻微摇摆
      points.rotation.x = -0.12 + Math.sin(time * 0.5) * 0.03;
      points.rotation.z = Math.cos(time * 0.4) * 0.015;
      camera.position.x = 0;
      camera.position.y = 0;
      camera.lookAt(0, 0, 0);

      // 整体呼吸缩放（基础呼吸 + 能量增强）
      const sc = breath;
      points.scale.set(sc, sc, 1);

      renderer.render(scene, camera);

      if (firstFrame) {
        firstFrame = false;
        if (onReadyRef.current) onReadyRef.current();
      }
      raf = requestAnimationFrame(animate);
    };
    animate();

    // ===== 手势控制：单指划动旋转 + 双指缩放/旋转 =====
    const dom = renderer.domElement;
    const dist = (t1, t2) => Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
    const angle = (t1, t2) => Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX);
    const ROTATE_SENSITIVITY = 0.006; // 单指水平滑动灵敏度
    const onTouchStart = (e) => {
      const g = gestureRef.current;
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
      if (g.pinching && e.touches.length === 2) {
        e.preventDefault();
        const d = dist(e.touches[0], e.touches[1]);
        const a = angle(e.touches[0], e.touches[1]);
        // 缩放 = 当前距离 / 起始距离
        const scale = d / Math.max(1, g.startDist);
        g.targetZoom = Math.max(0.4, Math.min(3.0, g.startZoom * scale));
        // 旋转 = 当前角度 - 起始角度
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
    };
    // 鼠标滚轮缩放（桌面端调试用）
    const onWheel = (e) => {
      const g = gestureRef.current;
      g.targetZoom = Math.max(0.4, Math.min(3.0, g.targetZoom * (e.deltaY > 0 ? 0.92 : 1.08)));
    };
    dom.style.touchAction = 'none';
    dom.addEventListener('touchstart', onTouchStart, { passive: false });
    dom.addEventListener('touchmove', onTouchMove, { passive: false });
    dom.addEventListener('touchend', onTouchEnd);
    dom.addEventListener('wheel', onWheel, { passive: true });

    const handleResize = () => {
      computeLayout();
      buildGrid();
      posAttr.needsUpdate = true;
      material.size = planeSize * 2 / GRID * 0.55;
      coverColorApplied = false;   // 网格重建后需重新应用封面颜色
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
