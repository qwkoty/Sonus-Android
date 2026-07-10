# 开发规范：地形可视化重设计 — 初始平坦 + 播放时起伏 + 更惊艳

- 触发：用户反馈「地形一开始就有山峰起伏，应该初始是平的，只有播放音乐/待机动画才起伏」「不够惊艳，没什么感觉」
- 目标文件：`frontend/src/components/Visualizer3D.jsx`
- 关联：`DEV_TERRAIN_3D.md`（v1.11 地形立体化基础）、`DEV_TERRAIN_FLATTOP_FIX.md`（v1.12 平顶修复）

## 一、现状诊断

| 问题 | 当前代码 | 效果 |
|---|---|---|
| 初始就有山 | `buildBase` 中 fBm 高度 `(hN-0.35)*planeSize*0.70` 写死在**静态坐标**里 | 切到地形模式立即看到大山，无论是否播放 |
| 静态占比过大 | 动画分支 `let h = by`（by 已含大高度）+ audioH 叠加 | 音频驱动只是"在山上再抖一点"，不是"从平地长出山" |
| 待机几乎不动 | `idleBreathe = ... * 0.010 * (hasData ? 0 : 1)` | 振幅仅 1% planeSize，肉眼不可见 |
| 视觉平淡 | 色带+等高线+伪漫反射 | 功能完整但缺乏"wow"感 |

## 二、改造方案：「平静海面 → 音乐唤醒山脉」

### 核心概念

地形从**一张近乎平坦的粒子圆盘**开始（像平静水面或平原），播放音乐后**从音频能量中生长出山脉**——低频推主峰、高频雕细节。停播后山脉缓慢回落到平原。

### 1) buildBase：地形基础坐标改为平坦圆盘

```js
// 原来（静态山峰）：
basePositionsTerrain[idx * 3 + 1] = (hN - 0.35) * planeSize * 0.70;

// 改为（平坦圆盘 + 微噪避免完全共面导致的 z-fighting）：
const microNoise = (Math.sin(u*37+v*53)+Math.sin(u*71-v*19)) * 0.0008; // 极微扰动
basePositionsTerrain[idx * 3 + 1] = (-0.32 + microNoise) * planeSize; // 接近平面，略偏下
```

fBm 参数和 `terrainBand` 频段分配保留（运行时用于计算**动态山高**）。

### 2) 新增 `terrainRise` 状态变量

```js
// 在 clayFallenCount 附近新增：
let terrainRise = 0;           // 地形激活度 [0, 1]：0=平坦, 1=全高
const TERRAIN_RISE_SPEED = 1.2;  // 播放时升起速度（每秒）
const TERRAIN_FALL_SPEED = 0.5;   // 停播时回落速度（每秒）
const TERRAIN_IDLE_RISE = 0.18;   // 待机时自然微隆起（让待机也有轻微起伏感）
```

### 3) animate 中每帧更新 terrainRise

```js
// 在 clay falling 模拟之后：
if (targetShape === 'ocean' || modeRef.current === 'ocean') {
  const targetRise = hasData ? 1.0 : TERRAIN_IDLE_RISE;
  const speed = hasData ? TERRAIN_RISE_SPEED : TERRAIN_FALL_SPEED;
  terrainRise += (targetRise - terrainRise) * Math.min(1, dt * speed);
}
```

### 4) 地形动画分支重写：用 terrainRise 缩放静态山高 + 增强音频驱动

