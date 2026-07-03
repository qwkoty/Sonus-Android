import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { getSpectrumBars } from '../audio/engine';

const NUM_BARS = 56;        // 柱阵数量（56 兼顾表现力与安卓性能）
const FOV = 55;

// 3D 辐射频谱柱阵 + 中心音核 + 粒子喷射
// 网页端原版用 UnrealBloomPass 后处理实现发光，但 Bloom 在安卓 GPU 上基本跑不动。
// 本版本移除 Bloom，改用 AdditiveBlending + 多层发光球 + 柱顶光点 实现伪 Bloom 发光效果，
// 视觉上接近原版且安卓端流畅。
export default function Visualizer3DPulse({ accent = '#4FC3F7', onReady }) {
  const containerRef = useRef(null);
  const accentRef = useRef(accent);
  const onReadyRef = useRef(onReady);
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);
  useEffect(() => { accentRef.current = accent; }, [accent]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);   // 安卓限 1.5
    let W = container.offsetWidth;
    let H = container.offsetHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV, W / H, 0.1, 3000);

    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });  // 关抗锯齿省性能
    renderer.setSize(W, H);
    renderer.setPixelRatio(dpr);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    container.appendChild(renderer.domElement);

    // 自适应布局
    const minDim = Math.min(W, H);
    const cameraZ = minDim * 1.8;
    const visibleHalf = cameraZ * Math.tan((FOV / 2) * Math.PI / 180);
    const SCENE_R = visibleHalf * 0.7;          // 场景最大半径
    const RING_R = SCENE_R * 0.55;              // 柱阵环半径
    const BAR_MAX_H = SCENE_R * 0.55;           // 柱最大高度
    const CORE_R = SCENE_R * 0.12;              // 音核半径
    camera.position.set(0, SCENE_R * 0.55, cameraZ);
    camera.lookAt(0, 0, 0);

    // ===== 颜色工具 =====
    const hexToHsl = (hex) => {
      const r = parseInt(hex.slice(1, 3), 16) / 255;
      const g = parseInt(hex.slice(3, 5), 16) / 255;
      const b = parseInt(hex.slice(5, 7), 16) / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      let h, s, l = (max + min) / 2;
      if (max === min) { h = s = 0; }
      else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
          case r: h = (g - b) / d + (g < b ? 6 : 0); break;
          case g: h = (b - r) / d + 2; break;
          case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
      }
      return [h * 360, s * 100, l * 100];
    };

    // ===== 中心音核：线框二十面体 + 内部实体 + 发光球 =====
    const coreGroup = new THREE.Group();
    scene.add(coreGroup);

    const coreGeo = new THREE.IcosahedronGeometry(CORE_R, 1);
    const coreWireMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(accent),
      wireframe: true,
      transparent: true,
      opacity: 0.9,
    });
    const coreWire = new THREE.Mesh(coreGeo, coreWireMat);
    coreGroup.add(coreWire);

    const coreSolidMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(accent),
      transparent: true,
      opacity: 0.15,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const coreSolid = new THREE.Mesh(
      new THREE.IcosahedronGeometry(CORE_R * 0.92, 1),
      coreSolidMat
    );
    coreGroup.add(coreSolid);

    // 音核中心发光球（随 bass 脉冲）—— 伪 Bloom 的核心
    const coreGlowMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ffffff'),
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const coreGlow = new THREE.Mesh(
      new THREE.SphereGeometry(CORE_R * 0.5, 24, 24),
      coreGlowMat
    );
    coreGroup.add(coreGlow);

    // 外层柔光球（更大、更透明，模拟 Bloom 弥散光晕）
    const coreHaloMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(accent),
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const coreHalo = new THREE.Mesh(
      new THREE.SphereGeometry(CORE_R * 1.6, 24, 24),
      coreHaloMat
    );
    coreGroup.add(coreHalo);

    // ===== 频谱柱（环形辐射）=====
    const bars = [];
    const barGeo = new THREE.BoxGeometry(SCENE_R * 0.025, 1, SCENE_R * 0.025);
    // 柱顶发光小球（共享几何体，伪 Bloom 柱顶高光）
    const tipGeo = new THREE.SphereGeometry(SCENE_R * 0.022, 10, 10);
    for (let i = 0; i < NUM_BARS; i++) {
      const angle = (i / NUM_BARS) * Math.PI * 2;
      // 颜色：低频暖色，高频冷色
      const [aH] = hexToHsl(accent);
      const hueShift = (i / NUM_BARS) * 80;
      const hue = (aH + hueShift) % 360;
      const color = new THREE.Color().setHSL(hue / 360, 0.9, 0.55);
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.92,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const bar = new THREE.Mesh(barGeo, mat);
      bar.position.set(
        Math.cos(angle) * RING_R,
        0,
        Math.sin(angle) * RING_R
      );
      bar.scale.y = 0.1;
      scene.add(bar);

      // 柱顶发光球
      const tipMat = new THREE.MeshBasicMaterial({
        color: color.clone().multiplyScalar(1.6),
        transparent: true,
        opacity: 0.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const tip = new THREE.Mesh(tipGeo, tipMat);
      tip.position.set(Math.cos(angle) * RING_R, 0, Math.sin(angle) * RING_R);
      scene.add(tip);

      bars.push({ mesh: bar, mat, tip, tipMat, angle, baseColor: color.clone() });
    }

    // ===== 底盘光环（3 圈，地面投影感）=====
    const ringGeo = new THREE.RingGeometry(RING_R * 0.98, RING_R * 1.02, 96);
    const ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(accent),
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const baseRing = new THREE.Mesh(ringGeo, ringMat);
    baseRing.rotation.x = -Math.PI / 2;
    scene.add(baseRing);

    const outerRingGeo = new THREE.RingGeometry(RING_R * 1.25, RING_R * 1.27, 96);
    const outerRingMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(accent),
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const outerRing = new THREE.Mesh(outerRingGeo, outerRingMat);
    outerRing.rotation.x = -Math.PI / 2;
    scene.add(outerRing);

    const innerRingGeo = new THREE.RingGeometry(RING_R * 0.7, RING_R * 0.71, 96);
    const innerRingMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(accent),
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const innerRing = new THREE.Mesh(innerRingGeo, innerRingMat);
    innerRing.rotation.x = -Math.PI / 2;
    scene.add(innerRing);

    // ===== 粒子喷射池（bass 命中时柱顶喷发）=====
    const PARTICLE_COUNT = 400;   // 安卓端 400 粒子流畅
    const pPositions = new Float32Array(PARTICLE_COUNT * 3);
    const pColors = new Float32Array(PARTICLE_COUNT * 3);
    const pVelocities = new Float32Array(PARTICLE_COUNT * 3);
    const pLife = new Float32Array(PARTICLE_COUNT);       // 0..1 剩余生命
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      pLife[i] = 0;
      pPositions[i * 3 + 1] = -9999;   // 初始隐藏到画面外
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPositions, 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(pColors, 3));
    const pMat = new THREE.PointsMaterial({
      size: SCENE_R * 0.02,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const particles = new THREE.Points(pGeo, pMat);
    scene.add(particles);

    let particleCursor = 0;
    const emitParticle = (barIdx, energy, color) => {
      const bar = bars[barIdx];
      const i = particleCursor;
      particleCursor = (particleCursor + 1) % PARTICLE_COUNT;
      const x = bar.mesh.position.x;
      const z = bar.mesh.position.z;
      const y = bar.mesh.scale.y;
      pPositions[i * 3] = x;
      pPositions[i * 3 + 1] = y;
      pPositions[i * 3 + 2] = z;
      // 向上 + 略向外
      const outDir = Math.atan2(z, x);
      pVelocities[i * 3] = Math.cos(outDir) * 0.3;
      pVelocities[i * 3 + 1] = 0.6 + energy * 1.2;
      pVelocities[i * 3 + 2] = Math.sin(outDir) * 0.3;
      pColors[i * 3] = color.r;
      pColors[i * 3 + 1] = color.g;
      pColors[i * 3 + 2] = color.b;
      pLife[i] = 1;
    };

    // ===== 动画循环 =====
    let raf;
    let bassSmooth = 0;
    let bassPrev = 0;
    let firstFrame = true;

    const animate = () => {
      const { data, hasData } = getSpectrumBars(NUM_BARS);

      // 频段提取
      let bass = 0, mid = 0, treble = 0;
      if (hasData) {
        for (let i = 0; i < 8; i++) bass += data[i];
        bass /= 8;
        for (let i = 8; i < 28; i++) mid += data[i];
        mid /= 20;
        for (let i = 28; i < NUM_BARS; i++) treble += data[i];
        treble /= (NUM_BARS - 28);
      } else {
        const t = Date.now() * 0.001;
        bass = 0.08 + Math.sin(t * 1.4) * 0.05;
        mid = 0.05 + Math.sin(t * 1.9 + 1) * 0.03;
        treble = 0.03 + Math.sin(t * 2.4 + 2) * 0.02;
      }
      bassSmooth += (bass - bassSmooth) * 0.2;

      // bass 峰值检测 → 触发粒子喷射
      const bassDelta = bass - bassPrev;
      bassPrev = bass;
      if (hasData && bass > 0.4 && bassDelta > 0.1) {
        for (let i = 0; i < NUM_BARS; i++) {
          if (data[i] > 0.5) {
            emitParticle(i, data[i], bars[i].baseColor);
          }
        }
      }

      // ===== 音核脉冲 =====
      const coreScale = 1 + bassSmooth * 0.6;
      coreGroup.scale.setScalar(coreScale);
      coreWire.rotation.x += 0.004;
      coreWire.rotation.y += 0.006;
      coreSolid.rotation.x -= 0.003;
      coreSolid.rotation.y -= 0.005;
      coreWireMat.opacity = 0.6 + bassSmooth * 0.4;
      coreGlowMat.opacity = 0.4 + bassSmooth * 0.5;
      coreGlow.scale.setScalar(1 + bassSmooth * 1.2);
      // 外层光晕随 bass 弥散膨胀（伪 Bloom 弥散感）
      coreHaloMat.opacity = 0.1 + bassSmooth * 0.25;
      coreHalo.scale.setScalar(1 + bassSmooth * 0.8);

      // ===== 柱子更新 =====
      for (let i = 0; i < NUM_BARS; i++) {
        const bar = bars[i];
        const v = hasData ? data[i] : (0.05 + Math.sin(Date.now() * 0.001 + i * 0.2) * 0.04);
        const h = Math.max(0.05, v * BAR_MAX_H);
        bar.mesh.scale.y = h;
        bar.mesh.position.y = h / 2;
        // 颜色亮度随能量
        const intensity = 0.5 + v * 0.8;
        bar.mat.color.copy(bar.baseColor).multiplyScalar(intensity);
        bar.mat.opacity = 0.7 + v * 0.3;

        // 柱顶发光球：位置跟随柱顶，能量越高越亮
        bar.tip.position.y = h;
        bar.tipMat.opacity = Math.min(0.9, v * 1.4);
        bar.tip.scale.setScalar(0.6 + v * 0.8);
      }

      // ===== 底盘光环 =====
      ringMat.opacity = 0.25 + bassSmooth * 0.4;
      outerRing.rotation.z += 0.001;
      outerRingMat.opacity = 0.1 + mid * 0.2;
      innerRing.rotation.z -= 0.0015;
      innerRingMat.opacity = 0.1 + treble * 0.25;

      // ===== 粒子更新 =====
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        if (pLife[i] <= 0) {
          pPositions[i * 3 + 1] = -9999;
          continue;
        }
        pPositions[i * 3]     += pVelocities[i * 3];
        pPositions[i * 3 + 1] += pVelocities[i * 3 + 1];
        pPositions[i * 3 + 2] += pVelocities[i * 3 + 2];
        // 重力 + 衰减
        pVelocities[i * 3 + 1] -= 0.025;
        pVelocities[i * 3] *= 0.98;
        pVelocities[i * 3 + 2] *= 0.98;
        pLife[i] -= 0.012;
        // 颜色随生命衰减
        pColors[i * 3] *= 0.995;
        pColors[i * 3 + 1] *= 0.995;
        pColors[i * 3 + 2] *= 0.995;
      }
      pGeo.attributes.position.needsUpdate = true;
      pGeo.attributes.color.needsUpdate = true;

      // ===== 整体自转 + 相机浮动 =====
      scene.rotation.y += 0.0035;
      const t = Date.now() * 0.001;
      camera.position.y = SCENE_R * 0.55 + Math.sin(t * 0.3) * SCENE_R * 0.12;
      camera.position.x = Math.sin(t * 0.15) * SCENE_R * 0.15;
      camera.lookAt(0, 0, 0);

      renderer.render(scene, camera);

      if (firstFrame) {
        firstFrame = false;
        if (onReadyRef.current) onReadyRef.current();
      }
      raf = requestAnimationFrame(animate);
    };
    animate();

    // ===== 主题色更新 =====
    const updateAccent = () => {
      const color = new THREE.Color(accentRef.current);
      coreWireMat.color.copy(color);
      coreSolidMat.color.copy(color);
      coreHaloMat.color.copy(color);
      ringMat.color.copy(color);
      outerRingMat.color.copy(color);
      innerRingMat.color.copy(color);
      const [aH] = hexToHsl(accentRef.current);
      for (let i = 0; i < NUM_BARS; i++) {
        const hueShift = (i / NUM_BARS) * 80;
        const hue = (aH + hueShift) % 360;
        bars[i].baseColor.setHSL(hue / 360, 0.9, 0.55);
        bars[i].tipMat.color.copy(bars[i].baseColor).multiplyScalar(1.6);
      }
    };
    const accentTimer = setInterval(updateAccent, 200);
    updateAccent();

    // ===== resize =====
    const handleResize = () => {
      W = container.offsetWidth;
      H = container.offsetHeight;
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
      renderer.setSize(W, H);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(accentTimer);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      coreGeo.dispose();
      barGeo.dispose();
      tipGeo.dispose();
      ringGeo.dispose();
      outerRingGeo.dispose();
      innerRingGeo.dispose();
      pGeo.dispose();
      coreWireMat.dispose();
      coreSolidMat.dispose();
      coreGlowMat.dispose();
      coreHaloMat.dispose();
      ringMat.dispose();
      outerRingMat.dispose();
      innerRingMat.dispose();
      pMat.dispose();
      bars.forEach((b) => { b.mat.dispose(); b.tipMat.dispose(); });
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
