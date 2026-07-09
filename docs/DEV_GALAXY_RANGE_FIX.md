# 开发规范：星河漩涡音频范围扩大 + 去除鼓点冲击波

- 触发：用户反馈「星河漩涡跟随音频跳动的节奏再做好一点，范围大一点，主要是现在范围太小了。然后鼓点打击去掉」
- 目标文件：`frontend/src/components/Visualizer3D.jsx`（galaxy 动画分支 + 着色 + 鼓点检测）

## 一、现状诊断

| 项 | 现状值 | 问题 |
|---|---|---|
| 径向涟漪振幅 | `planeSize * 0.045` | 太小，几乎看不见 |
| 径向频谱柱 | `planeSize * 0.10` | 太小 |
| 低频核球呼吸 | `planeSize * 0.08` | 太小 |
| 垂直音浪 ZWave | `planeSize * 0.04` | 太小 |
| 臂波动 armWave | `planeSize * 0.012` | 极小 |
| 切向冲击 beatSpin | `planeSize * 0.20 * beatPulse` | 用户要**去掉** |
| 冲击波 SHOCK_GAIN | `2.6` → `explodeVel` 注入 | 用户要**去掉** galaxy 的鼓点冲击 |

## 二、方案

### 2.1 扩大所有音频驱动振幅（×2~3）

```js
// 径向涟漪（原 0.045 → 0.12）
const ripple = Math.sin(rN * RIPPLE_FREQ - time * RIPPLE_SPEED) * spectrumSmooth[band]
             * planeSize * 0.12 * (1 + beatFreqBoost * GALAXY_BEAT_FREQ_GAIN);

// 径向频谱柱（原 0.10 → 0.24）
const radialSpectrum = spectrumSmooth[band] * planeSize * 0.24 * (1 + beatFreqBoost * GALAXY_BEAT_FREQ_GAIN);

// 低频核球呼吸（原 0.08 → 0.18）
const bassPush = bassAttack * planeSize * 0.18 * Math.pow(1 - rN, 1.4);

// 垂直音浪（原 0.04 → 0.10）
const zWave = spectrumSmooth[band] * planeSize * 0.10 * (1 + beatFreqBoost) * Math.sin(rN * 8 + time * 3);

// 臂波动（原 0.012 → 0.03）
const armWave = ... * planeSize * 0.03 * (1 + beatFreqBoost * 0.6);
```

### 2.2 去掉鼓点冲击波对 galaxy 的影响

在鼓点检测块中，当模式为 galaxy 时**不注入 explodeVel**：

```js
// BEFORE: 所有模式都受 SHOCK_GAIN 影响
const imp = Math.min(1, bass) * SHOCK_GAIN * planeSize * 0.10;
for (let i = 0; i < COUNT; i++) {
  explodeVel[i*3] += galaxyUX[i] * imp;   // ← 这行去掉
  explodeVel[i*3+1] += galaxyUY[i] * imp; // ← 这行去掉
}

// AFTER: 仅非 galaxy 模式接收冲击波
const isGalaxyMode = modeRef.current === 'galaxy';
if (!isGalaxyMode) {
  const imp = Math.min(1, bass) * SHOCK_GAIN * planeSize * 0.10;
  for (let i = 0; i < COUNT; i++) {
    explodeVel[i*3] += galaxyUX[i] * imp;
    explodeVel[i*3+1] += galaxyUY[i] * imp;
  }
}
```

同时去掉 galaxy 的 **beatSpin**（切向冲击）和 **beatPulseRef 对 galaxy 位移的影响**（保留对亮度的微弱增强即可）：

```js
// 删除或注释掉：
const beatSpin = beatPulseRef.current * planeSize * 0.20 * (1 - rN * 0.5); // ← 删
x += -ny * beatSpin; // ← 删
y += nx * beatSpin; // ← 删

// intensity 中保留微弱的 beatPulse 亮度增强（可选保留或也去掉）
```

## 三、验收标准

- [ ] 星河旋臂随音频的径向扩张/收缩幅度明显增大（肉眼可见的"呼吸"感）
- [ ] 核球随低频明显膨胀/收缩
- [ ] 鼓点不再产生切向"甩动"和径向冲击波（平滑跟随频谱即可）
- [ ] `vite build` 通过

## 四、影响范围

仅影响 galaxy 动画分支和鼓点注入块。其余三模式不变。