```js
} else if (targetShape === 'ocean') {
  const rN = Math.sqrt(v);
  const band = terrainBand[i];
  const energy = spectrumSmooth[band];
  const freqWeight = (1 - rN);

  // ===== 重新计算 fBm 山高（与 buildBase 同算法，但乘以 terrainRise）=====
  let terH = 0;
  terH += Math.sin(tTheta * trFreq[0] + rN * 4.0 + trPhase[0]) * 1.6;
  terH += Math.sin(tTheta * trFreq[1] - rN * 7.0 + trPhase[1]) * 0.9;
  terH += Math.sin(tTheta * trFreq[2] + rN * 13.0 + trPhase[2]) * 0.45;
  terH += Math.sin(tTheta * trFreq[3] - rN * 21.0 + trPhase[3]) * 0.22;
  const ridge = Math.abs(Math.sin(tTheta * trFreq[0] * 0.7 + rN * 11.0 + trPhase[0] * 1.3));
  terH += (ridge * 2.0 - 1.0) * 0.6;
  const radial = Math.pow(Math.max(0, 1 - rN), 1.2);
  const hN = (Math.tanh(terH * 0.4) * 0.5 + 0.5) * radial;

  // 静态山高 × 激活度（0→平, 1→全高）
  const staticH = (hN - 0.35) * planeSize * 0.70 * terrainRise;

  // 音频驱动高度（始终有效，不受 terrainRise 限制 → 播放即时响应）
  const audioH = energy * planeSize * TERRAIN_GAIN * (0.35 + freqWeight * 1.8)
                 * (hasData ? 1 : 0);  // 无音频时不加音频高度

  // 鼓点脉冲
  const beatPulseH = bassAttack * planeSize * 0.16 * (1 + beatPulseRef.current * 3.0)
                     * (0.4 + freqWeight) * terrainRise;  // 有山时才脉冲

  // 涟漪波（从中心扩散）
  const ripple = beatPulseRef.current * planeSize * 0.07
    * Math.sin(rN * 14 - time * 6) * Math.exp(-rN * 2.8) * (1 + beatFreqBoost * 0.6);

  // 待机呼吸（比原来明显 3~4 倍）
  const idleBreathe = Math.sin(time * 0.35 + rN * 6 + u * 3) * planeSize * 0.028 * (hasData ? 0 : 1);

  let h = by + staticH + audioH + beatPulseH + ripple + idleBreathe;
  h = Math.max(-planeSize * 0.30, Math.min(planeSize * 0.72, h));

  x = bx; y = h; z = bz;
  nx = 0; ny = 1; nz = 0;
}
```

### 5) 着色增强（更惊艳）

在地形着色分支中增加：

```js
// —— 新增：雾气效果（低处半透明雾）——
const fogDensity = Math.max(0, (0.20 - normH) / 0.20) * 0.45 * (1 - terrainRise * 0.7);
r += fogDensity * 0.12;
g += fogDensity * 0.14;
b += fogDensity * 0.18;

// —— 新增：动态辉光（有音乐时峰顶发光更强）——
const audioGlow = energy * 0.35 * terrainRise;
r += audioGlow * accentRGB.r * 0.4;
g += audioGlow * accentRGB.g * 0.4;
b += audioGlow * accentRGB.b * 0.5;

// —— 增强：等高线在播放时更亮 ——
const contourBoost = 1 + terrainRise * 0.8;  // 全高时等高线亮度 ×1.8
// contour *= contourBoost（在原有 contour 计算后）
```

### 6) 注意事项

- fBm 的参数（`trFreq[]`, `trPhase[]`, rng seed）必须与 buildBase 完全一致 → 已经在同一函数作用域内定义，直接复用
- `tTheta`, `rN`, `trFreq`, `trPhase`, `ridge`, `radial`, `hN` 这些变量在 buildBase 的循环中已按 (u,v) 确定；animate 循环中需要用相同的 (u,v) → `origUV[i*2]` 和 `origUV[i*2+1]` 就是 u/v，所以重新算一遍即可（确定性相同）

## 三、验收标准

- [ ] 切到地形模式时，初始状态是**近乎平坦的粒子圆盘**（无大山）
- [ ] 播放音乐后，地形**从平面逐渐升起成山脉**（低频主峰 + 高频细节），约 1~2 秒达到全高
- [ ] 停播后山脉**缓慢回落到接近平坦**
- [ ] 待机时（无音乐）有**可见的轻柔呼吸起伏**（不再是静止平面）
- [ ] 播放时整体视觉比之前更惊艳（雾气 + 峰顶辉光 + 更亮的等高线）
- [ ] `vite build` 通过

## 四、可调参数一览

| 参数 | 默认值 | 调大效果 | 调小效果 |
|---|---|---|---|
| `TERRAIN_RISE_SPEED` | 1.2 | 升起更快 | 升起更缓 |
| `TERRAIN_FALL_SPEED` | 0.5 | 回落更快 | 回落更慢（保持更久） |
| `TERRAIN_IDLE_RISE` | 0.18 | 待机时起伏更大 | 待机更平 |
| `idleBreathe` 振幅 | 0.028 | 呼吸更明显 | 呼吸更微妙 |
| `TERRAIN_GAIN` | 0.22 | 音频驱动更高 | 音频驱动更低 |
