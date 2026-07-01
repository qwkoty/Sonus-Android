import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { readFrequencyDataLog } from '../audio/engine';

export default function Visualizer3D({ isPlaying, coverRadius = 80 }) {
  const mountRef = useRef(null);
  const rafRef = useRef(null);
  const sceneRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const W = mount.offsetWidth;
    const H = mount.offsetHeight;

    // Scene
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);
    camera.position.set(0, 2.5, 7);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    sceneRef.current = { scene, camera, renderer };

    // 灯光
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambient);
    const pointLight = new THREE.PointLight(0xffffff, 1.2, 20);
    pointLight.position.set(0, 5, 5);
    scene.add(pointLight);

    // ---- 3D 圆形柱状条 ----
    const BAR_COUNT = 72;
    const RADIUS = 2.8;
    const barGroup = new THREE.Group();
    scene.add(barGroup);

    const bars = [];
    for (let i = 0; i < BAR_COUNT; i++) {
      const angle = (i / BAR_COUNT) * Math.PI * 2;
      const geo = new THREE.BoxGeometry(0.12, 1, 0.12);
      geo.translate(0, 0.5, 0); // 枢轴在底部，缩放向上生长

      const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.3,
        metalness: 0.5,
        transparent: true,
        opacity: 0.9,
      });
      const bar = new THREE.Mesh(geo, mat);
      bar.position.set(Math.cos(angle) * RADIUS, -0.5, Math.sin(angle) * RADIUS);
      bar.lookAt(0, bar.position.y, 0);
      barGroup.add(bar);
      bars.push({ mesh: bar, smooth: 0 });
    }

    // ---- 中心粒子球 ----
    const PARTICLE_COUNT = 800;
    const particlePositions = new Float32Array(PARTICLE_COUNT * 3);
    const particleBase = new Float32Array(PARTICLE_COUNT * 3);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 1.2;
      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.sin(phi) * Math.sin(theta);
      const z = r * Math.cos(phi);
      particlePositions[i * 3] = x;
      particlePositions[i * 3 + 1] = y;
      particlePositions[i * 3 + 2] = z;
      particleBase[i * 3] = x;
      particleBase[i * 3 + 1] = y;
      particleBase[i * 3 + 2] = z;
    }
    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    const particleMat = new THREE.PointsMaterial({
      size: 0.04,
      color: 0xffffff,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const particles = new THREE.Points(particleGeo, particleMat);
    scene.add(particles);

    // ---- 地面网格反射 ----
    const ringGeo = new THREE.RingGeometry(RADIUS - 0.05, RADIUS + 0.05, 64);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.08,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.5;
    scene.add(ring);

    // 动画
    const clock = new THREE.Clock();
    const smoothData = new Float32Array(BAR_COUNT);

    const animate = () => {
      const elapsed = clock.getElapsedTime();
      const { data: freqData, hasData } = readFrequencyDataLog(BAR_COUNT);

      // 更新柱状条
      for (let i = 0; i < BAR_COUNT; i++) {
        let value;
        if (hasData) {
          value = freqData[i] || 0;
        } else {
          const wave = Math.sin(i * 0.25 + elapsed * 2) * 0.5 + 0.5;
          value = wave * 0.15;
        }
        smoothData[i] += (value - smoothData[i]) * 0.25;
        const v = smoothData[i];

        bars[i].mesh.scale.y = Math.max(0.1, v * 3.5);
        bars[i].mesh.material.opacity = 0.3 + v * 0.7;
      }

      // 整体缓慢旋转
      barGroup.rotation.y = elapsed * 0.12;

      // 粒子球脉动
      const bassEnergy = hasData
        ? freqData.slice(0, 8).reduce((a, b) => a + b, 0) / 8
        : (Math.sin(elapsed * 1.5) * 0.5 + 0.5) * 0.1;
      const midEnergy = hasData
        ? freqData.slice(8, 40).reduce((a, b) => a + b, 0) / 32
        : 0;

      const posAttr = particles.geometry.attributes.position;
      const pulseScale = 1 + bassEnergy * 0.5;
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const i3 = i * 3;
        const bx = particleBase[i3];
        const by = particleBase[i3 + 1];
        const bz = particleBase[i3 + 2];
        const wave = Math.sin(elapsed * 3 + i * 0.1) * midEnergy * 0.15;
        posAttr.array[i3] = bx * pulseScale + Math.sin(elapsed + i) * wave;
        posAttr.array[i3 + 1] = by * pulseScale + Math.cos(elapsed + i) * wave;
        posAttr.array[i3 + 2] = bz * pulseScale;
      }
      posAttr.needsUpdate = true;
      particles.rotation.y = elapsed * 0.2;
      particles.rotation.x = elapsed * 0.08;
      particleMat.opacity = 0.3 + bassEnergy * 0.5;

      // 相机微微摆动
      camera.position.x = Math.sin(elapsed * 0.15) * 0.8;
      camera.position.y = 2.5 + Math.sin(elapsed * 0.2) * 0.3;
      camera.lookAt(0, 0, 0);

      // 灯光脉动
      pointLight.intensity = 0.8 + bassEnergy * 1.5;

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
