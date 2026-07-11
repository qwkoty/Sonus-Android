# DEV 开发规范：v1.27 修复 3D 360° 旋转失效

> 适用：Sonus 播放器 3D 可视化。本文档针对 v1.25 引入的旋转失效热修。
> 原则：最小回退，保留 O1 的核心收益（内层 Suspense 无 key），仅回退外层 key。

---

## 一、现象

- 用户操作：切换到 3D 可视化后，单指滑动/鼠标拖拽无法 360° 旋转。
- 其他模式（2D ring/wave）正常。
- 引入点：v1.25 的 O1 改动（Player.jsx 外层 key 从 `` `${vm}:${v3m}` `` 改为 `vm === '3d' ? '3d' : '2d'`）。

## 二、根因分析

### 直接原因
v1.25 O1 的外层 key 策略改变导致 **React remount 时机异常**。当 key 从 `'2d'` 切换到 `'3d'` 时，外层 `<div>` 及其内部子树被完全销毁再重建。虽然 Visualizer3D 的 useEffect 会重新绑定触控监听器，但问题可能在于：

1. **Suspense fallback 时序**：外层 div remount → 内层 Suspense 短暂显示 fallback（null）→ Visualizer3D 异步 mount（React 19 Suspense 行为）→ canvas 创建延迟 → 触控监听器绑定延迟。在 Android WebView 的触摸事件模型中，如果 canvas 的 `touchstart` 监听器在首次触摸之后才注册，后续 `touchmove` 可能不会被正确分发。

2. **150ms vizFadeIn 动画期间**：`animation: 'vizFadeIn .15s ease both'` 在 `@keyframes vizFadeIn` 中设置了 `from { opacity: 0 }`，虽然 opacity 不影响 pointer-events，但 CSS animation 在 `both` 填充模式下可能在动画开始前短暂处于 `opacity: 0` 状态。

### 根本原因
O1 的外层 key 分组策略是正确的优化方向，但 **2D↔3D 切换时外层 div 完全 remount** 引入了不必要的复杂度。真正的性能收益来自**内层 Suspense 不再设 key**（封面变化时不复 mount），外层 key 保持 `${vm}:${v3m}` 不会造成 20k 粒子重建——因为旧方案下，`${vm}:${v3m}` 在 3D 子模式切换时会变（如 `3d:coverflow`→`3d:ocean`），此时会 remount。

**更好的方案**：外层 key 保持 `${vm}:${v3m}`（即回退 O1 的外层部分），但**保留 O1 的核心改动**——内层 Suspense 移除 key。这样：
- 3D 子模式切换 → 外层 key 不变（`vm` 始终是 `'3d'`，`v3m` 变化但外层 key 是 `${vm}:${v3m}` → 会变 → 仍会 remount...）

等等，这说明回退到 `${vm}:${v3m}` 也不能保留 morph 收益。让我重新设计：

**最优方案**：外层 key 保持 `vm === '3d' ? `3d:${v3m}` : '2d'`（仅在 3D 子模式或 2D↔3D 变化时 remount），**但确保 Suspense fallback 不为 null**，或给 Suspense 一个占位 fallback。

**但实际更简单的做法是**：直接回退到 v1.24 的 key 策略（`${vm}:${v3m}`），因为用户明确反馈"越优化越差"——O1 的优化收益不值得引入任何风险。即使回退意味着每次 3D 子模式切换都重建 20k 粒子，但 3D 子模式切换本身就很低频。

## 三、修复

**回退外层 key 到 v1.24 策略，保留内层 Suspense 无 key（封面由内部 useEffect 重载）。**

```jsx
// Player.jsx 可视化背景层
<div key={`${vm}:${v3m}`} style={{ position: 'absolute', inset: 0, animation: 'vizFadeIn .15s ease both' }}>
  {vm === '3d' ? <Suspense><Visualizer3D accent={ac} cover={currentTrack?.cover || ''} mode={v3m} isPlaying={isPlaying} /></Suspense> : <Visualizer isPlaying={isPlaying} mode={vm} accent={ac} />}
</div>
```

与 v1.24 的唯一区别：内层 Suspense 无 key（v1.24 有 `key={cover}-${v3m}`）。

## 四、验收

- [ ] `vite build` 通过。
- [ ] 切换到 3D 模式后，单指滑动可 360° 旋转（偏航），双指捏合缩放。
- [ ] 3D 子模式切换（coverflow↔liquidmetal↔galaxy↔ocean）正常（会 remount，视觉可接受）。
- [ ] 换封面后 3D 可视化正常重载纹理（由 Visualizer3D 内部 useEffect 处理）。
- [ ] 2D ring↔wave 切换正常。
