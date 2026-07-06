import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { getSpectrumBars } from '../audio/engine';
import { getProxyUrl } from '../api/music';

const GRID = 142;             // 142x142 = 20164 ≈ 2 万粒子
const SPHERE_U = 160;         // 球面 u 细分
const SPHERE_V = 128;         // 球面 v 细分
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

// 3D 封面粒子画：2 万粒子在 X-Y 平面排满封面图像（每粒子颜色 = 封面对应像素）
// 电影镜头：用户双指捏合缩放 + 双指划拉旋转（手势驱动）
// 液态金属：球面粒子随音频高频震荡，呈现金属流体感
export default function Visualizer3D({ accent = '#4FC3F7', cover = '', shape = 'cover', onReady }) {
  const containerRef = useRef(null);
  const accentRef = useRef(accent);
  const coverRef = useRef(cover);
  const shapeRef = useRef(shape);
  const imageDataRef = useRef(null);  // 封面像素 RGBA
  const hasCoverRef = useRef(false);
  const coverLightRef = useRef(null); // 封面亮度采样（液态金属用）
  const onReadyRef = useRef(onReady);
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);
  useEffect(() => { accentRef.current = accent; }, [accent]);
  useEffect(() => { coverRef.current = cover; }, [cover]);
  useEffect(() => { shapeRef.current = shape; }, [shape]);

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
    if (!cover) { imageDataRef.current = null; coverLightRef.current = null; hasCoverRef.current = false; return; }
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
            const data = cx.getImageData(0, 0, SIZE, SIZE).data;
            imageDataRef.current = data;
            // 预计算封面亮度图（液态金属根据亮度凹凸）
            const light = new Float32Array(SIZE * SIZE);
            for (let i = 0; i < SIZE * SIZE; i++) {
              const o = i * 4;
              light[i] = (data[o] * 0.299 + data[o + 1] * 0.587 + data[o + 2] * 0.114) / 255;
            }
            coverLightRef.current = light;
            hasCoverRef.current = true;
          } catch {
            imageDataRef.current = null;
            coverLightRef.current = null;
            hasCoverRef.current = false;
          }
        };
        img.onerror = () => { imageDataRef.current = null; coverLightRef.current = null; hasCoverRef.current = false; };
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
            const data = cx.getImageData(0, 0, SIZE, SIZE).data;
            imageDataRef.current = data;
            const light = new Float32Array(SIZE * SIZE);
            for (let i = 0; i < SIZE * SIZE; i++) {
              const o = i * 4;
              light[i] = (data[o] * 0.299 + data[o + 1] * 0.587 + data[o + 2] * 0.114) / 255;
            }
            coverLightRef.current = light;
            hasCoverRef.current = true;
          } catch {
            imageDataRef.current = null;
            coverLightRef.current = null;
            hasCoverRef.current = false;
          }
        };
        img.onerror = () => { imageDataRef.current = null; coverLightRef.current = null; hasCoverRef.current = false; };
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

    let planeSize, cameraZ, sphereR;

    const computeLayout = () => {
      W = container.offsetWidth;
      H = container.offsetHeight;
      const aspect = W / H;
      const minDim = Math.min(W, H);
      cameraZ = minDim * 2.4;
      const halfFovRad = (FOV / 2) * Math.PI / 180;
      const visibleHalf = cameraZ * Math.tan(halfFovRad);
      planeSize = visibleHalf * FILL;   // 撑满短边方向
      sphereR = planeSize * 0.78;       // 球体半径
      camera.aspect = aspect;
      camera.position.z = cameraZ;
      camera.updateProjectionMatrix();
    };
    computeLayout();

    // ===== 几何数据 =====
    let COUNT = 0;
    let positions = null;
    let colors = null;
    let origUV = null;
    let distFromCenter = null;
    let normals = null; // 液态金属用

    const geometry = new THREE.BufferGeometry();
    let material;
    let points;

    const sampleCover = (u, v) => {
      const d = imageDataRef.current;
      if (!d) return null;
      const px = Math.min(GRID - 1, Math.max(0, Math.floor(u * GRID)));
      const py = Math.min(GRID - 1, Math.max(0, Math.floor(v * GRID)));
      const i = (py * GRID + px) * 4;
      return [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255];
    };

    const sampleCoverLight = (u, v) => {
      const d = coverLightRef.current;
      if (!d) return 0.5;
      const px = Math.min(GRID - 1, Math.max(0, Math.floor(u * GRID)));
      const py = Math.min(GRID - 1, Math.max(0, Math.floor(v * GRID)));
      return d[py * GRID + px] || 0.5;
    };

    // 封面模式：X-Y 平面网格
    const buildCoverGrid = () => {
      COUNT = GRID * GRID;
      positions = new Float32Array(COUNT * 3);
      colors = new Float32Array(COUNT * 3);
      origUV = new Float32Array(COUNT * 2);
      distFromCenter = new Float32Array(COUNT);
      normals = null;
      let idx = 0;
      const half = planeSize;
      const step = (planeSize * 2) / (GRID - 1);
      for (let gy = 0; gy < GRID; gy++) {
        for (let gx = 0; gx < GRID; gx++) {
          const x = -half + gx * step;
          const y = half - gy * step; // y 翻转匹配图像坐标
          positions[idx * 3] = x;
          positions[idx * 3 + 1] = y;
          positions[idx * 3 + 2] = 0;
          const u = gx / (GRID - 1);
          const v = gy / (GRID - 1);
          origUV[idx * 2] = u;
          origUV[idx * 2 + 1] = v;
          const dx = u - 0.5, dy = v - 0.5;
          distFromCenter[idx] = Math.min(1, Math.sqrt(dx * dx + dy * dy) * 2);
          idx++;
        }
      }
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      material = new THREE.PointsMaterial({
        size: planeSize * 2 / GRID * 1.08,
        vertexColors: true,
        transparent: true,
        opacity: 1.0,
        depthWrite: false,
        sizeAttenuation: true,
        blending: THREE.NormalBlending,
      });
    };

    // 液态金属模式：UV 球面
    const buildLiquidSphere = () => {
      COUNT = SPHERE_U * SPHERE_V;
      positions = new Float32Array(COUNT * 3);
      colors = new Float32Array(COUNT * 3);
      origUV = new Float32Array(COUNT * 2);
      distFromCenter = null;
      normals = new Float32Array(COUNT * 3);
      let idx = 0;
      for (let iv = 0; iv < SPHERE_V; iv++) {
        for (let iu = 0; iu < SPHERE_U; iu++) {
          const u = iu / SPHERE_U;
          const v = iv / (SPHERE_V - 1);
          origUV[idx * 2] = u;
          origUV[idx * 2 + 1] = v;
          const theta = v * Math.PI;
          const phi = u * Math.PI * 2;
          const nx = Math.sin(theta) * Math.cos(phi);
          const ny = Math.cos(theta);
          const nz = Math.sin(theta) * Math.sin(phi);
          normals[idx * 3] = nx;
          normals[idx * 3 + 1] = ny;
          normals[idx * 3 + 2] = nz;
          positions[idx * 3] = nx * sphereR;
          positions[idx * 3 + 1] = ny * sphereR;
          positions[idx * 3 + 2] = nz * sphereR;
          idx++;
        }
      }
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      material = new THREE.PointsMaterial({
        size: Math.max(1.5, sphereR / 120),
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        sizeAttenuation: true,
        blending: THREE.AdditiveBlending,
      });
    };

    const buildGeometry = () => {
      if (shapeRef.current === 'liquid') buildLiquidSphere();
      else buildCoverGrid();
      points = new THREE.Points(geometry, material);
      scene.add(points);
    };
    buildGeometry();

    let raf;
    const posAttr = geometry.attributes.position;
    const colorAttr = geometry.attributes.color;

    // 封面颜色只设置一次（封面固定时大幅省性能）；无封面时每帧用渐变 + 能量
    let coverColorApplied = false;
    const applyCoverColors = () => {
      if (!hasCoverRef.current || shapeRef.current !== 'cover') return false;
      for (let i = 0; i < COUNT; i++) {
        const u = origUV[i * 2];
        const v = origUV[i * 2 + 1];
        const s = sampleCover(u, v);
        const boost = 1.35;
        const minBright = 0.28;   // 暗部保底，让深色封面也清晰可见
        colorAttr.array[i * 3]     = Math.max(s[0] * boost, minBright * (0.6 + s[0]));
        colorAttr.array[i * 3 + 1] = Math.max(s[1] * boost, minBright * (0.6 + s[1]));
        colorAttr.array[i * 3 + 2] = Math.max(s[2] * boost, minBright * (0.6 + s[2]));
      }
      colorAttr.needsUpdate = true;
      return true;
    };

    let firstFrame = true;
    let bassAttack = 0;
    let bassRelease = 0;
    let midSmooth = 0;
    let trebleSmooth = 0;

    // 液态金属热点坐标
    const hotSpots = [
      { u: 0.30, v: 0.30, k: 6 },
      { u: 0.70, v: 0.60, k: 6 },
      { u: 0.50, v: 0.18, k: 8 },
      { u: 0.20, v: 0.75, k: 7 },
    ];

    const animate = () => {
      const { data, hasData } = getSpectrumBars(64);

      // 频段分组
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

      const bassPulse = Math.max(0, bassAttack - bassRelease);
      const time = Date.now() * 0.001;
      const breath = 1 + Math.sin(time * 0.6) * 0.020 + bassAttack * 0.04 + bassPulse * 0.10;
      const hasCover = hasCoverRef.current;
      const accentRGB = hexToRGB(accentRef.current || '#4FC3F7');

      const currentShape = shapeRef.current;
      const g = gestureRef.current;

      if (currentShape === 'cover') {
        // ===== 封面模式：压平 Z 起伏，避免侧面看到穹顶膨胀 =====
        const MAX_Z_RATIO = 0.035;
        const zAmp = planeSize * MAX_Z_RATIO;

        // 封面就绪后应用一次颜色
        if (hasCover && !coverColorApplied) {
          coverColorApplied = applyCoverColors();
        } else if (!hasCover) {
          coverColorApplied = false;
        }
        const needColorUpdate = !hasCover;

        // 风吹参数：极轻柔，不盖过音频
        const windSpeed = 2.0;
        const windFreqX = 3.0;
        const windFreqY = 2.0;
        const windGust = 1.0 + Math.sin(time * 0.7) * 0.10 + bassAttack * 0.15;

        for (let i = 0; i < COUNT; i++) {
          const u = origUV[i * 2];
          const v = origUV[i * 2 + 1];
          const dc = distFromCenter[i];

          // 音频响应：中心 = bass，向外依次 mid、treble
          const bFreq = Math.max(0, 1 - dc * 3.5);
          const mFreq = Math.max(0, 1 - Math.abs(dc - 0.50) * 3.6);
          const tFreq = Math.max(0, 1 - Math.abs(dc - 0.85) * 5.0);
          const bassSharp = Math.pow(bassAttack, 1.4);
          let localEnergy = (bassSharp + bassPulse * 1.6) * bFreq * 1.1
                          + midSmooth * mFreq * 0.85
                          + trebleSmooth * tFreq * 0.70;

          // 风吹：小幅度
          const wave1 = Math.sin(u * windFreqX * Math.PI + time * windSpeed) * 0.10;
          const wave2 = Math.sin(v * windFreqY * Math.PI + time * windSpeed * 0.7) * 0.07;
          const ripple = Math.sin((u + v) * 10 + time * 3.0) * 0.02;
          const swirl = Math.sin(u * 6 + v * 4 + time * 1.4) * 0.03;
          const windZ = (wave1 + wave2 + ripple + swirl) * windGust;

          // 音频能量叠加到 Z：幅度收敛，侧面看仍是平面
          const falloff = Math.pow(1 - dc, 0.75);
          const audioZ = localEnergy * 0.55 * falloff * breath;

          posAttr.array[i * 3 + 2] = (windZ + audioZ) * zAmp;

          if (needColorUpdate) {
            const windGlow = Math.abs(windZ) * 0.4;
            const bassGlow = bFreq * (bassAttack + bassPulse * 1.5) * 1.4;
            const midGlow = mFreq * midSmooth * 0.9;
            const trebleGlow = tFreq * trebleSmooth * 1.1;
            const intensity = 0.22 + localEnergy * 1.1 + windGlow;
            const outFactor = 1 - dc * 0.5;
            colorAttr.array[i * 3]     = Math.min(1, accentRGB.r * intensity * outFactor + bassGlow * 0.45 + midGlow * 0.2 + trebleGlow * 0.15);
            colorAttr.array[i * 3 + 1] = Math.min(1, accentRGB.g * intensity * outFactor + bassGlow * 0.45 + midGlow * 0.25 + trebleGlow * 0.15);
            colorAttr.array[i * 3 + 2] = Math.min(1, accentRGB.b * intensity * outFactor + bassGlow * 0.45 + midGlow * 0.25 + trebleGlow * 0.45 + windGlow * 0.3);
          }
        }
        posAttr.needsUpdate = true;
        if (needColorUpdate) colorAttr.needsUpdate = true;

        // 微俯仰 + 随风轻微摇摆
        points.rotation.y = g.rotation;
        points.rotation.x = -0.12 + Math.sin(time * 0.6) * 0.03;
        points.rotation.z = Math.cos(time * 0.45) * 0.015;
        const sc = breath;
        points.scale.set(sc, sc, 1);
      } else {
        // ===== 液态金属模式：高频球面波纹 =====
        // 封面亮度决定基础半径凹凸
        const baseR = sphereR * 0.88;

        for (let i = 0; i < COUNT; i++) {
          const u = origUV[i * 2];
          const v = origUV[i * 2 + 1];
          const nx = normals[i * 3];
          const ny = normals[i * 3 + 1];
          const nz = normals[i * 3 + 2];

          const light = hasCover ? sampleCoverLight(u, v) : 0.5;
          let r = baseR * (0.82 + light * 0.36);

          // 高频震动波纹（时间频率提高，让金属表面持续颤动）
          r += midSmooth    * Math.sin(u * 90 + time * 9)  * sphereR * 0.05;
          r += trebleSmooth * Math.sin(v * 110 - time * 11) * sphereR * 0.035;
          r += midSmooth    * Math.cos((u + v) * 130 + time * 10) * sphereR * 0.025;
          r += trebleSmooth * Math.sin((u - v) * 150 + time * 12) * sphereR * 0.020;

          // 鼓点热点：高频冲击
          let hotSum = 0;
          for (const h of hotSpots) {
            hotSum += Math.exp(-Math.pow((u - h.u) * h.k, 2) - Math.pow((v - h.v) * h.k, 2));
          }
          r += bassPulse * hotSum * sphereR * 0.32;
          // bass 整体膨胀
          r += bassAttack * sphereR * 0.06 * (0.6 + light * 0.4);

          posAttr.array[i * 3] = nx * r;
          posAttr.array[i * 3 + 1] = ny * r;
          posAttr.array[i * 3 + 2] = nz * r;

          // 颜色：封面亮度 + 主题色 + 音频能量
          const energy = bassAttack * 1.2 + midSmooth * 0.8 + trebleSmooth * 0.9 + bassPulse * 1.5;
          const metal = 0.55 + light * 0.35 + energy * 0.7;
          const shine = Math.pow(Math.abs(Math.sin(u * 90 + time * 9)), 3) * 0.25;
          colorAttr.array[i * 3]     = Math.min(1, accentRGB.r * metal + shine + bassPulse * 0.3);
          colorAttr.array[i * 3 + 1] = Math.min(1, accentRGB.g * metal + shine + bassPulse * 0.3);
          colorAttr.array[i * 3 + 2] = Math.min(1, accentRGB.b * metal + shine + bassPulse * 0.45 + trebleSmooth * 0.2);
        }
        posAttr.needsUpdate = true;
        colorAttr.needsUpdate = true;

        // 液态金属自动缓慢旋转 + 手势旋转
        points.rotation.y = time * 0.08 + g.rotation;
        points.rotation.x = Math.sin(time * 0.25) * 0.10;
        points.rotation.z = Math.cos(time * 0.18) * 0.06;
        const sc = 0.96 + bassAttack * 0.04 + bassPulse * 0.05;
        points.scale.set(sc, sc, sc);
      }

      // ===== 电影镜头：仅手势驱动（无自动旋转）=====
      g.zoom += (g.targetZoom - g.zoom) * 0.18;
      g.rotation += (g.targetRotation - g.rotation) * 0.18;
      const clampedZoom = Math.max(0.4, Math.min(3.0, g.zoom));
      camera.position.z = cameraZ / clampedZoom;
      camera.position.x = 0;
      camera.position.y = 0;
      camera.lookAt(0, 0, 0);

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
    const ROTATE_SENSITIVITY = 0.006;
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
    };
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
      scene.remove(points);
      geometry.dispose();
      if (material) material.dispose();
      buildGeometry();
      coverColorApplied = false;
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
      if (material) material.dispose();
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
