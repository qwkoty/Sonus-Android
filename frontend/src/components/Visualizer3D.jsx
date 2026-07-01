import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { getSpectrumBars } from '../audio/engine';
import Visualizer from './Visualizer';

function isWebGLAvailable() {
  try {
    const canvas = document.createElement('canvas');
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
    );
  } catch (e) {
    return false;
  }
}

export default function Visualizer3D({ isPlaying }) {
  const [webglReady] = useState(() => isWebGLAvailable());
  const mountRef = useRef(null);
  const rafRef = useRef(null);

  if (!webglReady) {
    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          zIndex: 2,
          background: '#05070a',
        }}
      >
        <Visualizer isPlaying={isPlaying} coverRadius={0} />
      </div>
    );
  }

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const W = mount.offsetWidth;
    const H = mount.offsetHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05070a);
    scene.fog = new THREE.FogExp2(0x05070a, 0.075);

    const camera = new THREE.PerspectiveCamera(42, W / H, 0.1, 100);
    camera.position.set(0, 2.6, 8.2);
    camera.lookAt(0, 0.35, 0);

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(W, H);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setClearColor(0x05070a, 1);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.25;
    } catch (err) {
      mount.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.5);font-size:13px;">3D 加载失败</div>';
      return () => {
        mount.innerHTML = '';
      };
    }

    mount.appendChild(renderer.domElement);

    // ---- 灯光 ----
    scene.add(new THREE.AmbientLight(0x335577, 1.0));
    const keyLight = new THREE.PointLight(0x66ccff, 3.0, 40);
    keyLight.position.set(0, 5.5, 4.5);
    scene.add(keyLight);
    const fillLight = new THREE.PointLight(0xff77cc, 1.8, 40);
    fillLight.position.set(-4.5, 3.5, -3.5);
    scene.add(fillLight);
    const rimLight = new THREE.DirectionalLight(0xaaccff, 1.2);
    rimLight.position.set(0, 6, -5);
    scene.add(rimLight);

    // ---- 网格地形 ----
    const SECTORS = 72;
    const RINGS = 24;
    const R_MAX = 2.05;
    const R_MIN = 0.32;

    const vertexCount = (SECTORS + 1) * (RINGS + 1);
    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);
    const indices = [];

    let vi = 0;
    for (let r = 0; r <= RINGS; r++) {
      const radius = R_MIN + (r / RINGS) * (R_MAX - R_MIN);
      for (let s = 0; s <= SECTORS; s++) {
        const angle = (s / SECTORS) * Math.PI * 2;
        positions[vi * 3] = Math.cos(angle) * radius;
        positions[vi * 3 + 1] = 0;
        positions[vi * 3 + 2] = Math.sin(angle) * radius;
        vi++;
      }
    }

    for (let r = 0; r < RINGS; r++) {
      for (let s = 0; s < SECTORS; s++) {
        const a = r * (SECTORS + 1) + s;
        const b = a + 1;
        const c = a + (SECTORS + 1);
        const d = c + 1;
        indices.push(a, b, c);
        indices.push(b, d, c);
      }
    }

    const terrainGeo = new THREE.BufferGeometry();
    terrainGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    terrainGeo.setIndex(indices);
    terrainGeo.computeVertexNormals();

    const terrainMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.25,
      metalness: 0.5,
      flatShading: false,
      side: THREE.DoubleSide,
      emissive: 0x112244,
      emissiveIntensity: 0.4,
    });

    const terrain = new THREE.Mesh(terrainGeo, terrainMat);
    scene.add(terrain);

    // ---- 中心发光核 ----
    const coreGeo = new THREE.IcosahedronGeometry(0.28, 3);
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.05,
      metalness: 0.95,
      emissive: 0x66ccff,
      emissiveIntensity: 1.2,
    });
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.position.y = 0.2;
    scene.add(core);

    // 核心外层光晕
    const glowGeo = new THREE.SphereGeometry(0.42, 32, 32);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x4488ff,
      transparent: true,
      opacity: 0.18,
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.position.y = 0.2;
    scene.add(glow);

    // ---- 地面反射盘 ----
    const discGeo = new THREE.CircleGeometry(R_MAX + 0.35, 64);
    const discMat = new THREE.MeshBasicMaterial({
      color: 0x0a1420,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    });
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = -0.05;
    scene.add(disc);

    // ---- 外圈光环 ----
    const ringGeo = new THREE.RingGeometry(R_MAX, R_MAX + 0.06, 64);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x66ccff,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.02;
    scene.add(ring);

    // ---- 网格地板 ----
    const gridHelper = new THREE.GridHelper(8, 40, 0x223355, 0x111827);
    gridHelper.position.y = -0.06;
    scene.add(gridHelper);

    const TOTAL = 72;
    const smoothHeights = new Float32Array(vertexCount);
    const posAttr = terrainGeo.attributes.position;

    const clock = new THREE.Clock();

    const animate = () => {
      const elapsed = clock.getElapsedTime();
      const { data: spectrum, hasData } = getSpectrumBars(TOTAL);

      let bass = 0;
      if (hasData) {
        for (let i = 0; i < 6; i++) bass += spectrum[i] || 0;
        bass /= 6;
      } else {
        bass = (Math.sin(elapsed * 1.5) * 0.5 + 0.5) * 0.18;
      }

      // 更新顶点
      vi = 0;
      for (let r = 0; r <= RINGS; r++) {
        const radius = R_MIN + (r / RINGS) * (R_MAX - R_MIN);
        const radialRatio = (radius - R_MIN) / (R_MAX - R_MIN);
        const freqIdx = Math.floor(radialRatio * (TOTAL - 1));

        for (let s = 0; s <= SECTORS; s++) {
          const angle = (s / SECTORS) * Math.PI * 2;

          let value;
          if (hasData) {
            const offsetIdx = Math.floor(freqIdx + Math.sin(angle * 2.5) * 1.5);
            value = spectrum[Math.max(0, Math.min(TOTAL - 1, offsetIdx))] || 0;
            value *= (1.0 - radialRatio * 0.35);
          } else {
            const wave = Math.sin(radius * 2.2 + elapsed * 2.2) * 0.5 + 0.5;
            const wave2 = Math.sin(angle * 2 + elapsed * 1.6) * 0.3 + 0.5;
            value = wave * wave2 * 0.28 * (1.0 - radialRatio * 0.25);
          }

          if (value > smoothHeights[vi]) {
            smoothHeights[vi] += (value - smoothHeights[vi]) * 0.5;
          } else {
            smoothHeights[vi] += (value - smoothHeights[vi]) * 0.08;
          }

          const height = Math.max(0.02, smoothHeights[vi] * 2.6);
          posAttr.array[vi * 3 + 1] = height;

          // 饱和的颜色渐变：内青 -> 外紫，高峰发白
          const t = smoothHeights[vi];
          const hue = 0.56 + radialRatio * 0.26 + t * 0.06;
          const sat = Math.min(1, 0.85 + t * 0.15);
          const lit = Math.min(1, 0.32 + radialRatio * 0.08 + t * 0.62);
          const color = new THREE.Color().setHSL(hue, sat, lit);
          colors[vi * 3] = color.r;
          colors[vi * 3 + 1] = color.g;
          colors[vi * 3 + 2] = color.b;

          vi++;
        }
      }
      posAttr.needsUpdate = true;
      terrainGeo.attributes.color.needsUpdate = true;
      terrainGeo.computeVertexNormals();

      // 核心动画
      const coreScale = 1 + bass * 0.7;
      core.scale.set(coreScale, coreScale, coreScale);
      core.rotation.y = elapsed * 0.5;
      core.rotation.x = elapsed * 0.3;
      coreMat.emissiveIntensity = 1.2 + bass * 3.5;
      glowMat.opacity = 0.18 + bass * 0.5;
      glow.scale.set(coreScale, coreScale, coreScale);

      // 地形旋转
      terrain.rotation.y = elapsed * 0.08;

      // 相机
      camera.position.x = Math.sin(elapsed * 0.07) * 0.9;
      camera.position.z = 7.8 + Math.cos(elapsed * 0.05) * 0.5;
      camera.position.y = 2.6 + Math.sin(elapsed * 0.09) * 0.2;
      camera.lookAt(0, 0.4, 0);

      // 灯光
      keyLight.intensity = 1.5 + bass * 3.5;
      fillLight.intensity = 0.8 + bass * 2;
      ringMat.opacity = 0.25 + bass * 0.6;

      renderer.render(scene, camera);
      rafRef.current = requestAnimationFrame(animate);
    };

    animate();

    const handleResize = () => {
      const nw = mount.offsetWidth;
      const nh = mount.offsetHeight;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', handleResize);
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
      renderer.dispose();
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
    };
  }, []);

  return (
    <div
      ref={mountRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: 2,
        background: '#05070a',
      }}
    />
  );
}
