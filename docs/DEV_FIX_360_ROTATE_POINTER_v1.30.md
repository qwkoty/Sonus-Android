# DEV 开发规范：v1.30 修复 3D 可视化 360° 旋转 / 双指缩放（Pointer Events）

> 关联任务：用户反馈 v1.0.143（v1.29）真机上「不能缩放、不能 360° 旋转」，
> 要求：双指捏合 = 缩放，单指上下左右滑动 = 360° 旋转（无自动旋转）。

## 1. 背景与问题

- v1.28 移除了「横向滑动切换可视化」手势，并确认 360° 旋转逻辑代码仍在位。
- v1.29 禁用了 WebView 原生页面缩放（`MainActivity.setSupportZoom(false)` + `setBuiltInZoomControls(false)`、
  `index.html` 增加 `user-scalable=no`、canvas 设 `touch-action:none`），但真机（v1.0.143）实测：
  **既不能双指缩放、也不能单指 360° 旋转**，与上一版现象一致（仅少了整页缩放白条）。
- 已排除的根因：
  - 覆盖层拦截：`.vignette-overlay`（pointer-events:none, zIndex:1）、`FloatingLyrics`（zIndex:1）、
    `LyricScroll`（pointer-events:none, zIndex:5）均不会吞掉 canvas 事件；canvas 容器 zIndex:2 在最上层。
  - 全局 `touch`/`pointer` 拦截器：全仓库仅 `Visualizer3D` 自身与 2D `Visualizer` 各挂监听，无捕获阶段
    `stopPropagation`/`preventDefault`；2D `Visualizer` 仅在非 3D 模式挂载。
  - `autoRotate` 默认 `false`（符合「不要自动旋转」）。
  - 旋转对象 `points`（THREE.Points，主网格）在动画循环里由 `g.rotationY/X` 驱动，逻辑正确。
  - `touch-action` 已设为 `none`。
- **结论**：在 Android WebView 中，挂在 Three.js 运行时 `appendChild` 的 `<canvas>` 上的
  `touchstart/touchmove/touchend` 监听不可靠，单指/双指手势事件未被稳定投递到 JS，
  导致旋转与缩放完全不生效。这是移动端 WebView 的经典坑。

## 2. 目标行为（用户明确要求）

- **双指捏合 = 缩放**（3D 场景内，范围 0.4x–3.0x）。
- **单指上下 / 左右滑动 = 360° 旋转**（偏航 yaw 全向 + 俯仰 pitch 限制 ±85°；无自动旋转）。
- 保留桌面端：鼠标拖拽 = 旋转、滚轮 = 缩放（开发预览用）。
- 进入 3D 模式（`vm==='3d'`）后该交互才生效（2D 模式 ring/wave 无此交互，符合现状）。

## 3. 方案

- 将手势实现从 **Touch Events** 切换为 **Pointer Events**（`pointerdown` / `pointermove` /
  `pointerup` / `pointercancel`），统一鼠标 / 触摸 / 笔，移动端投递最可靠。
- 监听绑定到 **React 渲染的 container**（`containerRef.current`，铺满全屏、zIndex:2），
  而非 Three.js 动态 append 的 `<canvas>`；并对该元素调用 `setPointerCapture`，
  确保手势全过程事件不被 WebView 原生手势或滚动抢走。
- 用 `pointers` Map 追踪多指：
  - 1 指 → 旋转（yaw + pitch）
  - 2 指 → **纯缩放**（移除原先双指附带的「角度扭转」，使「双指=缩放 / 单指=旋转」职责清晰，贴合用户描述）
- 保留 `wheel` 缩放（桌面）；移除原有独立的 mouse 监听（Pointer Events 已统一覆盖鼠标）。
- `surface.style.touchAction = 'none'` 兜底，禁止浏览器默认手势。

## 4. 受影响文件

- `frontend/src/components/Visualizer3D.jsx`
  - 手势控制段（约 1350–1436 行）整体替换为 Pointer Events 实现。
  - 清理段（`return () => {...}`）同步移除旧 touch/mouse 监听、改为移除 pointer 监听。

## 5. 验证

- CI：`vite build` + `oxlint` 通过（CI APK 构建）。
- 真机（v1.0.144）进入 3D 模式：
  - 单指滑动 → 可见 360° 旋转；
  - 双指捏合 → 可见场景缩放；
  - 无任何整页缩放白条；
  - 松手后停在当前视角（无自动旋转）。
