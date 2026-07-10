# DEV 开发规范：可视化与交互优化 v1.21（方案草案）

> 适用范围：Sonus 播放器可视化系统（2D `Visualizer.jsx`、3D `Visualizer3D.jsx`）、音频引擎 `engine.js`、播放页交互 `Player.jsx`。
> 文档性质：**方案草案（先评审，不实施）**。用户明确要求"先写方案，再优化交互"。
> 关联历史：`DEV_TERRAIN_FLAT_TO_PEAKS.md`(v1.19) `DEV_VISUALIZER_OPT_*.md` 系列。

---

## 0. 目标

用户原话：**"再想一下怎么优化 波 可视化、地形可视化，还要优化它的音频 可视化范围大一点，先写方案，然后还要优化那个交互"**。

可拆为四个域：

| 域 | 目标 | 现状痛点 |
|---|---|---|
| A. 2D 波可视化 | 更宽、更有层次的径向/镜像波 | `MAX_R` 留 12% 边距未用；辐射环振幅仅 `0.14`；wave 模式 `maxAmp=h*0.40`（60% 高度浪费）→ "范围不够大" |
| B. 3D 地形可视化 | 从"平盘→山"更惊艳、更像奇观 | v1.19 已做平坦起步 + 升起，但用户评价"还是没什么感觉、不够惊艳" |
| C. 音频可视化范围 | **全局**反应幅度更大、低声段也出反应 | `engine.js` 动态范围偏窄：`minDecibels=-90 / maxDecibels=-15 / smoothing=0.75 / pow(normalized,0.6)` |
| D. 交互优化 | 手势切换、触摸反馈、面板手感、触觉 | 模式切换仅能点浮层按钮；可视化背景无手势；浮层无下拉关闭 |

**核心抓手是 C**：改 `engine.js` 的频谱提取，能同时放大 ring/wave/terrain/galaxy/coverflow 全部可视化——这正是"音频可视化范围大一点"的全局解法；A、B 在其之上做模式专属的幅度/层次增强。

---

## 1. 域 C — 音频可视化范围放大（全局，优先做）

### 1.1 现状（`frontend/src/audio/engine.js`）

- 第 36–39 行：`fftSize=1024; smoothingTimeConstant=0.75; minDecibels=-90; maxDecibels=-15`。
- 第 107 行：`const corrected = Math.pow(normalized, 0.6);` —— 指数 0.6 偏"压暗"，安静段几乎不可见。
- 第 112 行：`hasData = totalEnergy > numBars * 0.02`。

### 1.2 具体改动

**(a) 放宽动态范围（更跟手、低声也出反应）：**

```js
analyser.fftSize = 1024;
analyser.smoothingTimeConstant = 0.65;   // 0.75 → 0.65：更跟手（不过抖）
analyser.minDecibels = -100;            // -90 → -100：安静段也出反应
analyser.maxDecibels = -10;             // -15 → -10：峰值不被压平
```

**(b) 提亮 + 新增可选全局增益：**

```js
export function getSpectrumBars(numBars = 64, gain = 1.12) {
  ...
  const corrected = Math.min(1, Math.pow(normalized, 0.55) * gain);  // 0.6→0.55 提亮；gain 默认 1.12
  ...
}
```

- `pow` 指数 `0.6 → 0.55`：整体提亮、可见范围更宽。
- 新增 `gain` 形参（默认 `1.12`）：各可视化可传自身增益微调，集中可调、低风险。
- `hasData` 阈值保持 `numBars * 0.02`（gain 不会显著抬高静默能量，留待实测微调）。

### 1.3 影响与风险

- 影响面：所有调用 `getSpectrumBars` 的可视化统一变"更敏感、范围更大"，符合需求。
- 风险：`smoothing` 降到 0.65 在 3D 上可能略抖 → 真机验证；若抖，回调到 0.70。
- **不**改 `fftSize`（1024 已够 64 段），避免连带 retune。

---

## 2. 域 A — 2D 波可视化增强（`frontend/src/components/Visualizer.jsx`）

### 2.1 扩大响应范围

