# 开发规范：液态金属（liquidmetal）可视化优化

- 触发：用户要求分析并优化「液态金属」可视化
- 目标文件：`frontend/src/components/Visualizer3D.jsx`（liquidmetal 基础/动画/着色）
- 关联：`docs/AI_PROJECT_GUIDELINES.md`、`docs/DEV_VISUALIZER_TERRAIN.md`

## 现状（修改前）

| 模块 | 现状 | 代码定位 |
|---|---|---|
| 基础形态 | 半径 `planeSize*0.56` 的球面，保存 `basePositionsLiquid` / `baseNormalsLiquid` | 304-317 |
| 频段映射 | `band=|v-0.5|*2`，`freqBand=floor((1-band)*63)` → 赤道(中间)=高频、两极=低频 | 290-293 |
| 动画 | 沿法向位移：音频能量 + 对流热点(8 个) + 液滴 + 表面张力波 + 呼吸 + 待机波 | 889-949 |
| **着色** | **无专属分支**：播放时套用封面原色 `applyCoverColors`（474-490），无封面/待机时走通用 accent fallback（1085-1104） | 1085 |

## 问题分析

1. **完全没有金属质感**：没有高光、没有菲涅尔边缘、没有漫反射光照。当前只是"会变形的彩色球"，与「液态金属 / chrome」观感相去甚远。这是最该优化的点。
2. **对流热点性能浪费**：动画里 `if (!hasData || idleHotspotsRef.current)` 恒为真（热点数组已初始化），导致**播放时每帧仍跑 8 × COUNT ≈ 16 万次** `Math.acos` + `Math.exp`。而热点本是待机效果，播放时应停用或大幅减弱。
3. **热点距离计算每帧重复**：`dot = nx*sp.cx + ny*sp.cy + nz*sp.cz` 中粒子法向 `(nx,ny,nz)` 与热点方向 `(sp.cx,...)` 都是**静态**的，每帧重算 `acos`+`exp` 纯属浪费。
4. **形变无光照反馈**：位移沿法向发生，但颜色不随起伏变化，看不出"液体流动"的立体感。

## 优化方案

### 1. 金属质感着色模型（核心改动）

新增 liquidmetal 专属着色分支（在 galaxy / terrain 分支之后、`!useCover` fallback 之前）：

引入**虚拟光照**，把"彩色球"变成"液态铬"：

```js
// 虚拟光：左上方打光；视线方向近似 (0,0,1)
const lightDir = { x: -0.4, y: 0.7, z: 0.6 }; // 已归一化
const Ld = Math.hypot(lightDir.x, lightDir.y, lightDir.z);
const lx = lightDir.x/Ld, ly = lightDir.y/Ld, lz = lightDir.z/Ld;
const nl = nx*lx + ny*ly + nz*lz;                 // 法向·光向
const diff = Math.max(0, nl);                     // 漫反射
const fres = Math.pow(1 - Math.max(0, nz), 3);    // 菲涅尔边缘（朝外法向越偏越亮）
// 高光：简化 Blinn-Phong（视线≈+Z，half=normalize(lightDir+view)）
const hx = lx, hy = ly, hz = lz + 1;
const hl = Math.hypot(hx,hy,hz);
const spec = Math.pow(Math.max(0, (nx*hx+ny*hy+nz*hz)/hl), 24) * 0.9; // 锐利高光=铬感
```

颜色合成：

```js
const base = useCover ? coverColor[i] : accentRGB; // 封面色或主题色作金属底色
let r = base.r * (0.25 + diff * 0.85) + spec + fres * 0.5;
let g = base.g * (0.25 + diff * 0.85) + spec + fres * 0.5;
let b = base.b * (0.25 + diff * 0.85) + spec + fres * 0.55;
// 音频点亮
const intensity = 1 + totalEnergy * 0.5 + bassPulse * 0.6;
```

要点：封面色作为"金属底色"，光照模型在其上叠加漫反射明暗 + 锐利高光 + 边缘菲涅尔 → 出现流动的铬/液态金属质感。

### 2. 对流热点性能优化

- **仅待机启用**：把循环条件改为 `if (!hasData && idleHotspotsRef.current)`，播放时跳过 8×COUNT 的 `acos/exp`。
- **预计算 dot 矩阵**：在 `buildBase` 内、球面生成后，预计算 `hotDot[i*H + h] = nx*sp.cx + ny*sp.cy + nz*sp.cz`（静态，只算一次）。运行时直接 `heatFalloff = exp(-heatDist^2 * 3)`，省掉每帧 `acos`。`hotDot` 存为 `Float32Array(COUNT * MAX_HOTSPOTS)`。

### 3. 虹彩 / 色相随形变漂移（油膜感，可选）

位移量 `displacement` 越大，底色色相轻微偏移（HSL 旋转 ±8°），模拟金属油膜虹彩。低成本、观感提升明显。

### 4. 保留封面色为底色

播放且有封面时，`applyCoverColors` 仍提供 `coverLight` 与采样色；着色分支用封面采样色作 `base`，金属光照在其上调制，既保留"封面穹顶"语义，又有金属光泽。

## 验收标准

- [ ] liquidmetal 出现明显高光 + 边缘菲涅尔亮边，呈现金属/铬质感（而非纯色球）
- [ ] 播放时热点对流循环被跳过，帧率明显提升（低端机尤其）
- [ ] 封面色作为金属底色，光照随形变起伏变化
- [ ] 三模式切换（galaxy/terrain/coverflow）零回归
- [ ] `vite build` 通过；CI 构建 APK 成功

## 风险与回退

- 着色新增 `nx/ny/nz`（liquidmetal 已有 `baseNormalsLiquid`，动画里 `nx,ny,nz` 已赋值）→ 无新增状态
- 若高光过曝，`spec` 系数 0.9 / 幂次 24 可调
- 若金属感太强丢失"液态"流动，降低 `spec`、保留 `diff` 权重
- 回退：删除 liquidmetal 专属着色分支即回到原封面色/通用着色

## 影响范围

| 模块 | 影响 | 说明 |
|---|---|---|
| liquidmetal 着色 | 新增分支 | 在 `!useCover` fallback 前插入 |
| liquidmetal 动画 | 优化 | 热点循环改 `!hasData` 门控 |
| buildBase | 微调 | 预计算 `hotDot` 矩阵 |
| galaxy / terrain / coverflow | 无影响 | 不变 |
| 性能 | 提升 | 播放期省 ~16 万次 transcendentals/帧 |
