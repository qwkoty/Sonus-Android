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
    const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 100);
    camera.position.set(0, 3.5, 6.5);
    camera.lookAt(0, 0.6, 0);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    mount.appendChild(renderer.domElement);

    // 灯光系统
    scene.add(new THREE.AmbientLight(0x223355, 0.5));
    const keyLight = new THREE.PointLight(0x4488ff, 2, 30);
    keyLight.position.set(4, 7, 4);
    scene.add(keyLight);
    const fillLight = new THREE.PointLight(0xff4466, 0.5, 30);
    fillLight.position.set(-4, 5, -3);
    scene.add(fillLight);
    const rimLight = new THREE.DirectionalLight(0xffffff, 0.4);
    rimLight.position.set(0, 8, -5);
    scene.add(rimLight);

    // ---- 同心圆环柱阵 ----
    const RINGS = [
      { count: 20, radius: 0.85, maxH: 2.6, freqRange: [0,  10] },
      { count: 28, radius: 1.55, maxH: 1.9, freqRange: [10, 24] },
      { count: 36, radius: 2.25, maxH: 1.4, freqRange: [24, 44] },
      { count: 44, radius: 2.95, maxH: 0.9, freqRange: [44, 68] },
    ];

    const allBars = [];
    const barGroup = new THREE.Group();
    scene.add(barGroup);

    for (let r = 0; r < RINGS.length; r++) {
      const ring = RINGS[r];
      const arcLen = (2 * Math.PI * ring.radius) / ring.count;
      const barW = arcLen * 1.02; // 微微重叠，确保无缝

      for (let i = 0; i < ring.count; i++) {
        const angle = (i / ring.count) * Math.PI * 2;
        const geo = new THREE.BoxGeometry(barW, 1, barW * 0.6);
        geo.translate(0, 0.5, 0);

        const t = r / (RINGS.length - 1);
        const hue = 0.6 - t * 0.08;
        const sat = 0.5 + t * 0.2;
        const lit = 0.55 - t * 0.08;
        const color = new THREE.Color().setHSL(hue, sat, lit);

        const mat = new THREE.MeshStandardMaterial({
          color,
          roughness: 0.15,
          metalness: 0.8,
          transparent: true,
          opacity: 0.9,
          emissive: color,
          emissiveIntensity: 0.2,
        });

        const bar = new THREE.Mesh(geo, mat);
        bar.position.set(Math.cos(angle) * ring.radius, 0, Math.sin(angle) * ring.radius);
        bar.lookAt(0, 0, 0);
        barGroup.add(bar);
        allBars.push({ mesh: bar, idx: i, smooth: 0, ringData: ring });
      }
    }

    // ---- 底部发光圆盘 ----
    const discGeo = new THREE.CircleGeometry(3.5, 64);
    const discMat = new THREE.MeshBasicMaterial({
      color: 0x113366,
      transparent: true,
      opacity: 0.15,
    });
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = -0.02;
    scene.add(disc);

    // 地面光环
    for (let i = 0; i < RINGS.length; i++) {
      const r = RINGS[i].radius;
      const ringGeo = new THREE.RingGeometry(r - 0.01, r + 0.01, 64);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x3377cc,
        transparent: true,
        opacity: 0.06 - i * 0.008,
        side: THREE.DoubleSide,
      });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.rotation.x = -Math.PI / 2;
      scene.add(ringMesh);
    }

    const clock = new THREE.Clock();
    const TOTAL = 72;

    const animate = () => {
      const elapsed = clock.getElapsedTime();
      const { data: spectrum, hasData } = getSpectrumBars(TOTAL);

      let bass = 0, mid = 0;
      if (hasData) {
        for (let i = 0; i < 6; i++) bass += spectrum[i] || 0;
        bass /= 6;
        for (let i = 6; i < 24; i++) mid += spectrum[i] || 0;
        mid /= 18;
      } else {
        bass = (Math.sin(elapsed * 1.5) * 0.5 + 0.5) * 0.1;
        mid = (Math.sin(elapsed * 2.2) * 0.5 + 0.5) * 0.08;
      }

      for (const bar of allBars) {
        const ring = bar.ringData;
        const [fStart, fEnd] = ring.freqRange;

        let value;
        if (hasData) {
          const freqIdx = Math.floor(fStart + (bar.idx / ring.count) * (fEnd - fStart));
          value = spectrum[Math.min(freqIdx, TOTAL - 1)] || 0;
        } else {
          const wave = Math.sin(bar.idx * 0.28 + elapsed * (1.8 + bar.ringData.radius * 0.2)) * 0.5 + 0.5;
          value = wave * 0.1;
        }

        if (value > bar.smooth) {
          bar.smooth += (value - bar.smooth) * 0.4;
        } else {
          bar.smooth += (value - bar.smooth) * 0.07;
        }

        const v = Math.max(0.03, bar.smooth);
        bar.mesh.scale.y = v * ring.maxH;
        bar.mesh.material.opacity = 0.4 + v * 0.6;
        bar.mesh.material.emissiveIntensity = 0.05 + v * 1.8;
      }

      barGroup.rotation.y = elapsed * 0.1;

      // 相机缓慢摆动
      camera.position.x = Math.sin(elapsed * 0.08) * 1.2;
      camera.position.z = 6.5 + Math.cos(elapsed * 0.06) * 0.8;
      camera.position.y = 3.2 + Math.sin(elapsed * 0.12) * 0.4;
      camera.lookAt(0, 0.7, 0);

      // 灯光脉动
      keyLight.intensity = 0.8 + bass * 3;
      fillLight.intensity = 0.2 + bass * 1.5;

      // 圆盘透明度
      discMat.opacity = 0.08 + bass * 0.15;

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