| 参数 | 现状 | 改为 | 位置 |
|---|---|---|---|
| `drawWave` `maxAmp` | `h * 0.40` | `h * 0.48` | 第 332 行 |
| `drawRadialWave` `MAX_R` | `minDim*0.5*0.88` | `minDim*0.5*0.94` | 第 133 行 |
| 辐射环振幅 | `value*(MAX_R-INNER_R)*0.14` | `* 0.20` | 第 253 行 |
| 中心填充波纹 | `layerValue*minDim*0.04` | `* 0.06` | 第 155 行 |
| 呼吸缩放 bass 项 | `bassSmooth*0.14` | `* 0.20` | 第 130 行 |
| 冲击波触发 | `bass>0.4 && bassDelta>0.1` | `bass>0.32 && bassDelta>0.08` | 第 117 行 |

- `maxAmp*0.48` 配合镜像上下各 48% = 96%，中心留 4%，不溢出。
- `MAX_R*0.94` 让外圈更贴近边缘（范围更大）；外圈已有 `shadowBlur` 抗溢出。

### 2.2 更丰富的层次（性能可控）

- `FILL_RINGS` `10 → 12`，`NUM_RINGS` `3 → 4`（第 138 / 222 行）：多一圈高频环，层次更密。
- 步数保持 `FILL_STEPS=64` / `STEPS=96`，不增开销。
- **新增"频谱尖刺"（spikes）**：在外圈沿 64 个方向发射朝外的小尖刺，长度 = 该频段 `smooth[i]` × `minDim*0.06`，描边 `hsla(H, S, 80%, 0.5)`，`shadowBlur=minDim*0.006`。开销低（64 条短线），但"声波刺"让外缘范围感与动感显著增强。

### 2.3 待机也"活"

- 待机分支 `bass/mid/treble` 幅度（第 107–109 行）保持；`breathScale` 已含待机呼吸，随 2.1 一起放大。

---

## 3. 域 B — 3D 地形可视化惊艳度（`frontend/src/components/Visualizer3D.jsx`）

### 3.1 更戏剧化的山脉

| 参数 | 现状 | 改为 | 位置 |
|---|---|---|---|
| 静态山高乘子 | `(hN-0.35)*planeSize*0.70*terrainRise` | `*0.95` | 第 1068 行 |
| 高度 clamp 上限 | `planeSize*0.72` | `planeSize*0.95` | 第 1088 行 |
| `TERRAIN_GAIN` 常量 | `0.22` | `0.30` | 第 27 行 |
| `beatPulseH` 鼓点抬升 | `bassAttack*planeSize*0.16` | `*0.22` | 第 1076 行 |

- 山更高、音频响应更猛 → "长出来"的冲击力更强。

### 3.2 升起过程带"过冲弹性"（更具冲击力）

现状（第 844–846 行）是普通指数逼近，无弹性。改为带轻微过冲的弹性缓动：

```js
{
  const targetRise = hasData ? 1.0 : TERRAIN_IDLE_RISE;
  const speed = hasData ? TERRAIN_RISE_SPEED : TERRAIN_FALL_SPEED;
  // 指数逼近 + 轻微过冲（首次升起到 ~1.06 再回落 1.0）
  terrainRise += (targetRise - terrainRise) * Math.min(1, dt * speed);
  if (hasData && terrainRise > 1.0) terrainRise = 1.0 + (terrainRise - 1.0) * 0.85; // 过冲缓慢收敛
}
```

> 注：过冲需真机验证；若山"抖"，去掉过冲分支、仅保留更高乘子。

### 3.3 惊艳着色增强（现有第 1146–1210 行 isTerrain 分支）

- **雪顶高光**：`crest` 泛白系数 `0.5 → 0.7`（第 1165–1167 行），峰顶更亮更像雪峰。
- **流动雾**（而非静态雾）：`fogDensity` 增加随 `time` 与 `u` 缓慢漂移的相位（第 1181 行），雾"流动"而非凝固。
- **等高线更明显**：`contourBoost = 1 + terrainRise*1.0 → 1 + terrainRise*1.6`（第 1195 行）。
- **峰顶音频辉光** `audioGlow` 系数 `0.40 → 0.55`（第 1187 行）：播放时山峰随频段发光更强。

### 3.4 新增"镜面湖"倒影（高影响、低开销）

- 在地形圆盘下方（`y<0`）加一层**镜像半透明平面**：用现有地形粒子坐标 `y` 取负（`-y * 0.6`）做倒影点，透明度随 `terrainRise` 与距离衰减，营造"悬浮山岛 + 湖面倒影"的奇观纵深。
- 实现：复用 `basePositionsTerrain` 网格，新增一个 `reflectAttr`（仅 z/x 同、y 取负 × 衰减），颜色取地形着色 × `0.35` 透明。或更低成本：在 `ocean` 分支直接对下半空间的粒子做镜像位移 + 压暗（不改几何，仅着色与位移）。**优先"着色镜像"方案**，避免新增几何开销。
- 风险：需保证倒影不穿帮（仅 ocean 模式、仅 `terrainRise>0.3` 时显现）。

