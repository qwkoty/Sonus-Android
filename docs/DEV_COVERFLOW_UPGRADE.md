# 开发规范：删除腻子封面模式 + 粒子封面升级为「错层黏土封面」

- 触发：用户反馈（1）删除独立"腻子封面"模式；（2）粒子封面要改成「错层 + 腻子质感 + 像音乐封面 + 会动」的方向
- 目标文件：
  - **删除**：`Visualizer3D.jsx`（clay 全套）、`Player.jsx`（clay 入口）、`docs/DEV_CLAY_COVER.md`
  - **优化**：`Visualizer3D.jsx`（coverflow 基础几何 + 动画 + 着色）
- 关联：`docs/DEV_VISUALIZER_BEAT_RESPONSE.md`、`docs/AI_PROJECT_GUIDELINES.md`

## 一、概念定义（用户要的是什么）

> **错层黏土封面** = 把专辑封面做成 **4 层前后错开的软质叠片**：
> - 前层 = 清晰的专辑封面（粒子色直接来自封面图）
> - 中层 = 渐隐的封面"残影"（亮度降低、偏主题色）
> - 后层 = 腻子光晕（accent 主题色的柔光板）
> - 所有层都是**软的、糯的**——像几片半透明的黏土片悬浮着
> - **会动**：各层以不同相位呼吸/飘移（错层感），鼓点时一层层地挤压回弹（jelly 传播）

**和之前"全息唱片"方案的区别**：不再用单面深度波纹，而是**真实的多层 Z 轴错层 + 各层独立动画**，保留腻子球那种软弹手感，但贴在专辑封面上。

## 二、现状诊断

| 问题 | 现状 | 用户不满 |
|---|---|---|
| coverflow 是平面 | `DOME_DEPTH_RATIO = 0.02`，几乎无 Z 深度 | 像飘动的 2D 布，不像 3D 封面 |
| 动画是"绸缎飘风" | fold1/fold2/gustX/Y 正弦叠加 | 没深度、没层次、不像专辑 |
| 腻子模式是独立球 | 和封面无关，一坨大的 | 用户说"不好看、要删" |

## 三、技术方案

### 3.1 多层结构（错层）

将 19881 个粒子按 `i % NUM_LAYERS` 分配到 4 层，每层是一个完整的 GRID 网格（稀疏 1/4 密度，配合柔和大粒子读作封面）：

```js
const COVER_LAYERS = 4;
const coverLayer = new Uint8Array(COUNT);     // 每粒子所属层
const coverLayerZ = new Float32Array(COUNT);  // 每粒子基础 Z（层偏移）
const LAYER_GAP = planeSize * 0.10;           // 层间距（错层深度）

// buildBase 中 coverflow 形态重写：
const layer = idx % COVER_LAYERS;
const layerCenter = (layer - (COVER_LAYERS - 1) / 2) * LAYER_GAP; // 前后对称分布
coverLayer[idx] = layer;
coverLayerZ[idx] = layerCenter;
basePositionsCover[idx*3]   = x;
basePositionsCover[idx*3+1] = y;
basePositionsCover[idx*3+2] = cbz + layerCenter; // 关键：Z 错层！
// 法线近似（用于腻子明暗）：中心垂直，边缘略斜
baseNormalsCover[idx*3+2] = 1.0 - dc * 0.5;
```

### 3.2 腻子质感（软、糯、有机）

每层粒子叠加**有机微位移**（确定性噪声 + 时间漂移），让边缘不再是硬网格而是"黏土片"：

```js
// 每粒子预存一个稳定相位（避免每帧随机抖动）
const clayPhaseX = mulberry32(0x1234 + idx)();  // [0,1)
const clayPhaseY = mulberry32(0x5678 + idx)();

// animate 中 coverflow 分支：
const lp = coverLayer[i];
const layerPhase = lp * 1.7; // 各层相位差 → 错层动画的关键
// 腻子有机起伏（小振幅，保持封面可读）
const clayWob = Math.sin(u * 3 + time * 0.5 + layerPhase) * 0.5
              + Math.sin(v * 4 - time * 0.4 + layerPhase) * 0.3;
const clayDisp = clayWob * planeSize * 0.012; // 软糯位移
```

### 3.3 封面呈现（前清后糊）

| 层 | Z 位置 | 颜色 | 透明度 |
|---|---|---|---|
| 0（前） | +1.5×GAP | 完整封面色（`applyCoverColors`） | 高 |
| 1（中前） | +0.5×GAP | 封面色 ×0.8 + accent×0.2 | 中 |
| 2（中后） | -0.5×GAP | 封面色 ×0.5 + accent×0.5 | 低 |
| 3（后） | -1.5×GAP | 纯 accent 柔光（腻子光晕） | 极低 |

实现：在 `applyCoverColors()` 中，根据 `coverLayer[i]` 对后层做亮度衰减 + 主题色混入；或在着色阶段按层调整 `intensity` 与颜色混合。

```js
// applyCoverColors 增强：后层渐隐+偏主题色
const layerDim = [1.0, 0.8, 0.5, 0.25][coverLayer[i]];
const accentMix = [0.0, 0.2, 0.5, 1.0][coverLayer[i]];
r = r * layerDim * boost * (1 - accentMix) + accentRGB.r * accentMix;
// ... g, b 同理
```

### 3.4 动画（会动 + 错层）

**每层独立呼吸/飘移**（相位差制造错层感）：

