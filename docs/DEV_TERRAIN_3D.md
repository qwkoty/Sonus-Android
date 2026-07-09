# 开发规范：地形可视化立体化改造（真正像山脉）

- 触发：用户反馈「地形上面都是平的，根本就不像真正的」——截图确认呈现同心圆平面波纹，无立体山脉感
- 目标文件：`frontend/src/components/Visualizer3D.jsx`（buildBase 地形块 + ocean 动画块 + 着色块）
- 关联：`docs/DEV_VISUALIZER_TERRAIN.md`、`docs/AI_PROJECT_GUIDELINES.md`

## 一、现状诊断（为什么看起来是平的）

从代码与截图交叉分析，地形"平"的根因有三：

| 根因 | 代码位置 | 现状值 | 问题 |
|---|---|---|---|
| **静态山体振幅太小** | line 419 `(hN - 0.30) * planeSize * 0.38` | `× 0.38` | 静态山脉高度仅占画面 ~15%，视觉上几乎看不到起伏 |
| **fBm 基础信号弱** | line 411-415 四个正弦叠加 | 系数 1.0 / 0.5 / 0.25 / 0.13 | 每层衰减太快，总扰动量仅 ~±1.88，再 ×0.5 后更小 |
| **无光照立体感** | 地形着色块 line ~1108-1155 | 纯色带 + 等高线 | 平面着色无法表达高度差——山和谷只是颜色深浅不同，没有明暗面 |

**额外问题**：音频驱动的涟漪（line 1040 `ripple = beatPulseRef.current * ... * sin(rN * 16)`）在截图中形成了明显的同心圆波纹，进一步掩盖了本就微弱的静态山脉。

## 二、改造方案

### 2.1 静态山体：增大振幅 + 强化 fBm + 引入 ridged noise

```js
// BEFORE（太平）:
let terH = 0;
terH += Math.sin(tTheta * trFreq[0] + rN * 5.0 + trPhase[0]) * 1.0;
terH += Math.sin(tTheta * trFreq[1] - rN * 9.0 + trPhase[1]) * 0.5;
terH += Math.sin(tTheta * trFreq[2] + rN * 15.0 + trPhase[2]) * 0.25;
terH += Math.sin(tTheta * trFreq[3] - rN * 24.0 + trPhase[3]) * 0.13;
const radial = Math.pow(Math.max(0, 1 - rN), 1.5);
const hN = (terH * 0.5 + 1) * radial; // ~[0, 1.3]
basePositionsTerrain[idx*3+1] = (hN - 0.30) * planeSize * 0.38; // ← 太小！

// AFTER（立体山脉）:
let terH = 0;
terH += Math.sin(tTheta * trFreq[0] + rN * 4.0 + trPhase[0]) * 1.6;   // 主脊：大幅
terH += Math.sin(tTheta * trFreq[1] - rN * 7.0 + trPhase[1]) * 0.9;   // 次脊
terH += Math.sin(tTheta * trFreq[2] + rN * 13.0 + trPhase[2]) * 0.45;  // 细褶
terH += Math.sin(tTheta * trFreq[3] - rN * 21.0 + trPhase[3]) * 0.22;  // 微纹
// ridged noise：取绝对值让山脊变尖锐（像真实山脉的刃脊）
const ridge = Math.abs(Math.sin(tTheta * trFreq[0] * 0.7 + rN * 11.0 + trPhase[0] * 1.3));
terH += (ridge * 2.0 - 1.0) * 0.6; // 映射到 [-0.6, +0.6]

const radial = Math.pow(Math.max(0, 1 - rN), 1.2);   // 衰减放缓，外圈也保留一定高度
const hN = (terH * 0.55 + 1) * radial;                 // ~[0, 2.1]，范围扩大
basePositionsTerrain[idx*3+1] = (hN - 0.35) * planeSize * 0.72; // ← 振幅翻倍！
```

