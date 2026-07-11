# DEV 开发规范：v1.24 修复环形 2D 渲染失败 + 移除屏上三点切换

> 适用：Sonus 播放器可视化。本文档为**修复/回退型**改动，先定位后实施。
> 触发原因：用户反馈切到「环形(ring) 2D 可视化」即显示「渲染失败」；并明确要求**移除屏上三个指示点**，仅保留控制台（视觉设置面板）里的切换入口。

---

## 0. 根因（已定位）

`frontend/src/components/Visualizer.jsx` 的 `drawRadialWave` 中（v1.23 引入）：

```js
const idleHueShift = hasData ? 0 : Math.sin(tNow * (Math.PI * 2 / 8)) * 8;  // 引用了 tNow
const tNow = Date.now() * 0.001;                                            // tNow 在此才声明
```

`const tNow` 声明晚于使用 → **暂时性死区（TDZ）ReferenceError**，每帧首帧即抛错，`requestAnimationFrame` 循环中断，错误边界捕获后显示「渲染失败」。该引用**仅存在于 ring 模式的 `drawRadialWave`**，wave 模式不触发，与"切到环就失败"完全吻合。

---

## 1. 修复项

### 1.1 修复 TDZ（必做）
将 `const tNow = Date.now() * 0.001;` 提到 `idleHueShift` 之前，删除其后重复声明。逻辑、数值、视觉效果（待机色相漂移 ~8s）完全不变。

### 1.2 移除屏上三点指示（用户明确要求）
删除 `Player.jsx` 中「模式指示点」整块 `<div>`（含 `VIZ_MODES.map` 的三个 `<button>`）。
- 切换能力不受影响：控制台「视觉设置」面板（`FloatPanel` 内的 `VIZ_MODES` 按钮组）仍保留，用户在那儿切模式即可。
- 同步删除 `index.css` 中本次为三点新增的 `.mode-dot-active` / `@keyframes modeDotBreathe`（已无引用）。

### 1.3 保留项（不回退）
- 模式切换 150ms 淡入 `vizFadeIn`（域C）保留。
- 其余 v1.23 质感改动保留（未触及幅度常量）。
- `BEAT_PULSE_DECAY`、尖刺渐变、地形色带等保留。

---

## 2. 验收
- [ ] 切到「环形(ring) 2D」不再渲染失败，正常显示并随音乐律动
- [ ] 屏上不再出现三个切换小点
- [ ] 控制台「视觉设置」仍可正常切换 ring / wave / 3d 及 3D 子模式
- [ ] `vite build` 通过
