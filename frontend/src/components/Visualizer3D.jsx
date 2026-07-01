import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { getSpectrumBars } from '../audio/engine';

export default function Visualizer3D({ isPlaying }) {
  const mountRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const W = mount.offsetWidth;
    const H = mount.offsetHeight;

    const scene = new THREE.Scene();
    // 增加相机距离，留出更多边界空间
    const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 100);
    camera.position.set(0, 3.2, 8.5);
    camera.lookAt(0, 0.4, 0);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.4;
    mount.appendChild(renderer.domElement);

    // 灯光
    scene.add(new THREE.AmbientLight(0x223355, 0.35));
    const keyLight = new THREE.PointLight(0x66aaff, 2.2, 30);
    keyLight.position.set(0, 7, 5);
    scene.add(keyLight);
    const fillLight = new THREE.PointLight(0xff5588, 0.5, 30);
    fillLight.position.set(-4, 4, -4);
    scene.add(fillLight);
    const rim = new THREE.DirectionalLight(0xffffff, 0.5);
    rim.position.set(0, 8, -5);
    scene.add(rim);

    // ---- 连续网格地形（圆盘形），R_MAX 缩小避免超出边界 ----
    const SECTORS = 72;
    const RINGS = 24;
    const R_MAX = 2.2;   // 从 2.8 缩小，确保不超出边界
    const R_MIN = 0.42;  // 中心留空

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

    // 使用平滑着色 + 无 wireframe 的更干净材质
    const terrainMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.15,
      metalness: 0.75,
      flatShading: false,
      side: THREE.DoubleSide,
      emissive: 0x112244,
      emissiveIntensity: 0.4,
    });

    const terrain = new THREE.Mesh(terrainGeo, terrainMat);
    scene.add(terrain);

    // 柔和的顶部辉光层（不带架构线）
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x88ccff,
      wireframe: true,
      transparent: true,
      opacity: 0.0, // 默认关闭架构线
    });
    const wireframe = new THREE.Mesh(terrainGeo, wireMat);
    scene.add(wireframe);

    // 中心发光球
    const sphereGeo = new THREE.IcosahedronGeometry(0.32, 2);
    const sphereMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.08,
      metalness: 0.95,
      emissive: 0x4488ff,
      emissiveIntensity: 0.6,
    });
    const sphere = new THREE.Mesh(sphereGeo, sphereMat);
    sphere.position.y = 0.25;
    scene.add(sphere);

    // 底部光盘
    const discGeo = new THREE.CircleGeometry(R_MAX + 0.15, 64);
    const discMat = new THREE.MeshBasicMaterial({
      color: 0x112244,
      transparent: true,
      opacity: 0.18,
    });
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = -0.03;
    scene.add(disc);

    // 底部外圈光环
    const glowRingGeo = new THREE.RingGeometry(R_MAX, R_MAX + 0.06, 64);
    const glowRingMat = new THREE.MeshBasicMaterial({
      color: 0x55aaff,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
    });
    const glowRing = new THREE.Mesh(glowRingGeo, glowRingMat);
    glowRing.rotation.x = -Math.PI / 2;
    glowRing.position.y = -0.01;
    scene.add(glowRing);

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
        bass = (Math.sin(elapsed * 1.5) * 0.5 + 0.5) * 0.1;
      }

      // 更新网格顶点高度和颜色
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
            value *= (1.0 - radialRatio * 0.45);
          } else {
            const wave = Math.sin(radius * 2.5 + elapsed * 2) * 0.5 + 0.5;
            const wave2 = Math.sin(angle * 2 + elapsed * 1.5) * 0.3 + 0.5;
            value = wave * wave2 * 0.1 * (1.0 - radialRatio * 0.3);
          }

          if (value > smoothHeights[vi]) {
            smoothHeights[vi] += (value - smoothHeights[vi]) * 0.45;
          } else {
            smoothHeights[vi] += (value - smoothHeights[vi]) * 0.08;
          }

          const height = Math.max(0.02, smoothHeights[vi] * 2.4);
          posAttr.array[vi * 3 + 1] = height;

          // 颜色：从底部的深蓝 -> 中部的青色 -> 顶部的亮白
          const t = smoothHeights[vi];
          const hue = 0.62 - radialRatio * 0.1 + t * 0.05;
          const sat = 0.55 + t * 0.25;
          const lit = 0.25 + radialRatio * 0.15 + t * 0.55;
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

      // 中心球体
      const sphereScale = 1 + bass * 0.7;
      sphere.scale.set(sphereScale, sphereScale, sphereScale);
      sphere.rotation.y = elapsed * 0.5;
      sphere.rotation.x = elapsed * 0.3;
      sphereMat.emissiveIntensity = 0.4 + bass * 1.8;

      // 整体缓慢旋转
      terrain.rotation.y = elapsed * 0.08;
      wireframe.rotation.y = elapsed * 0.08;

      // 相机缓慢摆动
      camera.position.x = Math.sin(elapsed * 0.07) * 0.9;
      camera.position.z = 8.2 + Math.cos(elapsed * 0.05) * 0.5;
      camera.position.y = 3.1 + Math.sin(elapsed * 0.09) * 0.25;
      camera.lookAt(0, 0.4, 0);

      // 灯光
      keyLight.intensity = 1.0 + bass * 3;
      fillLight.intensity = 0.25 + bass * 1.3;
      glowRingMat.opacity = 0.12 + bass * 0.35;
      discMat.opacity = 0.08 + bass * 0.18;

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
      mount.removeChild(renderer.domElement);
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
      }}
    />
  );
}
