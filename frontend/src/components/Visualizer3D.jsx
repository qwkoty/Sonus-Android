import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { getSpectrumBars } from '../audio/engine';

const GRID = 140;          // 粒子网格边数（140x140 ≈ 2万粒子）
const FOV = 60;

// 3D 封面粒子画：粒子在 X-Y 平面排成封面图像（每粒子颜色 = 封面对应像素）
// Z 轴随整体音频能量一起起伏（所有粒子同步跳动），缓慢摇摆旋转
// 完全自适应容器尺寸，永不超界
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
    const distFromCenter = new Float32Array(COUNT);  // 距中心归一化距离，用于环形波纹

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
          origXY[idx * 2] = u;
          origXY[idx * 2 + 1] = v;
          // 距中心距离（0 中心 ~ 1 边角）
          const dx = u - 0.5, dy = v - 0.5;
          distFromCenter[idx] = Math.min(1, Math.sqrt(dx * dx + dy * dy) * 2);
          colors[idx * 3] = 0.3;
          colors[idx * 3 + 1] = 0.6;
          colors[idx * 3 + 2] = 1.0;
          idx++;
        }
      }
    };
    buildGrid();

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: planeSize * 2 / GRID * 0.7, // 粒子小于网格间距，分散有间隙
      vertexColors: true,
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending, // 加色混合，封面颜色更亮更通透
    });

    const points = new THREE.Points(geometry, material);
    points.rotation.x = -0.18;
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

    // 首帧渲染后立即通知 ready，避免首切延迟空屏
    let firstFrame = true;

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
        bass = 0.08 + Math.sin(Date.now() * 0.001) * 0.04;
        mid = 0.05;
        treble = 0.03;
      }
      const breathe = 1 + Math.min(bass, 1) * 0.08;
      const zAmp = planeSize * MAX_Z * 1.4; // 增大振幅，起伏更明显
      const time = Date.now() * 0.001;
      const hasCover = hasCoverRef.current;

      for (let i = 0; i < COUNT; i++) {
        const u = origXY[i * 2];
        const v = origXY[i * 2 + 1];
        const dc = distFromCenter[i]; // 0 中心 ~ 1 边角

        // 距离衰减减弱：中心 1，边缘 0.5，让边缘也明显跳动
        const falloff = Math.pow(1 - dc, 1.0) * 0.5 + 0.5;
        // 频段分配：中心 bass，中圈 mid，外圈 treble
        const bFreq = Math.max(0, 1 - dc * 1.8);
        const mFreq = Math.max(0, 1 - Math.abs(dc - 0.4) * 2.5);
        const tFreq = Math.max(0, 1 - Math.abs(dc - 0.85) * 3);
        let localEnergy = bass * bFreq + mid * mFreq * 0.7 + treble * tFreq * 0.5;

        // 基础呼吸波动：每个粒子独立相位，即使频谱为 0 也起伏，保证都会跳
        // 用 u+v 作为粒子标识，相位分散，避免大片同步
        const phase = u * 21.5 + v * 17.3 + dc * 9;
        const baseBreathe = (Math.sin(time * 1.8 + phase) * 0.5 + 0.5) * 0.22;
        localEnergy = Math.max(localEnergy, baseBreathe);

        // 外扩波纹（增加流动感）
        const ripple = Math.sin(dc * 12 - time * 2.5) * 0.08 * (0.3 + mid);

        const z = (localEnergy * 0.85 + ripple) * zAmp * falloff * breathe;
        posAttr.array[i * 3 + 2] = z;

        // 颜色：封面像素，提亮 + 能量增强，保证清晰可见
        if (hasCover) {
          const s = sampleCover(u, v);
          const boost = 0.75 + localEnergy * 0.6;
          colorAttr.array[i * 3]     = Math.min(1, s[0] * boost);
          colorAttr.array[i * 3 + 1] = Math.min(1, s[1] * boost);
          colorAttr.array[i * 3 + 2] = Math.min(1, s[2] * boost);
        } else {
          const intensity = 0.3 + localEnergy * 0.7;
          colorAttr.array[i * 3]     = 0.3 * intensity;
          colorAttr.array[i * 3 + 1] = 0.6 * intensity;
          colorAttr.array[i * 3 + 2] = 1.0 * intensity;
        }
      }

      posAttr.needsUpdate = true;
      colorAttr.needsUpdate = true;

      // 加大倾斜角增强 3D 纵深感 + 缓慢摇摆
      points.rotation.y = Math.sin(time * 0.25) * 0.4;
      points.rotation.x = -0.42 + Math.sin(time * 0.35) * 0.08;
      const sc = breathe;
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
