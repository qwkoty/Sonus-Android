import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { getSpectrumBars } from '../audio/engine';

const NUM_BARS = 64;
const FOV = 55;

// 3D 辐射频谱柱阵 + 中心音核 + Bloom 发光
// 表现力核心：bass 命中时音核脉冲膨胀 + 柱顶粒子喷射 + 冲击波环
export default function Visualizer3DPulse({ accent = '#4FC3F7', onReady }) {
  const containerRef = useRef(null);
  const accentRef = useRef(accent);
  const onReadyRef = useRef(onReady);
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);
  useEffect(() => { accentRef.current = accent; }, [accent]);

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

    // ===== 中心音核：线框二十面体 + 内部实体 =====
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

    // 音核中心发光球（随 bass 脉冲）
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

    // ===== 64 根频谱柱（环形辐射）=====
    const bars = [];
    const barGeo = new THREE.BoxGeometry(SCENE_R * 0.025, 1, SCENE_R * 0.025);
    for (let i = 0; i < NUM_BARS; i++) {
      const angle = (i / NUM_BARS) * Math.PI * 2;
      // 颜色：低频暖色（H 偏红），高频冷色（H 偏蓝）
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
      // 柱子从底向上长（position.y = scale.y/2）
      bar.scale.y = 0.1;
      bars.push({ mesh: bar, mat, angle, baseColor: color.clone() });
      scene.add(bar);
    }

    // ===== 底盘光环（地面投影感）=====
    const ringGeo = new THREE.RingGeometry(RING_R * 0.98, RING_R * 1.02, 128);
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

    // 第二圈外环
    const outerRingGeo = new THREE.RingGeometry(RING_R * 1.25, RING_R * 1.27, 128);
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

    // ===== 粒子喷射池（bass 命中时柱顶喷发）=====
    const PARTICLE_COUNT = 600;
    const pPositions = new Float32Array(PARTICLE_COUNT * 3);
    const pColors = new Float32Array(PARTICLE_COUNT * 3);
    const pVelocities = new Float32Array(PARTICLE_COUNT * 3);
    const pLife = new Float32Array(PARTICLE_COUNT);       // 0..1 剩余生命
    const pStartIdx = new Int32Array(PARTICLE_COUNT);     // 来自哪根柱
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      pLife[i] = 0; // 初始全死
      pStartIdx[i] = -1;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPositions, 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(pColors, 3));
    const pMat = new THREE.PointsMaterial({
      size: SCENE_R * 0.018,
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
      pStartIdx[i] = barIdx;
    };

    // ===== Bloom 后处理 =====
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(W, H),
      1.1,    // strength
      0.7,    // radius
      0.15    // threshold
    );
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());

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
        for (let i = 8; i < 32; i++) mid += data[i];
        mid /= 24;
        for (let i = 32; i < NUM_BARS; i++) treble += data[i];
        treble /= (NUM_BARS - 32);
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
        // 高能量柱子优先喷射
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
      // 线框透明度随能量
      coreWireMat.opacity = 0.6 + bassSmooth * 0.4;
      coreGlowMat.opacity = 0.4 + bassSmooth * 0.5;
      coreGlow.scale.setScalar(1 + bassSmooth * 1.2);

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
      }

      // ===== 底盘光环 =====
      ringMat.opacity = 0.25 + bassSmooth * 0.4;
      outerRing.rotation.z += 0.001;
      outerRingMat.opacity = 0.1 + mid * 0.2;

      // ===== 粒子更新 =====
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        if (pLife[i] <= 0) {
          // 隐藏死亡粒子（移到远处）
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
        const fade = Math.max(0, pLife[i]);
        pColors[i * 3] *= 0.995;
        pColors[i * 3 + 1] *= 0.995;
        pColors[i * 3 + 2] *= 0.995;
        if (fade < 0.3) {
          // 接近死亡时压暗
        }
      }
      pGeo.attributes.position.needsUpdate = true;
      pGeo.attributes.color.needsUpdate = true;

      // ===== 整体自转 + 相机浮动 =====
      scene.rotation.y += 0.0035;
      const t = Date.now() * 0.001;
      camera.position.y = SCENE_R * 0.55 + Math.sin(t * 0.3) * SCENE_R * 0.12;
      camera.position.x = Math.sin(t * 0.15) * SCENE_R * 0.15;
      camera.lookAt(0, 0, 0);

      // Bloom 强度随 bass
      bloomPass.strength = 0.9 + bassSmooth * 0.8;

      composer.render();

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
      ringMat.color.copy(color);
      outerRingMat.color.copy(color);
      const [aH] = hexToHsl(accentRef.current);
      for (let i = 0; i < NUM_BARS; i++) {
        const hueShift = (i / NUM_BARS) * 80;
        const hue = (aH + hueShift) % 360;
        bars[i].baseColor.setHSL(hue / 360, 0.9, 0.55);
      }
    };
    // 每 200ms 检查一次主题色变化（避免每帧字符串比较）
    const accentTimer = setInterval(updateAccent, 200);
    updateAccent();

    // ===== resize =====
    const handleResize = () => {
      W = container.offsetWidth;
      H = container.offsetHeight;
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
      renderer.setSize(W, H);
      composer.setSize(W, H);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(accentTimer);
      window.removeEventListener('resize', handleResize);
      composer.dispose();
      renderer.dispose();
      coreGeo.dispose();
      barGeo.dispose();
      ringGeo.dispose();
      outerRingGeo.dispose();
      pGeo.dispose();
      coreWireMat.dispose();
      coreSolidMat.dispose();
      coreGlowMat.dispose();
      ringMat.dispose();
      outerRingMat.dispose();
      pMat.dispose();
      bars.forEach((b) => b.mat.dispose());
      bloomPass.dispose();
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