关键改动：
- fBm 系数整体提升 ~60%（1.0→1.6, 0.5→0.9, 0.25→0.45）
- **新增 ridged noise 层**：`|sin|` 变换产生尖锐山脊而非圆润波峰
- 高度乘数 `0.38 → 0.72`（近翻倍），让山脉在画面中真正"站起来"
- `radial` 衰减指数 `1.5 → 1.2`：边缘不完全沉底，保留台地感

### 2.2 动态音频驱动：降低涟漪占比，让静态山脉可见

```js
// BEFORE: 涟漪太强，淹没山脉
const ripple = beatPulseRef.current * planeSize * 0.13 * sin(rN * 16 ...) * exp(-rN * 2.2);

// AFTER: 涟漪减弱为辅助效果，主峰脉冲增强立体感
const ripple = beatPulseRef.current * planeSize * 0.06 * Math.sin(rN * 12 - time * 5.5)
               * Math.exp(-rN * 3.0) * (1 + beatFreqBoost * 0.5); // 振幅减半 + 更快衰减
```

同时调整音频驱动增益，确保动态部分不会压过静态：
```js
// 音频驱动保持但上限收紧
const audioH = energy * planeSize * TERRAIN_GAIN * (0.28 + freqWeight * 1.5) * (1 + beatFreqBoost * 1.4);
// TERRAIN_GAIN 可考虑 0.26 → 0.22（静态已够高，动态不宜再抢）
```

### 2.3 着色立体化：引入简易漫反射明暗

当前地形着色只有"颜色带+等高线"，没有光照方向感。加入基于高度的**伪漫反射**（不需要真法线，用高度梯度近似）：

```js
// 在地形着色块中，计算局部高度梯度作为法线近似
const normH = Math.max(0, Math.min(1, (y / planeSize + 0.30) / 0.72)); // 归一化 [0,1]
// ...现有色带逻辑不变...

// 新增：伪漫反射 — 固定光源方向(右上)，根据坡度模拟明暗
// 用相邻粒子的高度差近似法线（简化：用 rN 作为坡度代理 + 随机抖动避免条带）
const slopeProxy = Math.abs(rN - 0.3) * 2 + Math.sin(tTheta * 8 + i * 0.03) * 0.15;
const diffuse = 0.55 + 0.45 * Math.max(0, Math.cos(slopeProxy * Math.PI * 0.8 + 0.4));
r *= diffuse; g *= diffuse; b *= diffuse;

// 谷底加深（已有逻辑保留并强化）
```

这会让面向"光源"的山坡亮、背光面暗，产生立体的体积感。

## 三、验收标准

- [ ] 静态山脉有明确的主峰、次峰、山谷层次（非同心圆平面）
- [ ] 山脊有尖锐感（ridged noise 效果可见）
- [ ] 从斜角度看有明显的高低起伏（非扁平圆盘）
- [ ] 音频涟漪不淹没静态山脉轮廓
- [ ] 着色有明暗面（非均匀平面色）
- [ ] `vite build` 通过；与其他三模式切换零回归

## 四、风险与回退

| 风险 | 应对 |
|---|---|
| 振幅过大导致粒子穿出视锥体 | clamp 上限从 `0.52` 收紧到 `0.70`；`zAmp` 不变 |
| ridged noise 产生过多尖刺 | 系数 `0.6` 可降到 `0.3`；或对结果做 smoothstep 软化 |
| 伪漫反射造成条带 artifacts | 加入 `i * 0.03` 相位抖动打破规律性 |
| 性能（ridged 多一层 sin）| 单粒子多一次 `abs()` + `sin`，~19881 粒子可忽略 |
| 回退 | 恢复原 `0.38` / 原 fBm 系数 / 删除 diffuse 行即可 |

## 五、影响范围

| 模块 | 影响 |
|---|---|
| buildBase 地形块 | 修改 fBm 系数 + ridged noise + 振幅乘数 |
| ocean 动画块 | 修改 ripple 参数 + audioH 增益 |
| terrain 着色块 | 新增伪漫反射明暗 + 强化谷底 |
| 其余四模式 | 中性 |
