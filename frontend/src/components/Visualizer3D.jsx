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
    const camera = new THREE.PerspectiveCamera(35, W / H, 0.1, 100);
    camera.position.set(0, 3.5, 7);
    camera.lookAt(0, 0.5, 0);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.3;
    mount.appendChild(renderer.domElement);

    // 灯光
    scene.add(new THREE.AmbientLight(0x334466, 0.4));
    const keyLight = new THREE.PointLight(0x5599ff, 2.5, 25);
    keyLight.position.set(0, 6, 4);
    scene.add(keyLight);
    const fillLight = new THREE.PointLight(0xff5577, 0.6, 25);
    fillLight.position.set(-3, 4, -3);
    scene.add(fillLight);
    const rim = new THREE.DirectionalLight(0xffffff, 0.5);
    rim.position.set(0, 8, -5);
    scene.add(rim);

    // ---- 创建连续网格地形（圆盘形） ----
    // 极坐标网格：sectors × rings，每个顶点高度由频谱驱动
    const SECTORS = 80; // 角度方向分段
    const RINGS = 30;   // 径向方向分段
    const R_MAX = 2.8;
    const R_MIN = 0.5;  // 中心留空

    const vertexCount = (SECTORS + 1) * (RINGS + 1);
    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);
    const indices = [];

    // 初始化顶点位置（平面圆盘）
    let vi = 0;
    for (let r = 0; r <= RINGS; r++) {
      const radius = R_MIN + (r / RINGS) * (R_MAX - R_MIN);
      for (let s = 0; s <= SECTORS; s++) {
        const angle = (s / SECTORS) * Math.PI * 2;
        positions[vi * 3] = Math.cos(angle) * radius;
        positions[vi * 3 + 1] = 0;
        positions[vi * 3 + 2] = Math.sin(angle) * radius;
        // 颜色渐变：中心暖，外围冷
        const t = r / RINGS;
        const color = new THREE.Color().setHSL(0.6 - t * 0.05, 0.6, 0.5 + (1 - t) * 0.15);
        colors[vi * 3] = color.r;
        colors[vi * 3 + 1] = color.g;
        colors[vi * 3 + 2] = color.b;
        vi++;
      }
    }

    // 索引：连接相邻顶点形成三角面
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
      roughness: 0.2,
      metalness: 0.6,
      flatShading: false,
      side: THREE.DoubleSide,
      emissive: 0x224488,
      emissiveIntensity: 0.3,
    });

    const terrain = new THREE.Mesh(terrainGeo, terrainMat);
    scene.add(terrain);

    // wireframe 叠加
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x66aaff,
      wireframe: true,
      transparent: true,
      opacity: 0.08,
    });
    const wireframe = new THREE.Mesh(terrainGeo, wireMat);
    scene.add(wireframe);

    // ---- 中心发光球体 ----
    const sphereGeo = new THREE.IcosahedronGeometry(0.35, 2);
    const sphereMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.1,
      metalness: 0.9,
      emissive: 0x4488ff,
      emissiveIntensity: 0.5,
    });
    const sphere = new THREE.Mesh(sphereGeo, sphereMat);
    sphere.position.y = 0.3;
    scene.add(sphere);

    // ---- 底部光盘 ----
    const discGeo = new THREE.CircleGeometry(R_MAX + 0.2, 64);
    const discMat = new THREE.MeshBasicMaterial({
      color: 0x112244,
      transparent: true,
      opacity: 0.2,
    });
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = -0.05;
    scene.add(disc);

    // 底部光环
    const glowRingGeo = new THREE.RingGeometry(R_MAX, R_MAX + 0.08, 64);
    const glowRingMat = new THREE.MeshBasicMaterial({
      color: 0x4488ff,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
    });
    const glowRing = new THREE.Mesh(glowRingGeo, glowRingMat);
    glowRing.rotation.x = -Math.PI / 2;
    glowRing.position.y = -0.03;
    scene.add(glowRing);

    // 频谱数据缓冲
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

      // 更新顶点高度
      vi = 0;
      for (let r = 0; r <= RINGS; r++) {
        const radius = R_MIN + (r / RINGS) * (R_MAX - R_MIN);
        const radialRatio = (radius - R_MIN) / (R_MAX - R_MIN);
        // 频段索引：内圈低频，外圈高频
        const freqIdx = Math.floor(radialRatio * (TOTAL - 1));

        for (let s = 0; s <= SECTORS; s++) {
          const angle = (s / SECTORS) * Math.PI * 2;

          let value;
          if (hasData) {
            // 在该频段附近取值，加角度方向的微小变化
            const offsetIdx = Math.floor(freqIdx + Math.sin(angle * 3) * 2);
            value = spectrum[Math.max(0, Math.min(TOTAL - 1, offsetIdx))] || 0;
            // 中心区域高度更大
            value *= (1.0 - radialRatio * 0.5);
          } else {
            const wave = Math.sin(radius * 2 + elapsed * 2) * 0.5 + 0.5;
            const wave2 = Math.sin(angle * 2 + elapsed * 1.5) * 0.3 + 0.5;
            value = wave * wave2 * 0.1 * (1.0 - radialRatio * 0.3);
          }

          // 平滑
          if (value > smoothHeights[vi]) {
            smoothHeights[vi] += (value - smoothHeights[vi]) * 0.4;
          } else {
            smoothHeights[vi] += (value - smoothHeights[vi]) * 0.08;
          }

          const height = Math.max(0.02, smoothHeights[vi] * 2.5);
          posAttr.array[vi * 3 + 1] = height;

          // 更新颜色：高度越高越亮
          const t = smoothHeights[vi];
          const color = new THREE.Color().setHSL(
            0.6 - radialRatio * 0.05,
            0.5 + t * 0.3,
            0.3 + t * 0.4
          );
          colors[vi * 3] = color.r;
          colors[vi * 3 + 1] = color.g;
          colors[vi * 3 + 2] = color.b;

          vi++;
        }
      }
      posAttr.needsUpdate = true;
      terrainGeo.attributes.color.needsUpdate = true;
      terrainGeo.computeVertexNormals();

      // 中心球体脉动
      const sphereScale = 1 + bass * 0.8;
      sphere.scale.set(sphereScale, sphereScale, sphereScale);
      sphere.rotation.y = elapsed * 0.5;
      sphere.rotation.x = elapsed * 0.3;
      sphereMat.emissiveIntensity = 0.3 + bass * 1.5;

      // 整体旋转
      terrain.rotation.y = elapsed * 0.1;
      wireframe.rotation.y = elapsed * 0.1;

      // 相机摆动
      camera.position.x = Math.sin(elapsed * 0.08) * 1.0;
      camera.position.z = 6.5 + Math.cos(elapsed * 0.06) * 0.6;
      camera.position.y = 3.2 + Math.sin(elapsed * 0.1) * 0.3;
      camera.lookAt(0, 0.5, 0);

      // 灯光
      keyLight.intensity = 1.0 + bass * 3;
      fillLight.intensity = 0.3 + bass * 1.2;
      glowRingMat.opacity = 0.15 + bass * 0.3;
      discMat.opacity = 0.1 + bass * 0.15;

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
