import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { readFrequencyDataLog } from '../audio/engine';

export default function Visualizer3D({ isPlaying }) {
  const mountRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const W = mount.offsetWidth;
    const H = mount.offsetHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 100);
    camera.position.set(0, 4, 7);
    camera.lookAt(0, 0.5, 0);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    // 灯光
    scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const light1 = new THREE.PointLight(0x88ccff, 1.5, 25);
    light1.position.set(3, 6, 3);
    scene.add(light1);
    const light2 = new THREE.PointLight(0xff8866, 0.8, 25);
    light2.position.set(-3, 4, -3);
    scene.add(light2);
    const topLight = new THREE.DirectionalLight(0xffffff, 0.6);
    topLight.position.set(0, 10, 0);
    scene.add(topLight);

    // ---- 同心圆柱状条：内圈高，外圈低 ----
    const RINGS = [
      { count: 16, radius: 0.8, maxH: 3.0, freqStart: 0,  freqEnd: 8  },  // 内圈：低频，最高
      { count: 24, radius: 1.6, maxH: 2.2, freqStart: 8,  freqEnd: 24 },
      { count: 32, radius: 2.4, maxH: 1.6, freqStart: 24, freqEnd: 48 },
      { count: 40, radius: 3.2, maxH: 1.1, freqStart: 48, freqEnd: 80 },  // 外圈：高频，最矮
    ];

    const allBars = [];
    const barGroup = new THREE.Group();
    scene.add(barGroup);

    for (let r = 0; r < RINGS.length; r++) {
      const ring = RINGS[r];
      for (let i = 0; i < ring.count; i++) {
        const angle = (i / ring.count) * Math.PI * 2;
        const geo = new THREE.BoxGeometry(0.08, 1, 0.08);
        geo.translate(0, 0.5, 0); // 枢轴在底部

        // 颜色渐变：内圈暖白，外圈冷蓝
        const t = r / (RINGS.length - 1);
        const hue = 0.55 + t * 0.05; // 蓝到青
        const sat = 0.3 + t * 0.4;
        const lit = 0.65 - t * 0.15;
        const mat = new THREE.MeshStandardMaterial({
          color: new THREE.Color().setHSL(hue, sat, lit),
          roughness: 0.25,
          metalness: 0.6,
          transparent: true,
          opacity: 0.85,
          emissive: new THREE.Color().setHSL(hue, sat, lit * 0.3),
          emissiveIntensity: 0.5,
        });

        const bar = new THREE.Mesh(geo, mat);
        bar.position.set(Math.cos(angle) * ring.radius, 0, Math.sin(angle) * ring.radius);
        bar.lookAt(0, 0, 0);
        barGroup.add(bar);
        allBars.push({ mesh: bar, ring: r, idx: i, smooth: 0, ringData: ring });
      }
    }

    // ---- 地面光环 ----
    for (let i = 0; i < 3; i++) {
      const r = 0.8 + i * 0.8;
      const ringGeo = new THREE.RingGeometry(r - 0.02, r + 0.02, 64);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x4488ff,
        transparent: true,
        opacity: 0.04 - i * 0.01,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      scene.add(ring);
    }

    // 动画
    const clock = new THREE.Clock();

    const animate = () => {
      const elapsed = clock.getElapsedTime();
      const { data: freqData, hasData } = readFrequencyDataLog(80);

      let bassEnergy = 0;
      if (hasData) {
        for (let i = 0; i < 8; i++) bassEnergy += freqData[i] || 0;
        bassEnergy /= 8;
      } else {
        bassEnergy = (Math.sin(elapsed * 1.5) * 0.5 + 0.5) * 0.12;
      }

      // 更新每根柱子
      for (const bar of allBars) {
        const ring = bar.ringData;
        let value;
        if (hasData) {
          // 从该环对应的频段范围取值
          const freqIdx = Math.floor(ring.freqStart + (bar.idx / ring.count) * (ring.freqEnd - ring.freqStart));
          value = (freqData[freqIdx] || 0);
        } else {
          const wave = Math.sin(bar.idx * 0.3 + elapsed * (2 + bar.ring * 0.5)) * 0.5 + 0.5;
          value = wave * 0.15 * (1 - bar.ring * 0.15);
        }

        bar.smooth += (value - bar.smooth) * 0.22;
        const v = bar.smooth;

        bar.mesh.scale.y = Math.max(0.08, v * ring.maxH);
        bar.mesh.material.opacity = 0.4 + v * 0.6;
        bar.mesh.material.emissiveIntensity = 0.2 + v * 1.2;
      }

      // 整体旋转
      barGroup.rotation.y = elapsed * 0.15;

      // 相机缓慢摆动
      camera.position.x = Math.sin(elapsed * 0.12) * 1.2;
      camera.position.z = 6.5 + Math.cos(elapsed * 0.1) * 0.8;
      camera.position.y = 3.5 + Math.sin(elapsed * 0.18) * 0.4;
      camera.lookAt(0, 0.8, 0);

      // 灯光脉动
      light1.intensity = 0.8 + bassEnergy * 2.0;
      light2.intensity = 0.4 + bassEnergy * 1.2;

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