### 3.5 新增"灵气"悬浮光点（可选，中等开销）

- 仅 ocean 模式可见的轻量 `THREE.Points`（约 400 点），分布在山峰上方，随 `bassAttack` 上浮 + 闪烁，营造"灵气缭绕"。
- 若性能吃紧则**砍掉**，以 3.1–3.4 为核心惊艳项。

---

## 4. 域 D — 交互优化（`Player.jsx` + `Visualizer.jsx`）

### 4.1 滑动切换可视化模式

- 在可视化背景区（控制条之上、`Visualizer`/`Visualizer3D` 容器外层的非按钮区）加 `onTouchStart/Move/End`，识别**横向 swipe**（位移 > `minDim*0.12` 且纵向 < 阈值）：
  - 左滑 → 下一个 `VIZ_MODES`（`setVm(next)` + `localStorage`）；右滑 → 上一个。
  - 切换时触发一次 3D morph / 2D 闪白过渡（复用现有 `morphT` 或 `key` 重挂）。
- 在控制条上方加一排**模式指示点**（dot），高亮当前 `vm`，点按也可切换。

### 4.2 触摸反馈涟漪

- `Visualizer` 暴露 `onTap(x,y)` ref 回调：2D 在触摸点生成一个 `shockwave`（复用现有池，半径自触摸点起），强"可交互"感。
- 3D 地形：触摸点投射到地形平面生成局部涟漪（复用 `ripple` 逻辑加一个瞬时 `touchRipple` 变量）。

### 4.3 浮层面板下拉关闭

- `FloatPanel`（第 164 行）表头加 `touchmove` 拖拽：跟随手指 `translateY`，松手超过阈值（> `120px` 或速度）则 `onClose()`；配套 `slideUp` 进出动画（`index.css` 已含 `slideUp`、`panelIn`）。

### 4.4 触觉反馈

- `@capacitor/haptics` 当前**未集成**（源码无引用）。改用 Web 标准 `navigator.vibrate(15)`（Android WebView/Chrome 支持），在**模式切换 / 切歌**时轻震。零依赖、低风险。
- 需 `try/catch` 包裹（iOS Safari 不支持，静默降级）。

---

## 5. 实施顺序（建议）

1. **C 音频范围**（engine.js）—— 全局地基，先做、先真机验证"范围是否够大"。
2. **A 2D 波** + **B 3D 地形核心（3.1–3.4）** —— 在 C 之上做模式专属增强。
3. **D 交互（4.1–4.4）** —— 最后做，独立互不干扰。
4. 真机逐项验收，过曝/抖动则回调参数。

---

## 6. 验收标准

- [ ] 任意音乐下，ring/wave/terrain/galaxy/coverflow **低声段也能看到明显起伏**（范围更大）。
- [ ] wave 模式上下振幅接近满屏（>90%）而不溢出。
- [ ] 地形播放时**明显"长高 + 过冲"**，峰顶雪白、雾流动、有倒影纵深。
- [ ] 横向滑动可切换可视化模式，指示点同步，切换有过渡。
- [ ] 触摸可视化有涟漪/反馈，浮层可下拉关闭，关键操作有轻震。
- [ ] 真机 `vite build` 通过；无内存泄漏（事件监听均 `removeEventListener`）。

---

## 7. 待用户确认（评审点）

1. 域 C 的 `smoothing=0.65` 是否接受（更跟手但略抖）？—— 还是保守取 `0.70`？
2. 域 B 的"镜面湖倒影"和"灵气光点"是否都要，还是只保留倒影（更稳）？
3. 域 D 滑动切换：是否启用"横向滑动切模式"（可能与现有控制条手势冲突，需界定手势热区）？
4. 是否需要把 v1.20（地形 `trFreq` 崩溃修复，commit `82a37ce`）补登到 `PROJECT_FEATURE_STATUS.md`？（现状文档缺失该条目）

---

## 8. 关联待办

- 补登 `PROJECT_FEATURE_STATUS.md` v1.20 条目（地形切换崩溃修复）。
- （遗留）QQ 昵称真实字段路径仍待用户在真机抓取 `[userInfo]` 控制台日志后定夺。
