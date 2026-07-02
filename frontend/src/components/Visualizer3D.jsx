import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { getSpectrumBars } from '../audio/engine';

const PARTICLE_COUNT = 4000;
const NUM_BARS = 64;
const FOV = 75;

// hex → 归一化 RGB
const hexToRgb = (hex) => {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b];
};

// 3D 粒子星球：球面粒子随频谱呼吸位移，加色混合辉光，自动旋转
// 完全自适应容器尺寸：根据可视半径动态计算 BASE_RADIUS，保证粒子永不超出边界
// 颜色跟随用户 DIY 主色派生
export default function Visualizer3D({ accent = '#4FC3F7' }) {
  const containerRef = useRef(null);
  const accentRef = useRef(accent);
  useEffect(() => { accentRef.current = accent; }, [accent]);

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

    // ---- 自适应核心：计算可视半径，反推安全粒子半径 ----
    // 最大位移乘数 = (1 + maxDisplacement) * (1 + maxBreathe)
    const MAX_DISPLACEMENT = 0.45;
    const MAX_BREATHE = 0.2;
    const SAFETY = 0.82; // 留 18% 安全余量

    let baseRadius, cameraZ;

    const computeLayout = () => {
      W = container.offsetWidth;
      H = container.offsetHeight;
      const aspect = W / H;

      // 相机距离设为容器短边的 1.8 倍，保证视角舒适
      const minDim = Math.min(W, H);
      cameraZ = minDim * 1.8;

      // 可视半径（在 cameraZ 距离处，短边方向）
      const halfFovRad = (FOV / 2) * Math.PI / 180;
      const visibleRadius = cameraZ * Math.tan(halfFovRad);

      // 粒子最大延伸 = baseRadius * (1+disp) * (1+breathe) 必须 <= visibleRadius * SAFETY
      const maxMultiplier = (1 + MAX_DISPLACEMENT) * (1 + MAX_BREATHE);
      baseRadius = (visibleRadius * SAFETY) / maxMultiplier;

      camera.aspect = aspect;
      camera.position.z = cameraZ;
      camera.updateProjectionMatrix();
    };

    computeLayout();

    // ---- Fibonacci 球面分布 ----
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const original = new Float32Array(PARTICLE_COUNT * 3);
    const colors = new Float32Array(PARTICLE_COUNT * 3);
    const barIdxMap = new Int32Array(PARTICLE_COUNT);

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

        const t = (y + 1) / 2;
        colors[i * 3] = 0.25 + t * 0.75;
        colors[i * 3 + 1] = 0.75 + t * 0.25;
        colors[i * 3 + 2] = 1.0;

        barIdxMap[i] = Math.floor(Math.random() * NUM_BARS);
      }
    };
    buildSphere();

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 2.4,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });

    const points = new THREE.Points(geometry, material);
    scene.add(points);

    // 内层光晕球
    const haloGeo = new THREE.SphereGeometry(1, 32, 32);
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0x1a2a4a,
      transparent: true,
      opacity: 0.15,
      blending: THREE.AdditiveBlending,
    });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.scale.setScalar(baseRadius * 0.55);
    scene.add(halo);

    let raf;
    const posAttr = geometry.attributes.position;
    const colorAttr = geometry.attributes.color;

    const animate = () => {
      const { data, hasData } = getSpectrumBars(NUM_BARS);

      let bass = 0;
      if (hasData) {
        for (let i = 0; i < 8; i++) bass += data[i];
        bass /= 8;
      } else {
        bass = 0.08 + Math.sin(Date.now() * 0.001) * 0.04;
      }
      // 限制呼吸在安全范围内
      const breathe = 1 + Math.min(bass, 1) * MAX_BREATHE;

      // 根据用户 DIY 主色派生粒子颜色（暗→亮渐变）
      const [ar, ag, ab] = hexToRgb(accentRef.current);
      const lowR = ar * 0.4, lowG = ag * 0.4, lowB = ab * 0.4;
      const highR = ar * 0.5 + 0.5, highG = ag * 0.5 + 0.5, highB = ab * 0.5 + 0.5;

      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const bi = barIdxMap[i];
        const value = hasData
          ? data[bi]
          : 0.08 + Math.sin(Date.now() * 0.002 + i * 0.012) * 0.05;
        // 限制位移在安全范围内
        const disp = 1 + Math.min(value, 1) * MAX_DISPLACEMENT;

        posAttr.array[i * 3] = original[i * 3] * disp * breathe;
        posAttr.array[i * 3 + 1] = original[i * 3 + 1] * disp * breathe;
        posAttr.array[i * 3 + 2] = original[i * 3 + 2] * disp * breathe;

        const intensity = 0.35 + value * 0.65;
        const t = (original[i * 3 + 1] / baseRadius + 1) / 2;
        colorAttr.array[i * 3] = (lowR + t * (highR - lowR)) * intensity;
        colorAttr.array[i * 3 + 1] = (lowG + t * (highG - lowG)) * intensity;
        colorAttr.array[i * 3 + 2] = (lowB + t * (highB - lowB)) * intensity;
      }

      posAttr.needsUpdate = true;
      colorAttr.needsUpdate = true;

      // halo 颜色跟随主色
      haloMat.color.setRGB(ar * 0.35, ag * 0.35, ab * 0.35);

      points.rotation.y += 0.003;
      points.rotation.x += 0.0008;
      halo.rotation.y -= 0.001;
      halo.scale.setScalar(baseRadius * 0.55 * breathe);

      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };

    animate();

    const handleResize = () => {
      computeLayout();
      // 重建粒子位置以适配新半径
      buildSphere();
      posAttr.needsUpdate = true;
      halo.scale.setScalar(baseRadius * 0.55);
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
