# 开发规范：三模式节奏反应（随音频跳动）优化

- 触发：用户要求「优化液态金属 / 星河漩涡 / 地形 三个的节奏反应，随着音频而跳动」
- 目标文件：`frontend/src/components/Visualizer3D.jsx`（共享能量包络 + 三模式鼓点耦合）
- 关联：`docs/DEV_VISUALIZER_OPT_*.md`、`docs/AI_PROJECT_GUIDELINES.md`

## 现状（修改前）

| 项 | 现状 | 代码定位 |
|---|---|---|
| 低频包络 bassAttack | attack 0.55 / release 0.28（偏软，鼓点不够"跳"） | 647-648 |
| bassRelease | 0.12 | 649 |
| mid/treble 平滑 | 0.22 / 0.28 | 650-651 |
| 频谱平滑 spectrumSmooth | 单向 lerp 0.25（上升也慢 → 拖影） | 652-654 |
| 鼓点脉冲 beatPulse | 触发置 1，衰减 0.93^dt*60 | 687, 714 |
| 频率增强包络 beatFreqBoost | 衰减 0.96^dt*60 | 688, 715 |
| liquidmetal 鼓点 | bassBoost = bassPulse*0.18；位移 localPulse 含 bassAttack*0.9 | 902-903, 938 |
| galaxy 鼓点 | 切向冲击 0.14 + 径向冲击波(SHOCK_GAIN 2.2) + 核心 +0.5 | 682, 835, 1016 |
| terrain 鼓点 | 主峰脉冲 0.10*(1+beatPulse*2.5) + 中心涟漪 0.10 | 965, 969 |

## 问题分析

1. **包络太"黏"**：bassAttack 上升系数 0.55、下降 0.28，且频谱单向 0.25 平滑，导致鼓点被平滑成"渐变"而非"冲击"——视觉上不够"跳"。
2. **鼓点增益偏弱**：三模式各自鼓点位移/亮度系数偏保守，强拍时幅度变化不够醒目。
3. **缺少统一的"整体跳动"**：液态金属只有局部位移，没有"整球随拍一缩一放"的 squash；地形主峰脉冲偏温和。

## 优化方案

### 1. 共享包络提速（让节拍更"跳"）

```js
// attack 更锐、release 更快 → 鼓点清晰
if (bass > bassAttack) bassAttack += (bass - bassAttack) * 0.70;
else bassAttack += (bass - bassAttack) * 0.16;
bassRelease += (bass - bassRelease) * 0.10;
midSmooth  += (mid  - midSmooth)  * 0.30;
trebleSmooth += (treble - trebleSmooth) * 0.35;
// 频谱非对称平滑：上升快(0.45) 捕捉瞬态，下降慢(0.22) 避免闪烁
for (let i = 0; i < 64; i++) {
  const t = data[i];
  const k = t > spectrumSmooth[i] ? 0.45 : 0.22;
  spectrumSmooth[i] += (t - spectrumSmooth[i]) * k;
}
```

### 2. 鼓点冲击增益提升

- `SHOCK_GAIN` 2.2 → 2.6（galaxy 径向冲击波更明显）
- 各模式鼓点系数上调（见下）

### 3. 各模式专属"跳动"耦合

**液态金属**（增加整球 squash + 位移加强）：
```js
const localPulse = (energy * 1.25 * (1 + beatFreqBoost * LIQUID_BEAT_FREQ_GAIN)
                    + bassAttack * 1.1 + midSmooth * 0.5) * activeFactor;
const displacement = (localPulse + beatPulseRef.current * 0.5) * planeSize * 0.11;
const bassBoost = bassPulse * planeSize * 0.26 * activeFactor;
...
// 整球随拍一缩一放（squash）
const beatScale = 1 + beatPulseRef.current * 0.10 * (1 - band * 0.4);
const r = (baseR + displacement + wave + equatorWave + bassBoost + idleWave + hotDisp + dropletDisp + shimmer) * beatScale;
```

**星河漩涡**（切向冲击 + 核心 + 冲击波增强）：
```js
const beatSpin = beatPulseRef.current * planeSize * 0.20 * (1 - rN * 0.5);  // 0.14 → 0.20
// 着色
if (galaxyBulge[i]) intensity += 0.7 + bassAttack * 1.1;                   // 0.5/0.8 → 0.7/1.1
let intensity = 0.45 + bassAttack * 1.2 + localE * 1.8 * (...) + beatPulseRef.current * 1.8; // 1.5 → 1.8
```
（`SHOCK_GAIN` 2.2→2.6 已在常量区）

**地形**（主峰脉冲 + 涟漪增强、attack 随频谱提速自动生效）：
```js
const beatPulseH = bassAttack * planeSize * 0.14 * (1 + beatPulseRef.current * 3.2) * (0.4 + freqWeight); // 0.10/2.5 → 0.14/3.2
const ripple = beatPulseRef.current * planeSize * 0.13 * Math.sin(rN * 16 - time * 7) * Math.exp(-rN * 2.2) * (1 + beatFreqBoost); // 0.10 → 0.13
```

## 验收标准

- [ ] 鼓点时三模式均有明显、迅捷的"跳动/脉冲"反应（非渐变拖影）
- [ ] 低频鼓点（鼓/贝斯）触发最强烈的脉冲；高频细碎但持续
- [ ] 液态金属出现整球 squash（随拍缩放）
- [ ] 星河核心鼓点时更亮、旋臂被"甩"
- [ ] 地形主峰随鼓点隆起更夸张
- [ ] 三模式切换零回归；`vite build` + CI 通过

## 风险与回退

- 包络提速可能导致音频平淡时抖动，release 0.16 已留余量，可调回
- 各模式增益为乘性，若过曝/过抖，回调对应系数（0.20/0.14/3.2 等）
- 频谱非对称 lerp 的下降系数 0.22 控制拖影长度
- 回退：恢复原 attack/release/系数即可

## 影响范围

| 模块 | 影响 | 说明 |
|---|---|---|
| 共享包络 | 修改 | bassAttack/mid/treble/spectrumSmooth 系数 |
| SHOCK_GAIN 常量 | 修改 | 2.2 → 2.6 |
| liquidmetal | 修改 | 位移+bassBoost+beatScale |
| galaxy | 修改 | beatSpin/核心/intensity 增益 |
| terrain | 修改 | 主峰脉冲+涟漪 增益 |
| 性能 | 中性 | 频谱循环无新增开销 |
