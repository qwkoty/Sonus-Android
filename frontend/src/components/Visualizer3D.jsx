import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { getSpectrumBars } from '../audio/engine';

const GRID = 140;          // 粒子网格边数（140x140 ≈ 2万粒子）
const FOV = 60;

// 3D 封面粒子画：粒子在 X-Y 平面排成封面图像（每粒子颜色 = 封面对应像素）
// Z 轴随频谱起伏成 3D 波浪，整体随 bass 呼吸 + 缓慢摇摆旋转
// 完全自适应容器尺寸，永不超界
export default function Visualizer3D({ accent = '#4FC3F7', cover = '' }) {
  const containerRef = useRef(null);
  const accentRef = useRef(accent);
  const coverRef = useRef(cover);
  const imageDataRef = useRef(null);  // 封面像素 RGBA
  const hasCoverRef = useRef(false);

  useEffect(() => { accentRef.current = accent; }, [accent]);
  useEffect(() => { coverRef.current = cover; }, [cover]);

  // 加载封面并采样为 ImageData
  useEffect(() => {
    if (!cover) { imageDataRef.current = null; hasCoverRef.current = false; return; }
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
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

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = container.offsetWidth;
    let H = container.offsetHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV, W / H, 0.1, 3000);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(dpr);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    container.appendChild(renderer.domElement);

    // ---- 自适应：根据可视尺寸反推画面物理尺寸，保证 Z 起伏后不超界 ----
    const MAX_Z = 0.32;      // Z 位移最大占画面半宽的比例
    const SAFETY = 0.86;

    let planeSize, cameraZ;

    const computeLayout = () => {
      W = container.offsetWidth;
      H = container.offsetHeight;
      const aspect = W / H;
      const minDim = Math.min(W, H);
      // 相机距离设为短边的 2.2 倍
      cameraZ = minDim * 2.2;
      const halfFovRad = (FOV / 2) * Math.PI / 180;
      const visibleHalf = cameraZ * Math.tan(halfFovRad);
      // planeSize（半边）必须让 (planeSize + Z_max) <= visibleHalf * SAFETY
      planeSize = (visibleHalf * SAFETY) / (1 + MAX_Z);
      camera.aspect = aspect;
      camera.position.z = cameraZ;
      camera.updateProjectionMatrix();
    };
    computeLayout();

    // ---- 粒子网格：X-Y 平面排满 planeSize x planeSize 正方形 ----
    const COUNT = GRID * GRID;
    const positions = new Float32Array(COUNT * 3);
    const colors = new Float32Array(COUNT * 3);
    const origXY = new Float32Array(COUNT * 2);     // 原始归一化 uv (0..1)
    const barIdxMap = new Int32Array(COUNT);

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
          origXY[idx * 2] = gx / (GRID - 1);
          origXY[idx * 2 + 1] = gy / (GRID - 1);
          // 初始颜色（降级用主色渐变）
          colors[idx * 3] = 0.3;
          colors[idx * 3 + 1] = 0.6;
          colors[idx * 3 + 2] = 1.0;
          // 频段索引：按 x 位置分配，横向形成频谱
          barIdxMap[idx] = Math.floor((gx / GRID) * 64);
          idx++;
        }
      }
    };
    buildGrid();

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: planeSize * 2 / GRID * 1.1, // 粒子略大于网格间距，无缝拼接
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      sizeAttenuation: true,
    });

    const points = new THREE.Points(geometry, material);
    points.rotation.x = -0.18; // 略微俯视
    scene.add(points);

    let raf;
    const posAttr = geometry.attributes.position;
    const colorAttr = geometry.attributes.color;

    // 从封面采样某 uv 处 RGB
    const sampleCover = (u, v) => {
      const d = imageDataRef.current;
      if (!d) return null;
      const px = Math.min(GRID - 1, Math.max(0, Math.floor(u * GRID)));
      const py = Math.min(GRID - 1, Math.max(0, Math.floor(v * GRID)));
      const i = (py * GRID + px) * 4;
      return [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, d[i + 3] / 255 / 255];
    };

    const animate = () => {
      const { data, hasData } = getSpectrumBars(64);

      let bass = 0;
      if (hasData) {
        for (let i = 0; i < 8; i++) bass += data[i];
        bass /= 8;
      } else {
        bass = 0.08 + Math.sin(Date.now() * 0.001) * 0.04;
      }
      const breathe = 1 + Math.min(bass, 1) * 0.08;
      const zAmp = planeSize * MAX_Z * (0.5 + Math.min(bass, 1) * 0.7);

      const hasCover = hasCoverRef.current;
      const time = Date.now() * 0.001;

      for (let i = 0; i < COUNT; i++) {
        const u = origXY[i * 2];
        const v = origXY[i * 2 + 1];
        const bi = barIdxMap[i];
        const value = hasData
          ? data[bi]
          : 0.08 + Math.sin(time * 2 + i * 0.01) * 0.05;

        // Z 起伏：频谱值 + 空间波浪 + 时间流动
        const wave = Math.sin(u * 8 + time * 2) * 0.15 + Math.cos(v * 6 - time * 1.5) * 0.1;
        const z = (value * 0.85 + wave * 0.15) * zAmp * breathe;
        posAttr.array[i * 3 + 2] = z;

        // 颜色：封面像素 / 降级主色
        if (hasCover) {
          const s = sampleCover(u, v);
          const boost = 0.7 + value * 0.6; // 高频段更亮
          colorAttr.array[i * 3]     = Math.min(1, s[0] * boost);
          colorAttr.array[i * 3 + 1] = Math.min(1, s[1] * boost);
          colorAttr.array[i * 3 + 2] = Math.min(1, s[2] * boost);
        } else {
          const intensity = 0.4 + value * 0.6;
          colorAttr.array[i * 3]     = 0.3 * intensity;
          colorAttr.array[i * 3 + 1] = 0.6 * intensity;
          colorAttr.array[i * 3 + 2] = 1.0 * intensity;
        }
      }

      posAttr.needsUpdate = true;
      colorAttr.needsUpdate = true;

      // 缓慢摇摆旋转，增加 3D 立体感
      points.rotation.y = Math.sin(time * 0.3) * 0.35;
      points.rotation.x = -0.18 + Math.sin(time * 0.4) * 0.08;
      const sc = breathe;
      points.scale.set(sc, sc, 1);

      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    animate();

    const handleResize = () => {
      computeLayout();
      buildGrid();
      posAttr.needsUpdate = true;
      material.size = planeSize * 2 / GRID * 1.1;
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
