import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { getSpectrumBars } from '../audio/engine';
import { getProxyUrl } from '../api/music';

const GRID = 142;             // 142x142 = 20164 ≈ 2 万粒子
const FOV = 55;

function hexToRGB(hex) {
  const c = hex.replace('#', '');
  const bigint = parseInt(c.length === 3 ? c.split('').map(x => x + x).join('') : c, 16);
  return {
    r: ((bigint >> 16) & 255) / 255,
    g: ((bigint >> 8) & 255) / 255,
    b: (bigint & 255) / 255,
  };
}

// 圆形粒子纹理：让点变成柔和的圆点，而非方形像素
function createParticleTexture() {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.42, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

// 3D 封面粒子画：2 万粒子构成可切换的动画形态
// 电影镜头：用户双指捏合缩放 + 双指划拉旋转（手势驱动），同时自动 360° 旋转
// 动画预设：silk（丝绸穹顶） / sphere（星球轨道） / tunnel（音律隧道） / ripple（涟漪封面）
export default function Visualizer3D({ accent = '#4FC3F7', cover = '', mode = 'silk', onReady }) {
  const containerRef = useRef(null);
  const accentRef = useRef(accent);
  const coverRef = useRef(cover);
  const imageDataRef = useRef(null);  // 封面像素 RGBA
  const hasCoverRef = useRef(false);
  const coverVersionRef = useRef(0);
  const appliedCoverVersionRef = useRef(-1);
  const onReadyRef = useRef(onReady);
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);
  useEffect(() => { accentRef.current = accent; }, [accent]);
  useEffect(() => { coverRef.current = cover; }, [cover]);

  // 手势状态（双指缩放 + 旋转；单指划动旋转）
  const gestureRef = useRef({
    zoom: 1.0,
    rotation: 0,
    targetZoom: 1.0,
    targetRotation: 0,
    pinching: false,
    startDist: 0,
    startAngle: 0,
    startZoom: 1.0,
    startRot: 0,
    dragging: false,
    startX: 0,
  });

  // 加载封面并采样为 ImageData
  useEffect(() => {
    coverVersionRef.current += 1;
    if (!cover) { imageDataRef.current = null; hasCoverRef.current = false; return; }
    let cancelled = false;
    (async () => {
      try {
        const proxyUrl = await getProxyUrl(cover);
        if (cancelled) return;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          if (cancelled) return;
          try {
            const SIZE = GRID;
            const c = document.createElement('canvas');
            c.width = SIZE; c.height = SIZE;
            const cx = c.getContext('2d');
            const iw = img.width, ih = img.height;
            const s = Math.min(iw, ih);
            const sx = (iw - s) / 2, sy = (ih - s) / 2;
            cx.drawImage(img, sx, sy, s, s, 0, 0, SIZE, SIZE);
            imageDataRef.current = cx.getImageData(0, 0, SIZE, SIZE).data;
            hasCoverRef.current = true;
          } catch (e) {
            imageDataRef.current = null;
            hasCoverRef.current = false;
          }
        };
        img.onerror = () => { imageDataRef.current = null; hasCoverRef.current = false; };
        img.src = proxyUrl;
      } catch {
        const img = new Image();
        img.onload = () => {
          if (cancelled) return;
          try {
            const SIZE = GRID;
            const c = document.createElement('canvas');
            c.width = SIZE; c.height = SIZE;
            const cx = c.getContext('2d');
            const iw = img.width, ih = img.height;
            const s = Math.min(iw, ih);
            const sx = (iw - s) / 2, sy = (ih - s) / 2;
            cx.drawImage(img, sx, sy, s, s, 0, 0, SIZE, SIZE);
            imageDataRef.current = cx.getImageData(0, 0, SIZE, SIZE).data;
            hasCoverRef.current = true;
          } catch {
            imageDataRef.current = null;
            hasCoverRef.current = false;
          }
        };
        img.onerror = () => { imageDataRef.current = null; hasCoverRef.current = false; };
        img.src = cover;
      }
    })();
    return () => { cancelled = true; };
  }, [cover]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const shape = mode || 'silk';

    const dpr = window.devicePixelRatio || 1;
    let W = container.offsetWidth;
    let H = container.offsetHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV, W / H, 0.1, 5000);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(dpr);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    container.appendChild(renderer.domElement);

    const FILL = 1.0;
    const MAX_Z_RATIO = 0.09;
    const DOME_DEPTH_RATIO = 0.22;       // 穹顶弯曲，比之前更圆润
    const SPHERE_RADIUS_RATIO = 0.78;
    const TUNNEL_RADIUS_RATIO = 0.55;

    let planeSize, cameraZ;

    const computeLayout = () => {
      W = container.offsetWidth;
      H = container.offsetHeight;
      const aspect = W / H;
      const minDim = Math.min(W, H);
      cameraZ = minDim * 2.4;
      const halfFovRad = (FOV / 2) * Math.PI / 180;
      const visibleHalf = cameraZ * Math.tan(halfFovRad);
      planeSize = visibleHalf * FILL;
      camera.aspect = aspect;
      camera.position.z = cameraZ;
      camera.updateProjectionMatrix();
    };
    computeLayout();

    const COUNT = GRID * GRID;
    const positions = new Float32Array(COUNT * 3);
    const colors = new Float32Array(COUNT * 3);
    const origUV = new Float32Array(COUNT * 2);
    const distFromCenter = new Float32Array(COUNT);
    const basePositions = new Float32Array(COUNT * 3);
    const baseNormals = new Float32Array(COUNT * 3);

    const buildBase = () => {
      let idx = 0;
      const half = planeSize;
      const step = (planeSize * 2) / (GRID - 1);
      for (let gy = 0; gy < GRID; gy++) {
        for (let gx = 0; gx < GRID; gx++) {
          const x = -half + gx * step;
          const y = half - gy * step;
          const u = gx / (GRID - 1);
          const v = gy / (GRID - 1);
          const dx = u - 0.5, dy = v - 0.5;
          const dc = Math.min(1, Math.sqrt(dx * dx + dy * dy) * 2);
          origUV[idx * 2] = u;
          origUV[idx * 2 + 1] = v;
          distFromCenter[idx] = dc;

          let bx = 0, by = 0, bz = 0, nx = 0, ny = 0, nz = 0;
          if (shape === 'sphere') {
            const theta = u * Math.PI * 2;
            const phi = (v - 0.5) * Math.PI;
            const r = planeSize * SPHERE_RADIUS_RATIO;
            bx = r * Math.cos(phi) * Math.cos(theta);
            by = r * Math.sin(phi);
            bz = r * Math.cos(phi) * Math.sin(theta);
            const len = Math.hypot(bx, by, bz) || 1;
            nx = bx / len; ny = by / len; nz = bz / len;
          } else if (shape === 'tunnel') {
            const theta = u * Math.PI * 2;
            const r = planeSize * TUNNEL_RADIUS_RATIO;
            bx = r * Math.cos(theta);
            by = r * Math.sin(theta);
            bz = (v - 0.5) * planeSize * 2.2;
            const len = Math.hypot(bx, by) || 1;
            nx = bx / len; ny = by / len; nz = 0;
          } else if (shape === 'ripple') {
            bx = x; by = y; bz = 0;
            nx = 0; ny = 0; nz = 1;
          } else {
            // silk（默认）
            bx = x; by = y;
            bz = -planeSize * DOME_DEPTH_RATIO * (1 - Math.cos(dc * Math.PI / 2));
            nx = 0; ny = 0; nz = 1;
          }
          basePositions[idx * 3] = bx;
          basePositions[idx * 3 + 1] = by;
          basePositions[idx * 3 + 2] = bz;
          baseNormals[idx * 3] = nx;
          baseNormals[idx * 3 + 1] = ny;
          baseNormals[idx * 3 + 2] = nz;

          positions[idx * 3] = bx;
          positions[idx * 3 + 1] = by;
          positions[idx * 3 + 2] = bz;
          idx++;
        }
      }
    };
    buildBase();

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: planeSize * 2 / GRID * 1.0,    // 填充比 1，粒子紧密相连
      map: createParticleTexture(),
      vertexColors: true,
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
      sizeAttenuation: true,
      alphaTest: 0.05,
      blending: THREE.NormalBlending,
    });

    const points = new THREE.Points(geometry, material);
    scene.add(points);

    let raf;
    const posAttr = geometry.attributes.position;
    const colorAttr = geometry.attributes.color;

    const sampleCover = (u, v) => {
      const d = imageDataRef.current;
      if (!d) return null;
      const px = Math.min(GRID - 1, Math.max(0, Math.floor(u * GRID)));
      const py = Math.min(GRID - 1, Math.max(0, Math.floor(v * GRID)));
      const i = (py * GRID + px) * 4;
      return [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255];
    };

    const applyCoverColors = () => {
      if (!hasCoverRef.current) return false;
      for (let i = 0; i < COUNT; i++) {
        const u = origUV[i * 2];
        const v = origUV[i * 2 + 1];
        const s = sampleCover(u, v);
        const boost = 0.95;
        const minBright = 0.12;
        colorAttr.array[i * 3]     = Math.max(s[0] * boost, minBright * (0.6 + s[0]));
        colorAttr.array[i * 3 + 1] = Math.max(s[1] * boost, minBright * (0.6 + s[1]));
        colorAttr.array[i * 3 + 2] = Math.max(s[2] * boost, minBright * (0.6 + s[2]));
      }
      colorAttr.needsUpdate = true;
      return true;
    };

    let firstFrame = true;
    let bassAttack = 0;
    let bassRelease = 0;
    let midSmooth = 0;
    let trebleSmooth = 0;

    const animate = () => {
      const { data, hasData } = getSpectrumBars(64);

      let bass = 0, mid = 0, treble = 0;
      if (hasData) {
        for (let i = 0; i < 8; i++) bass += data[i];
        bass /= 8;
        for (let i = 8; i < 32; i++) mid += data[i];
        mid /= 24;
        for (let i = 32; i < 64; i++) treble += data[i];
        treble /= 32;
      } else {
        const t = Date.now() * 0.001;
        bass = 0.20 + Math.sin(t * 0.60) * 0.10 + Math.sin(t * 1.25) * 0.06;
        mid = 0.14 + Math.sin(t * 0.90 + 1) * 0.07;
        treble = 0.10 + Math.sin(t * 1.20 + 2) * 0.05;
      }
      if (bass > bassAttack) bassAttack += (bass - bassAttack) * 0.55;
      else bassAttack += (bass - bassAttack) * 0.28;
      bassRelease += (bass - bassRelease) * 0.12;
      midSmooth += (mid - midSmooth) * 0.22;
      trebleSmooth += (treble - trebleSmooth) * 0.28;

      const bassPulse = Math.max(0, bassAttack - bassRelease);
      const totalEnergy = (bassAttack + midSmooth * 0.7 + trebleSmooth * 0.4) / 2.1;

      const time = Date.now() * 0.001;
      const breath = 1 + Math.sin(time * 0.6) * 0.020 + totalEnergy * 0.06 + bassPulse * 0.10;
      const zAmp = planeSize * MAX_Z_RATIO;
      const hasCover = hasCoverRef.current;

      if (hasCover && appliedCoverVersionRef.current !== coverVersionRef.current) {
        if (applyCoverColors()) appliedCoverVersionRef.current = coverVersionRef.current;
      }

      const needColorUpdate = !hasCover;
      const windSpeed = 1.6;
      const accentRGB = hexToRGB(accentRef.current || '#4FC3F7');

      for (let i = 0; i < COUNT; i++) {
        const u = origUV[i * 2];
        const v = origUV[i * 2 + 1];
        const dc = distFromCenter[i];
        const bx = basePositions[i * 3];
        const by = basePositions[i * 3 + 1];
        const bz = basePositions[i * 3 + 2];
        const nx = baseNormals[i * 3];
        const ny = baseNormals[i * 3 + 1];
        const nz = baseNormals[i * 3 + 2];

        let x = bx, y = by, z = bz;

        if (shape === 'sphere') {
          // 星球：径向呼吸 + 高频闪烁 + 鼓点冲击
          const flare = trebleSmooth * Math.sin(u * Math.PI * 6 + time * 2.8 + v * Math.PI * 4) * 0.55;
          const disp = (totalEnergy * 0.35 + bassPulse * 1.2 * Math.exp(-dc * dc * 2) + flare) * planeSize * 0.30;
          x += nx * disp;
          y += ny * disp;
          z += nz * disp;
        } else if (shape === 'tunnel') {
          // 隧道：半径随节奏脉动，整体像音波管一样旋转
          const wave = Math.sin(u * Math.PI * 8 + time * 1.8) * Math.cos(v * Math.PI * 4 + time * 0.7) * (midSmooth * 0.35);
          const radiusMod = 1 + bassPulse * 0.30 + midSmooth * 0.18 + wave;
          x = bx * radiusMod;
          y = by * radiusMod;
          z = bz + (wave + trebleSmooth * Math.sin(u * Math.PI * 12 + time * 3) * 0.2) * planeSize * 0.05;
        } else if (shape === 'ripple') {
          // 涟漪：由中心向外扩散的环形波，鼓点像水滴落下
          const ring = Math.sin(dc * 14 - time * 2.8) * Math.exp(-dc * 1.6) * (0.45 + totalEnergy * 0.9);
          const impact = bassPulse * Math.exp(-dc * dc * 3.5) * 1.6;
          z = (ring + impact) * planeSize * 0.14;
        } else {
          // silk（丝绸穹顶）：液体绸缎波动 + 鼓皮膨胀
          const wave1 = Math.sin(u * 4 * Math.PI + time * windSpeed) * 0.22;
          const wave2 = Math.sin(v * 3 * Math.PI + time * windSpeed * 0.8 + 1.2) * 0.18;
          const wave3 = Math.sin((u + v) * 5 * Math.PI + time * windSpeed * 1.3) * 0.10;
          const swirl = Math.sin(dc * 8 - time * 1.2) * 0.08;
          const windZ = (wave1 + wave2 + wave3 + swirl) * (1 + totalEnergy * 0.4);
          const inflate = totalEnergy * Math.cos(dc * Math.PI / 2) * 0.7;
          const pulse = bassPulse * Math.exp(-dc * dc * 4) * 1.3;
          z = bz + (windZ + inflate + pulse) * zAmp;
        }

        posAttr.array[i * 3] = x;
        posAttr.array[i * 3 + 1] = y;
        posAttr.array[i * 3 + 2] = z;

        if (needColorUpdate) {
          const windGlow = Math.abs(z - bz) / (planeSize * 0.12 + 0.001) * 0.12;
          const intensity = 0.18 + totalEnergy * 1.4 + windGlow;
          const outFactor = 1 - dc * 0.35;
          colorAttr.array[i * 3]     = Math.min(1, accentRGB.r * intensity * outFactor + bassPulse * 0.5);
          colorAttr.array[i * 3 + 1] = Math.min(1, accentRGB.g * intensity * outFactor + bassPulse * 0.5);
          colorAttr.array[i * 3 + 2] = Math.min(1, accentRGB.b * intensity * outFactor + bassPulse * 0.5 + windGlow * 0.3);
        }
      }
      posAttr.needsUpdate = true;
      if (needColorUpdate) colorAttr.needsUpdate = true;

      // 电影镜头：手势驱动 + 自动 360° 旋转
      const g = gestureRef.current;
      g.zoom += (g.targetZoom - g.zoom) * 0.18;
      g.rotation += (g.targetRotation - g.rotation) * 0.18;
      const clampedZoom = Math.max(0.4, Math.min(3.0, g.zoom));
      camera.position.z = cameraZ / clampedZoom;
      // 自动持续旋转（每秒约 0.08rad ≈ 360°/78s，优雅不晕）
      points.rotation.y = g.rotation + time * 0.08;
      points.rotation.x = -0.12 + Math.sin(time * 0.5) * 0.03;
      points.rotation.z = Math.cos(time * 0.4) * 0.015;
      camera.position.x = 0;
      camera.position.y = 0;
      camera.lookAt(0, 0, 0);

      const sc = breath;
      points.scale.set(sc, sc, 1);

      renderer.render(scene, camera);

      if (firstFrame) {
        firstFrame = false;
        if (onReadyRef.current) onReadyRef.current();
      }
      raf = requestAnimationFrame(animate);
    };
    animate();

    // 手势控制
    const dom = renderer.domElement;
    const dist = (t1, t2) => Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
    const angle = (t1, t2) => Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX);
    const ROTATE_SENSITIVITY = 0.006;
    const onTouchStart = (e) => {
      const g = gestureRef.current;
      if (e.touches.length === 1) {
        g.dragging = true;
        g.startX = e.touches[0].clientX;
        g.startRot = g.targetRotation;
      } else if (e.touches.length === 2) {
        g.pinching = true;
        g.dragging = false;
        g.startDist = dist(e.touches[0], e.touches[1]);
        g.startAngle = angle(e.touches[0], e.touches[1]);
        g.startZoom = g.targetZoom;
        g.startRot = g.targetRotation;
      }
    };
    const onTouchMove = (e) => {
      const g = gestureRef.current;
      if (g.pinching && e.touches.length === 2) {
        e.preventDefault();
        const d = dist(e.touches[0], e.touches[1]);
        const a = angle(e.touches[0], e.touches[1]);
        const scale = d / Math.max(1, g.startDist);
        g.targetZoom = Math.max(0.4, Math.min(3.0, g.startZoom * scale));
        g.targetRotation = g.startRot + (a - g.startAngle);
      } else if (g.dragging && e.touches.length === 1) {
        e.preventDefault();
        const dx = e.touches[0].clientX - g.startX;
        g.targetRotation = g.startRot + dx * ROTATE_SENSITIVITY;
      }
    };
    const onTouchEnd = (e) => {
      const g = gestureRef.current;
      if (e.touches.length < 2) g.pinching = false;
      if (e.touches.length < 1) g.dragging = false;
    };
    const onWheel = (e) => {
      const g = gestureRef.current;
      g.targetZoom = Math.max(0.4, Math.min(3.0, g.targetZoom * (e.deltaY > 0 ? 0.92 : 1.08)));
    };
    dom.style.touchAction = 'none';
    dom.addEventListener('touchstart', onTouchStart, { passive: false });
    dom.addEventListener('touchmove', onTouchMove, { passive: false });
    dom.addEventListener('touchend', onTouchEnd);
    dom.addEventListener('wheel', onWheel, { passive: true });

    const handleResize = () => {
      computeLayout();
      buildBase();
      posAttr.needsUpdate = true;
      material.size = planeSize * 2 / GRID * 1.0;
      renderer.setSize(W, H);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', handleResize);
      dom.removeEventListener('touchstart', onTouchStart);
      dom.removeEventListener('touchmove', onTouchMove);
      dom.removeEventListener('touchend', onTouchEnd);
      dom.removeEventListener('wheel', onWheel);
      renderer.dispose();
      geometry.dispose();
      material.dispose();
      if (material.map) material.map.dispose();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }, [mode]);

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