```js
// 每层呼吸：深度方向 Z 起伏，相位按层偏移
const breathe = (hasData ? 0.04 + totalEnergy * 0.15 + bassAttack * 0.20
                         : 0.05 + Math.sin(time * 0.4 + layerPhase) * 0.03);
// 每层缓慢自转/漂移（错层飘移）
const drift = Math.sin(time * 0.15 + layerPhase) * planeSize * 0.01;

// 径向波纹：每层的频谱波纹（从中心向外）
const bandIdx = Math.min(63, Math.floor(dc * 63));
const localE = spectrumSmooth[bandIdx];
const ripple = Math.sin(dc * 12 - time * 4 + layerPhase) * localE * zAmp * 0.4;

// 组合：Z 轴为主，X/Y 极微
const microXY = Math.sin(u * 18 + time * 2 + layerPhase) * planeSize * 0.0025;
x = bx + microXY + drift;
y = by + microXY * 0.7;
z = bz + coverLayerZ[i] + (breathe + ripple + clayDisp) * (1 + beatPulseRef.current * 0.4);
```

### 3.5 鼓点反应（jelly 错层传播）

鼓点时，挤压从**前层向后层依次传播**（像捏一团黏土，波纹一层层传到后面）：

```js
// 在鼓点检测块：不只对单一值置 1，而是给每层一个延迟脉冲
if (modeRef.current === 'coverflow') {
  const lp = Math.floor(Math.random() * COVER_LAYERS); // 随机选一层先响应
  beatPulseLayers[lp] = 1; // 每层独立脉冲包络（Float32Array(COVER_LAYERS)）
}
// animate 中每层脉冲衰减 + 应用 squash：
const bpLayer = beatPulseLayers[lp];
const squashY = 1 - bpLayer * 0.16;   // 纵向挤压
const squashXZ = 1 + bpLayer * 0.10;  // 横向鼓出
// 把粒子相对层中心的坐标按 squash 缩放（实现局部挤压）
x = layerCenterX + (bx - layerCenterX) * squashXZ;
y = layerCenterY + (by - layerCenterY) * squashY;
z = bz + ... ;
```

> 注：`beatPulseLayers` 是 `Float32Array(COVER_LAYERS)`，每帧按 `Math.pow(BEAT_PULSE_DECAY, dt*60)` 衰减，并可在鼓点时由前层向后层"接力"赋值制造传播感。

## 四、实施步骤

1. **删除腻子封面模式**（一次性清理）
   - `Visualizer3D.jsx`：移除 clay 全套（buildCoverTexture、coverTextureRef、网格/布光/阴影、clayMix/jiggle 变量、animate 中 clay 块、cleanup 释放、鼓点 clay 分支）
   - `Player.jsx`：移除 `VIZ_3D_MODES` 的 clay 条目 + `v3m` 合法列表 `'clay'`
   - 删除 `docs/DEV_CLAY_COVER.md`
   - `vite build` 验证零回归

2. **coverflow 基础几何**：引入 `COVER_LAYERS` / `coverLayer` / `coverLayerZ` / `clayPhaseX/Y`，重写 buildBase 中 coverflow 形态为错层叠片

3. **coverflow 动画重写**：替换当前绸缎飘风分支为「错层呼吸 + 径向波纹 + 腻子有机位移 + 每层 squash」

4. **封面着色**：`applyCoverColors()` 按层做亮度衰减 + accent 混入；着色阶段增强 intensity + 全息微闪

5. **鼓点错层传播**：新增 `beatPulseLayers` 包络，鼓点触发时前→后接力挤压

6. **编译验证 + commit + push**

## 五、验收标准

- [ ] clay 模式完全清除（代码/入口/文档无残留）
- [ ] 粒子封面呈现 **4 层前后错开** 的叠片（非单平面）
- [ ] 前层是清晰专辑封面，后层渐隐为腻子光晕
- [ ] 各层以不同相位呼吸/飘移（错层动画感）
- [ ] 鼓点时挤压从一层传播到另一层（jelly 软弹）
- [ ] 整体有"软、糯、会动"的腻子质感，但封面仍可读
- [ ] `vite build` 通过；与其他三模式切换零回归

## 六、风险与回退

| 风险 | 应对 |
|---|---|
| 4 层 × 1/4 密度导致前层封面模糊 | 增大粒子 size（柔和大圆点补密度）；或前层用 50% 粒子、后层共享 |
| 层间距过大穿出视锥 | `LAYER_GAP = planeSize * 0.10`，总深 ±0.30，clamp 已覆盖 |
| 各层动画不同步显得乱 | 相位差控制在 `lp * 1.7` 内，保持和谐 |
| 腻子位移破坏封面图案 | 振幅仅 `planeSize * 0.012`，极小扰动 |
| 删除 clay 后 localStorage 旧值 'clay' | Player 的 valid 检查自动降级为 'liquidmetal' |
| 回退 | git revert 到 clay 版本；或恢复绸缎飘风分支 |

## 七、影响范围

| 模块 | 影响 | 说明 |
|---|---|---|
| Visualizer3D.jsx | 大改 | 删除 clay (~150 行) + 重写 coverflow 几何/动画/着色 + 新增 beatPulseLayers |
| Player.jsx | 小改 | 删除 clay 模式条目 |
| docs | 清理 | 删除 DEV_CLAY_COVER.md |
| 其余三模式 | 中性 | 不改动 |
