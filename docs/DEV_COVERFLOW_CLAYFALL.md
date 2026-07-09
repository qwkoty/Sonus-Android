# 开发规范：粒子封面「腻子脱落」动画改造

- 触发：用户反馈截图显示当前错层封面把粒子按 `i%4` 硬分四层 → 封面图案完全打碎，看不出专辑图了。用户要的效果：**一开始全部在第一层（完整清晰封面），播放时个别粒子像腻子碎屑一样掉到后层再浮回来**
- 目标文件：`frontend/src/components/Visualizer3D.jsx`

## 一、现状诊断

| 问题 | 现状代码 | 效果 |
|---|---|---|
| 静态分层 | `coverLayer[idx] = idx % COVER_LAYERS` | 每个粒子固定属于某一层，封面永远被拆成4份 |
| 封面不可读 | 后三层亮度衰减 0.8/0.5/0.25 | 即使前层也只占 25% 粒子，图案稀疏无法辨认 |
| 无动态脱落 | 层分配是静态的 | 不会随时间/音频"掉下去浮回来" |

## 二、改造方案：每粒子独立腻子状态

### 核心机制

每个粒子有独立的 **"腻子深度值"** `clayDepth ∈ [0, 1]`：
- **0 = 第一层（最前）**：显示完整封面色、最亮
- **1 = 最后层（最后）**：显示主题色光晕、最暗

初始状态：**全部 `clayDepth = 0`**（所有粒子在前层 → 完整清晰封面）

播放时驱动：
- **随机脱落**：每帧有极小概率选一些粒子开始"下沉"
- **频谱驱动脱落**：高频能量高的区域更容易"脱落"（像被音乐震松）
- **自动回弹**：沉到底的粒子会缓慢浮回前层（腻子的"粘性"）
- **平滑过渡**：用 ease-in-out 插值，不是瞬移

```js
// 新增缓冲区（替代静态 coverLayer）
const clayDepth = new Float32Array(COUNT);      // 每粒子当前深度 [0,1]
const clayTarget = new Float32Array(COUNT);     // 每粒子目标深度 [0,1]
const clayVel = new Float32Array(COUNT);         // 每粒子深度变化速度
const CLAY_FALL_RATE = 0.002;                   // 每帧随机脱落概率（约0.2%/帧 ≈ 40粒子/秒）
const CLAY_RETURN_SPEED = 0.15;                 // 回弹速度（每帧向0靠近的系数）
const CLAY_SPECTRUM_TRIGGER = 0.6;              // 频谱超过此值触发该粒子脱落
```

### 动画循环逻辑（每帧在 animate 中执行）

```js
// 1. 随机脱落（始终少量进行）
if (!hasData || Math.random() < 0.3) {
  for (let fi = 0; fi < COUNT * CLAY_FALL_RATE + 1; fi++) {
    const ri = Math.floor(Math.random() * COUNT);
    if (clayDepth[ri] < 0.15) {
      // 从前层脱落到随机后层深度
      clayTarget[ri] = 0.5 + Math.random() * 0.5; // 掉到 0.5~1.0
    }
  }
}

// 2. 频谱驱动脱落（播放中：高频区域更易脱落）
if (hasData) {
  for (let di = 0; di < COUNT; di += 20) { // 每20个粒子抽检一次（性能）
    const ri = (di + Math.floor(time * 30)) % COUNT;
    const bandIdx = Math.min(63, Math.floor(distFromCenter[ri] * 63));
    if (spectrumSmooth[bandIdx] > CLAY_SPECTRUM_TRIGGER && clayDepth[ri] < 0.2 && Math.random() < 0.08) {
      clayTarget[ri] = 0.4 + Math.random() * 0.6;
    }
  }
}

// 3. 每粒子弹簧积分（深度过渡）
for (let ci = 0; ci < COUNT; ci++) {
  const diff = clayTarget[ci] - clayDepth[ci];
  clayVel[ci] += diff * 8.0 * dt;           // 弹簧力
  clayVel[ci] *= Math.pow(0.92, dt * 60);   // 阻尼
  clayDepth[ci] += clayVel[ci] * dt;
  // 自动回弹：目标缓慢衰减回0
  clayTarget[ci] *= Math.pow(0.995, dt * 60);
}
```

