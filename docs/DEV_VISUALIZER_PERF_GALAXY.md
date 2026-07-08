# 开发规范：3D 可视化粒子数调整 + 流畅性/交互优化 + 星空切换渲染修复

- 触发：用户需求「把三个 3D 可视化粒子数都调到两万左右，优化流畅性和交互流畅性；切换星空渲染失败」
- 目标文件：`frontend/src/components/Visualizer3D.jsx`、`frontend/src/audio/engine.js`
- 关联：`docs/DEV_3D_BEAT_FREQ_ENHANCE.md`（鼓点频率增强，本次保留不受影响）

## 当前状态（修改前）
| 项 | 现状 | 问题 |
|----|------|------|
| 粒子数 | `GRID = 180` → `COUNT = 32400`，三套形态共用 | 远超「两万左右」，移动端填充率压力大 |
| 星空渲染 | `Rmax` 仅在 `buildBase()`（L256 局部）与 `if(isGalaxy)`（L673 块局部）声明 | **待机分支流星生成 L542 引用 `Rmax` 不在作用域 → `ReferenceError` → 切换进星空待机数秒后崩溃** |
| 频谱数据 | `getSpectrumBars` 每帧 `new Float32Array(numBars)` | 60 次/秒分配 → 持续 GC 抖动 |
| 旋转/缩放缓动 | `g.zoom += (target-g.zoom)*0.18`（固定每帧系数） | 帧率相关：掉帧时拖拽/缩放变「黏」、节拍衰减变慢 |
| 节拍包络衰减 | `beatPulseRef *= 0.90`、`beatFreqBoost *= 0.90`（固定每帧） | 同上，帧率相关 |

## 修改内容

### 1. 修复星空切换渲染失败（关键）
- 将 `Rmax` 提升为 `useEffect` 顶层 `let Rmax = 0;`，在 `computeLayout()`（已算得 `planeSize`）内赋值：`Rmax = planeSize * GALAXY_R_MAX_RATIO;`
- 删除 L256（`buildBase` 内 `const Rmax`）与 L673（`if(isGalaxy)` 内 `const Rmax`）两处局部声明，统一使用顶层 `Rmax`。
- 效果：L542 流星生成、L682/L728/L851 着色均可见 `Rmax`，星空待机不再崩溃。
- 验收：从任意形态切到 galaxy 并静置 >10s（流星周期）不报错；ErrorBoundary 不触发。

### 2. 粒子数调到两万左右
- 改 `const GRID = 180;` 为：
  ```js
  const TARGET_PARTICLES = 20000;
  const GRID = Math.round(Math.sqrt(TARGET_PARTICLES)); // ≈141 → COUNT ≈ 19881
  ```
- 三套形态（coverflow / liquidmetal / galaxy）共用 `COUNT = GRID*GRID`，一处改动即三套同时降到 ≈20k。
- `material.size = planeSize * 2 / GRID * 1.2` 随 GRID 缩小自动增大点尺寸，补偿网格变疏导致的断层。
- 封面采样（`GRID×GRID` canvas）分辨率同步降到 141，细节略降但可接受。

### 3. 频谱缓冲复用（去 GC 抖动）
- `engine.js` 增加模块级 `let spectrumBuf = null;`，`getSpectrumBars` 复用 `spectrumBuf`（长度不符时重建），不再每帧 `new`。
- 调用方 `Visualizer3D` 每帧把 `data` 拷入 `spectrumSmooth` 后不再持有，复用安全。

### 4. 帧率无关的缓动（交互/节拍手感一致）
- 在 `animate` 计算 `dt` 后，定义 `const LERP = 1 - Math.pow(1 - 0.18, dt * 60);`
- 旋转/缩放改用 `LERP`：`g.zoom/rotationY/rotationX += (target - cur) * LERP;`（L915-917）
- 节拍包络改用帧率无关衰减：
  - `beatPulseRef.current *= Math.pow(0.90, dt * 60);`
  - `beatFreqBoostRef.current *= Math.pow(BEAT_FREQ_BOOST_DECAY, dt * 60);`
- 60fps 时与旧行为完全一致；掉帧时缓动/节拍按真实时间推进，拖拽不再「黏」、鼓点不过拖。
- 保留冲击波弹簧（SPRING_K/DAMPING）不变，避免改变已验收的鼓点冲击手感。

### 5. 微优化（可选、低风险）
- `animate` 每帧预计算 `const invRmax = 1 / Rmax;`，将 L682/L728/L851 的 `galaxyR[i] / Rmax` 改为 `galaxyR[i] * invRmax`，省去每粒子多次除法。

## 验收标准
- [ ] `grep -n "const GRID" Visualizer3D.jsx` → `GRID = Math.round(Math.sqrt(20000))` 且 `COUNT ≈ 20000`（打印或断言）。
- [ ] 切换至 galaxy 并静置 >10s，控制台无 `ReferenceError`，画面持续渲染。
- [ ] 三套形态粒子数一致为 `GRID*GRID`，无形态仍跑 32400。
- [ ] `getSpectrumBars` 单帧内不分配新 `Float32Array`（devtools/计数验证）。
- [ ] 拖拽/缩放在 30fps 与 60fps 下跟手感一致（主观）。
- [ ] `vite build` 通过（CI `Build web assets` 成功）。
- [ ] 视觉观感与改造前一致（粒子更稀但点更大、星系/金属/封面形态无变形）。

## 风险与回退
- `GRID` 下降 → 封面采样变粗：`material.size` 已自动补偿，必要时微调 `1.2` 系数。
- 帧率无关缓动若手感偏快/慢，调 `0.18` 基准即可，不影响帧率一致性。
- 若 galaxy 仍崩溃：检查是否另有未提升作用域的常量（grep `const Rmax` 应只剩 0 处局部声明）。
