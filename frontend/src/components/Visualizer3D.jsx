import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { getSpectrumBars } from '../audio/engine';

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

// 3D 封面粒子画：2 万粒子在 X-Y 平面排满封面图像（每粒子颜色 = 封面对应像素）
// 电影镜头：用户双指捏合缩放 + 双指划拉旋转（手势驱动）
// 风吹动画：粒子 Z 方向像旗帜被风吹起那样起伏，阵风强度随时间起伏
// 音频响应：中心 = 低频（bass），向外依次 mid / treble，叠加到风吹位移上
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

  // 手势状态（双指缩放 + 旋转）
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
  });

  // 加载封面并采样为 ImageData
  useEffect(() => {
    if (!cover) { imageDataRef.current = null; hasCoverRef.current = false; return; }
    let cancelled = false;
    const img = new Image();
    // 不设 crossOrigin：QQ 音乐封面 CDN 无 CORS 头，设了反而加载失败
    img.onload = () => {
      if (cancelled) return;
      try {
        const SIZE = GRID;
        const c = document.createElement('canvas');
        c.width = SIZE; c.height = SIZE;
        const cx = c.getContext('2d');
        // 居中裁剪为正方形后绘制
        const iw = img.width, ih = img.height;
        const s = Math.min(iw, ih);
        const sx = (iw - s) / 2, sy = (ih - s) / 2;
        cx.drawImage(img, sx, sy, s, s, 0, 0, SIZE, SIZE);
        imageDataRef.current = cx.getImageData(0, 0, SIZE, SIZE).data;
        hasCoverRef.current = true;
      } catch (e) {
        // canvas 被跨域图片污染，无法读取像素 → 退化为渐变色模式
        imageDataRef.current = null;
        hasCoverRef.current = false;
      }
    };
    img.onerror = () => { imageDataRef.current = null; hasCoverRef.current = false; };
    img.src = cover;
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
    const MAX_Z_RATIO = 0.34;    // Z 起伏最大占可见半边比例（增强飘动）

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

    const buildGrid = () => {
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
    };
    buildGrid();

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: planeSize * 2 / GRID * 0.92,   // 粒子稍大，铺满无间隙
      vertexColors: true,
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
      sizeAttenuation: true,
      blending: THREE.NormalBlending, // 正常混合，封面颜色真实还原
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
    let bassSmooth = 0;
    let midSmooth = 0;
    let trebleSmooth = 0;

    const animate = () => {
      const { data, hasData } = getSpectrumBars(64);

      // 频段分组：bass 低频居中，向外依次 mid、treble
      let bass = 0, mid = 0, treble = 0;
      if (hasData) {
        for (let i = 0; i < 8; i++) bass += data[i];
        bass /= 8;
        for (let i = 8; i < 32; i++) mid += data[i];
        mid /= 24;
        for (let i = 32; i < 64; i++) treble += data[i];
        treble /= 32;
      } else {
        // 待机动画：明显律动的能量起伏，让风吹效果始终可见
        const t = Date.now() * 0.001;
        bass = 0.20 + Math.sin(t * 0.60) * 0.10 + Math.sin(t * 1.25) * 0.06;
        mid = 0.14 + Math.sin(t * 0.90 + 1) * 0.07;
        treble = 0.10 + Math.sin(t * 1.20 + 2) * 0.05;
      }
      bassSmooth += (bass - bassSmooth) * 0.18;
      midSmooth += (mid - midSmooth) * 0.18;
      trebleSmooth += (treble - trebleSmooth) * 0.18;

      // 整体呼吸缩放：基础呼吸 + bass 增强
      const time = Date.now() * 0.001;
      const breath = 1 + Math.sin(time * 0.6) * 0.025 + bassSmooth * 0.10;
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
      // 风吹参数：进一步增强，风从左上吹向右下，强度随时间起伏
      const windSpeed = 2.4;
      const windFreqX = 3.6;   // X 方向波纹频率
      const windFreqY = 2.4;   // Y 方向波纹频率
      const windGust = 1.0 + Math.sin(time * 0.75) * 0.45 + bassSmooth * 1.1; // 阵风强度

      // 主题色解析
      const accentRGB = hexToRGB(accentRef.current || '#4FC3F7');

      for (let i = 0; i < COUNT; i++) {
        const u = origUV[i * 2];
        const v = origUV[i * 2 + 1];
        const dc = distFromCenter[i]; // 0 中心 ~ 1 边角

        // 边缘衰减：中心 1，边缘趋近 0
        const falloff = Math.pow(1 - dc, 1.4);

        // 音频响应：中心 = bass（低频），向外依次 mid、treble（高频）
        const bFreq = Math.max(0, 1 - dc * 1.8);
        const mFreq = Math.max(0, 1 - Math.abs(dc - 0.45) * 2.5);
        const tFreq = Math.max(0, 1 - Math.abs(dc - 0.85) * 3);
        let localEnergy = bassSmooth * bFreq + midSmooth * mFreq * 0.8 + trebleSmooth * tFreq * 0.6;

        // 风吹效果：粒子 Z 方向像旗帜被风吹起那样起伏
        const wave1 = Math.sin(u * windFreqX * Math.PI + time * windSpeed) * 0.6;
        const wave2 = Math.sin(v * windFreqY * Math.PI + time * windSpeed * 0.75) * 0.4;
        const ripple = Math.sin((u + v) * 10 + time * 3.2) * 0.12;
        const swirl = Math.sin(u * 6 + v * 4 + time * 1.5) * 0.15; // 旋转风涡
        const windZ = (wave1 + wave2 + ripple + swirl) * windGust * falloff;

        // 音频能量叠加到 Z（中心低频推高）
        const audioZ = localEnergy * 0.8 * falloff * breath;

        posAttr.array[i * 3 + 2] = (windZ + audioZ) * zAmp;

        if (needColorUpdate) {
          // 无封面时：以主题色为基础，中心亮、外圈暗，随风和音频增亮
          const windGlow = Math.abs(windZ) * 0.5;
          const intensity = 0.25 + localEnergy * 0.7 + windGlow;
          const outFactor = 1 - dc * 0.6; // 中心亮，边缘暗
          colorAttr.array[i * 3]     = Math.min(1, accentRGB.r * intensity * outFactor + localEnergy * 0.3);
          colorAttr.array[i * 3 + 1] = Math.min(1, accentRGB.g * intensity * outFactor + localEnergy * 0.3);
          colorAttr.array[i * 3 + 2] = Math.min(1, accentRGB.b * intensity * outFactor + localEnergy * 0.3 + windGlow * 0.3);
        }
      }
      posAttr.needsUpdate = true;
      if (needColorUpdate) colorAttr.needsUpdate = true;

      // ===== 电影镜头：仅手势驱动（无自动旋转）=====
      const g = gestureRef.current;
      g.zoom += (g.targetZoom - g.zoom) * 0.18;
      g.rotation += (g.targetRotation - g.rotation) * 0.18;
      // 缩放限制 0.4 ~ 3.0
      const clampedZoom = Math.max(0.4, Math.min(3.0, g.zoom));
      camera.position.z = cameraZ / clampedZoom;
      // 仅用户手势旋转
      points.rotation.y = g.rotation;
      // 微俯仰 + 随风轻微摇摆
      points.rotation.x = -0.18 + Math.sin(time * 0.6) * 0.04;
      points.rotation.z = Math.cos(time * 0.45) * 0.02;
      camera.position.x = 0;
      camera.position.y = 0;
      camera.lookAt(0, 0, 0);

      // 整体呼吸缩放（基础呼吸 + bass 增强）
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

    // ===== 手势控制：双指缩放 + 旋转 =====
    const dom = renderer.domElement;
    const dist = (t1, t2) => Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
    const angle = (t1, t2) => Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX);
    const onTouchStart = (e) => {
      if (e.touches.length === 2) {
        const g = gestureRef.current;
        g.pinching = true;
        g.startDist = dist(e.touches[0], e.touches[1]);
        g.startAngle = angle(e.touches[0], e.touches[1]);
        g.startZoom = g.targetZoom;
        g.startRot = g.targetRotation;
      }
    };
    const onTouchMove = (e) => {
      const g = gestureRef.current;
      if (!g.pinching || e.touches.length !== 2) return;
      e.preventDefault();
      const d = dist(e.touches[0], e.touches[1]);
      const a = angle(e.touches[0], e.touches[1]);
      // 缩放 = 当前距离 / 起始距离
      const scale = d / Math.max(1, g.startDist);
      g.targetZoom = Math.max(0.4, Math.min(3.0, g.startZoom * scale));
      // 旋转 = 当前角度 - 起始角度
      g.targetRotation = g.startRot + (a - g.startAngle);
    };
    const onTouchEnd = (e) => {
      if (e.touches.length < 2) gestureRef.current.pinching = false;
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
      material.size = planeSize * 2 / GRID * 0.92;
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