### 在 coverflow 动画分支中使用 clayDepth

```js
} else if (targetShape === 'coverflow') {
  const cd = clayDepth[i]; // 该粒子当前深度 [0,1]
  const layerZ = cd * planeSize * LAYER_GAP * 3;  // 深度映射到Z偏移

  // 腻子有机位移（深层的粒子扰动更大——更像松散的腻子）
  const clayWob = (Math.sin(u * 3 + time * 0.5 + clayPhaseX[i]*6.2832) * 0.5
                + Math.sin(v * 4 - time * 0.4 + clayPhaseY[i]*6.2832) * 0.3)
                * planeSize * (0.008 + cd * 0.014); // 深层扰动更大

  // 径向波纹（Z轴为主，深层粒子波纹相位不同）
  const bandIdx = Math.min(63, Math.floor(dc * 63));
  const ripple = Math.sin(dc * 12 - time * 4 + cd * 2) * spectrumSmooth[bandIdx]
               * zAmp * 0.40 * (1 + beatFreqBoost * 1.0);

  // 呼吸
  const breathe = hasData ? (0.04 + totalEnergy * 0.12) : (0.03 + Math.sin(time*0.4+cd*2)*0.02);

  // X/Y 极微扰（深层略大但仍保持封面可读）
  const microXY = Math.sin(u*18+time*2+cd*3)*Math.cos(v*15+time*1.8)
                  * planeSize*(0.002 + cd*0.003);

  x = bx + microXY;
  y = by + microXY * 0.7;
  z = bz + layerZ + breathe*planeSize*0.08 + ripple + clayWob;
}
```

### 着色调整（applyCoverColors + 待机着色）

不再使用静态 `coverLayer[i]` 做衰减，改用动态 `clayDepth[i]`：

```js
// applyCoverColors 中：
const cd = clayDepth[i];
const li = 1.0 - cd * 0.75;           // 深度0→亮1.0, 深度1→暗0.25
const am = cd * 0.9;                  // 深度0→纯封面, 深度1→90%主题色
colorAttr.array[i*3] = ... * (1-am) * li + accentRGB * am * li;

// 待机着色同理：
const layerDim = 1.0 - clayDepth[i] * 0.75;
```

## 三、buildBase 改造

- 移除 `coverLayer` / `coverLayerZ` 的静态分配（`idx % COVER_LAYERS`）
- 所有粒子基础 Z = 0（同一平面），深度由运行时 `clayDepth` 驱动
- 保留 `clayPhaseX/Y` 有机位移相位（仍需确定性初始化）

## 四、验收标准

- [ ] 初始状态（无播放/刚切歌）：所有粒子在同一平面，呈现**完整的专辑封面**（可辨认图案/文字）
- [ ] 播放时有个别粒子逐渐"掉"到后方并浮回（腻子脱落感）
- [ ] 高频能量强的区域脱落更多（与音乐关联）
- [ ] 脱落过程是平滑过渡（非瞬跳）
- [ ] 大部分粒子始终在前层（封面主体保持可读）
- [ ] `vite build` 通过

## 五、风险与回退

| 风险 | 应对 |
|---|---|
| 每帧遍历 COUNT 做弹簧积分（~20000次） | 纯算术操作（加减乘），GPU 不参与，CPU 可轻松负担 |
| 脱落太慢看不出效果 | `CLAY_FALL_RATE` 可调大；频谱触发概率可提高 |
| 脱落太快封面全碎了 | `CLAY_RETURN_SPEED` 加快回弹；限制同时处于深层的粒子数上限 |
| 回退 | 恢复静态 `idx % COVER_LAYERS` 分配即可 |
