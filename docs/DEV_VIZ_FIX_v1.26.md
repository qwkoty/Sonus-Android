# DEV 开发规范：v1.26 紧急修复 — 地形(3D ocean)可视化卡死

> 适用：Sonus 播放器 3D 可视化。本文档针对 v1.25 引入的回归热修。
> 原则：仅做精准的索引名修正（一行级），不改动任何数值/算法，保持与 v1.25 预计算方案一致。

---

## 一、现象

- 用户操作：打开「地形」3D 可视化（ocean 模式）后整个画布卡死（无 "渲染失败" 报错，但无动画、无响应）。
- 其他模式（coverflow / liquidmetal / galaxy / 2D ring / wave）正常。
- 引入点：v1.25 的 O2 改动（地形 fBm 山高/ridged 预存 `buildBase`，动画分支改为读预存数组）。

## 二、根因

- `buildBase()` 用局部变量 `let idx = 0; … idx++` 作为粒子写入索引，把 `terrainHN[idx]` / `terrainRidge[idx]` 存进 `Float32Array(COUNT)`。
- 动画主循环 `for (let i = 0; i < COUNT; i++)` 的循环变量名为 `i`（非 `idx`）。
- v1.25 在动画循环的 ocean 分支与地形着色分支**误用 `idx`** 读取预存数组：
  - `Visualizer3D.jsx:1120` `const hN = terrainHN[idx];`
  - `Visualizer3D.jsx:1221` `const ridgeNow = terrainRidge[idx];`
- `idx` 在动画循环作用域内**未声明**。在 ESM 严格模式下，`terrainHN[idx]` 触发 `ReferenceError: idx is not defined`，**每帧**在 `requestAnimationFrame` 回调中途抛出。
- rAF 回调在中途抛错 → 本次帧未执行完、下一帧 `requestAnimationFrame` 不再被调度（调度在帧尾）→ 动画循环永久停止 → 画布冻结（非 React 渲染期错误，故不触发 ErrorBoundary "渲染失败" 文案，表现为"卡住"）。
- 仅地形模式走 `targetShape === 'ocean'` / `isTerrain` 分支，故崩溃仅限该模式；其余模式不引用 `idx`，不受影响。

## 三、修复

将两处 `idx` 改为动画循环变量 `i`（与同分支 `terrainBand[i]` 一致，索引语义等价）：

```js
// 动画循环 ocean 位置分支
const hN = terrainHN[i];      // 原 terrainHN[idx]（idx 未声明 → ReferenceError）

// 动画循环 terrain 着色分支
const ridgeNow = terrainRidge[i]; // 原 terrainRidge[idx]
```

- `i` 与 `buildBase` 的 `idx` 遍历同一套 `origUV` 网格、同一粒子顺序，故 `terrainHN[i]` / `terrainRidge[i]` 取到的值与 v1.25 设计完全一致，视觉/性能收益不变。

## 四、验收

- [ ] `vite build` 通过。
- [ ] 打开地形(3D ocean)可视化：山脉随播放升起、着色正常、动画流畅不卡死。
- [ ] 其余 3D 子模式(coverflow/liquidmetal/galaxy)与 2D(ring/wave)切换/播放均正常。
- [ ] 控制台无 `idx is not defined` 报错。
