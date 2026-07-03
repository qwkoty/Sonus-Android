import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { getSpectrumBars } from '../audio/engine';

const GRID = 142;             // 142x142 = 20164 ≈ 2 万粒子
const FOV = 55;

// 3D 封面粒子画：2 万粒子在 X-Y 平面排满封面图像（每粒子颜色 = 封面对应像素）
// 电影镜头：相机缓慢推拉 + 轨道旋转 + 微俯仰，营造电影感
// 呼吸动画：整体 scale 随时间正弦呼吸
// 待机动画：无音频时粒子做径向涟漪 + 波浪起伏
// 音频响应：中心 = 低频（bass），向外依次 mid / treble，频率随距中心距离递增
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
    const MAX_Z_RATIO = 0.22;    // Z 起伏最大占可见半边比例（仅中心，边缘衰减为 0）

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
        // 待机动画：缓慢呼吸的能量起伏
        const t = Date.now() * 0.001;
        bass = 0.10 + Math.sin(t * 0.7) * 0.05;
        mid = 0.06 + Math.sin(t * 1.1 + 1) * 0.03;
        treble = 0.04 + Math.sin(t * 1.5 + 2) * 0.02;
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
      for (let i = 0; i < COUNT; i++) {
        const u = origUV[i * 2];
        const v = origUV[i * 2 + 1];
        const dc = distFromCenter[i]; // 0 中心 ~ 1 边角

        // 边缘衰减：中心 1，边缘趋近 0 —— 保证边缘粒子不动，撑满不溢出
        const falloff = Math.pow(1 - dc, 1.6);

        // 音频响应：中心 = bass（低频），向外依次 mid、treble（高频）
        // 用三个钟形分布叠加，分别覆盖中心、中圈、外圈
        const bFreq = Math.max(0, 1 - dc * 1.8);                       // 中心强
        const mFreq = Math.max(0, 1 - Math.abs(dc - 0.45) * 2.5);      // 中圈强
        const tFreq = Math.max(0, 1 - Math.abs(dc - 0.85) * 3);        // 外圈强
        let localEnergy = bassSmooth * bFreq + midSmooth * mFreq * 0.8 + trebleSmooth * tFreq * 0.6;

        // 独立呼吸相位，保证频谱为 0 也起伏（待机动画）
        const phase = u * 21.5 + v * 17.3 + dc * 9;
        const baseBreathe = (Math.sin(time * 1.6 + phase) * 0.5 + 0.5) * 0.18;
        localEnergy = Math.max(localEnergy, baseBreathe);

        // 径向涟漪：从中心向外扩散的波纹（待机时也持续）
        const ripple = Math.sin(dc * 14 - time * 2.2) * 0.10 * (0.4 + midSmooth);
        const z = (localEnergy * 0.9 + ripple) * zAmp * falloff * breath;
        posAttr.array[i * 3 + 2] = z;

        if (needColorUpdate) {
          // 无封面时：中心冷蓝 → 外圈紫红，随能量增亮
          const intensity = 0.3 + localEnergy * 0.8;
          const r = (0.25 + dc * 0.55) * intensity;
          const g = (0.45 + (1 - dc) * 0.25) * intensity;
          const b = (0.85 - dc * 0.35) * intensity;
          colorAttr.array[i * 3]     = r;
          colorAttr.array[i * 3 + 1] = g;
          colorAttr.array[i * 3 + 2] = b;
        }
      }
      posAttr.needsUpdate = true;
      if (needColorUpdate) colorAttr.needsUpdate = true;

      // ===== 电影镜头：缓慢推拉 + 轨道旋转 + 微俯仰 =====
      // 推拉：相机沿 Z 轴在 cameraZ * 0.85 ~ cameraZ * 1.15 之间缓慢移动
      const zoomPhase = Math.sin(time * 0.18) * 0.5 + 0.5;   // 0..1
      const zoom = cameraZ * (0.88 + zoomPhase * 0.20);
      // 轨道旋转：相机绕 Y 轴缓慢公转（幅度小，避免边缘溢出）
      const orbitAngle = time * 0.12;
      const orbitR = planeSize * 0.18;
      camera.position.x = Math.sin(orbitAngle) * orbitR;
      camera.position.y = Math.sin(time * 0.22) * planeSize * 0.10;
      camera.position.z = zoom;
      // 微俯仰
      camera.lookAt(0, 0, 0);

      // 粒子整体缓慢摇摆增强 3D 感
      points.rotation.y = Math.sin(time * 0.25) * 0.28;
      points.rotation.x = -0.30 + Math.sin(time * 0.35) * 0.07;
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
