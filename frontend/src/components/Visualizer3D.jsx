import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { getSpectrumBars } from '../audio/engine';

const PARTICLE_COUNT = 6000;
const NUM_BARS = 64;
const FOV = 75;

// hex → 归一化 RGB
const hexToRgb = (hex) => {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b];
};

// 3D 封面粒子星球：粒子分布在球面，颜色采样自歌曲封面图
// 整体随 bass 呼吸，每个粒子按所属频段沿法向位移，自动旋转
// 完全自适应容器尺寸：根据可视半径反推安全粒子半径，永不超界
export default function Visualizer3D({ accent = '#4FC3F7', cover = '' }) {
  const containerRef = useRef(null);
  const accentRef = useRef(accent);
  const coverRef = useRef(cover);
  // 封面像素数据缓存 + 加载状态
  const imageDataRef = useRef(null);
  useEffect(() => { accentRef.current = accent; }, [accent]);
  useEffect(() => { coverRef.current = cover; }, [cover]);

  // 加载封面图并采样为 ImageData（CORS 失败则降级为 null，用主色）
  useEffect(() => {
    if (!cover) { imageDataRef.current = null; return; }
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      try {
        const SIZE = 128;
        const c = document.createElement('canvas');
        c.width = SIZE; c.height = SIZE;
        const cx = c.getContext('2d');
        cx.drawImage(img, 0, 0, SIZE, SIZE);
        imageDataRef.current = cx.getImageData(0, 0, SIZE, SIZE).data;
      } catch (e) {
        // CORS 拒绝，降级
        imageDataRef.current = null;
      }
    };
    img.onerror = () => { imageDataRef.current = null; };
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
    const camera = new THREE.PerspectiveCamera(FOV, W / H, 0.1, 2000);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(dpr);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    container.appendChild(renderer.domElement);

    // ---- 自适应核心：反推安全粒子半径 ----
    const MAX_DISPLACEMENT = 0.42;
    const MAX_BREATHE = 0.18;
    const SAFETY = 0.82;

    let baseRadius, cameraZ;

    const computeLayout = () => {
      W = container.offsetWidth;
      H = container.offsetHeight;
      const aspect = W / H;
      const minDim = Math.min(W, H);
      cameraZ = minDim * 1.8;
      const halfFovRad = (FOV / 2) * Math.PI / 180;
      const visibleRadius = cameraZ * Math.tan(halfFovRad);
      const maxMultiplier = (1 + MAX_DISPLACEMENT) * (1 + MAX_BREATHE);
      baseRadius = (visibleRadius * SAFETY) / maxMultiplier;
      camera.aspect = aspect;
      camera.position.z = cameraZ;
      camera.updateProjectionMatrix();
    };
    computeLayout();

    // ---- Fibonacci 球面分布 + 记录 UV 用于采样封面 ----
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const original = new Float32Array(PARTICLE_COUNT * 3);
    const colors = new Float32Array(PARTICLE_COUNT * 3);
    const barIdxMap = new Int32Array(PARTICLE_COUNT);
    // 每个粒子的封面采样 uv（0~1）与基础色（降级用）
    const uvU = new Float32Array(PARTICLE_COUNT);
    const uvV = new Float32Array(PARTICLE_COUNT);

    const buildSphere = () => {
      const golden = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const y = 1 - (i / (PARTICLE_COUNT - 1)) * 2;
        const r = Math.sqrt(1 - y * y);
        const theta = golden * i;
        const x = Math.cos(theta) * r;
        const z = Math.sin(theta) * r;

        original[i * 3] = x * baseRadius;
        original[i * 3 + 1] = y * baseRadius;
        original[i * 3 + 2] = z * baseRadius;
        positions[i * 3] = original[i * 3];
        positions[i * 3 + 1] = original[i * 3 + 1];
        positions[i * 3 + 2] = original[i * 3 + 2];

        // 球面 UV（等距圆柱投影）
        const phi = Math.atan2(z, x); // -PI..PI
        uvU[i] = (phi + Math.PI) / (Math.PI * 2);
        uvV[i] = (y + 1) / 2;

        // 降级基础色（主色派生）
        colors[i * 3] = 0.3;
        colors[i * 3 + 1] = 0.6;
        colors[i * 3 + 2] = 1.0;

        barIdxMap[i] = Math.floor(Math.random() * NUM_BARS);
      }
    };
    buildSphere();

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 2.6,
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });

    const points = new THREE.Points(geometry, material);
    scene.add(points);

    // 内层光晕球（跟随主色）
    const haloGeo = new THREE.SphereGeometry(1, 32, 32);
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0x1a2a4a,
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
    });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.scale.setScalar(baseRadius * 0.5);
    scene.add(halo);

    let raf;
    const posAttr = geometry.attributes.position;
    const colorAttr = geometry.attributes.color;

    // 从封面 ImageData 采样某 UV 处的 RGB
    const sampleCover = (u, v) => {
      const d = imageDataRef.current;
      if (!d) return null;
      const SIZE = 128;
      const px = Math.min(SIZE - 1, Math.max(0, Math.floor(u * SIZE)));
      const py = Math.min(SIZE - 1, Math.max(0, Math.floor((1 - v) * SIZE)));
      const idx = (py * SIZE + px) * 4;
      return [d[idx] / 255, d[idx + 1] / 255, d[idx + 2] / 255];
    };

    const animate = () => {
      const { data, hasData } = getSpectrumBars(NUM_BARS);

      let bass = 0;
      if (hasData) {
        for (let i = 0; i < 8; i++) bass += data[i];
        bass /= 8;
      } else {
        bass = 0.08 + Math.sin(Date.now() * 0.001) * 0.04;
      }
      const breathe = 1 + Math.min(bass, 1) * MAX_BREATHE;

      // 主色降级配色
      const [ar, ag, ab] = hexToRgb(accentRef.current);
      const hasCover = !!imageDataRef.current;

      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const bi = barIdxMap[i];
        const value = hasData
          ? data[bi]
          : 0.08 + Math.sin(Date.now() * 0.002 + i * 0.012) * 0.05;
        const disp = 1 + Math.min(value, 1) * MAX_DISPLACEMENT;

        posAttr.array[i * 3] = original[i * 3] * disp * breathe;
        posAttr.array[i * 3 + 1] = original[i * 3 + 1] * disp * breathe;
        posAttr.array[i * 3 + 2] = original[i * 3 + 2] * disp * breathe;

        // 颜色：优先采样封面，否则用主色派生
        const intensity = 0.45 + value * 0.55;
        let cr, cg, cb;
        if (hasCover) {
          const s = sampleCover(uvU[i], uvV[i]);
          cr = s[0]; cg = s[1]; cb = s[2];
        } else {
          const t = (original[i * 3 + 1] / baseRadius + 1) / 2;
          cr = ar * 0.4 + t * (ar * 0.5 + 0.5 - ar * 0.4);
          cg = ag * 0.4 + t * (ag * 0.5 + 0.5 - ag * 0.4);
          cb = ab * 0.4 + t * (ab * 0.5 + 0.5 - ab * 0.4);
        }
        colorAttr.array[i * 3] = cr * intensity;
        colorAttr.array[i * 3 + 1] = cg * intensity;
        colorAttr.array[i * 3 + 2] = cb * intensity;
      }

      posAttr.needsUpdate = true;
      colorAttr.needsUpdate = true;

      haloMat.color.setRGB(ar * 0.35, ag * 0.35, ab * 0.35);

      points.rotation.y += 0.0035;
      points.rotation.x += 0.0009;
      halo.rotation.y -= 0.001;
      halo.scale.setScalar(baseRadius * 0.5 * breathe);

      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    animate();

    const handleResize = () => {
      computeLayout();
      buildSphere();
      posAttr.needsUpdate = true;
      halo.scale.setScalar(baseRadius * 0.5);
      renderer.setSize(W, H);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      geometry.dispose();
      material.dispose();
      haloGeo.dispose();
      haloMat.dispose();
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
