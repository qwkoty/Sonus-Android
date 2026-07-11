# DEV 开发规范：v1.31 修复 3D 手势失效——FloatingLyrics 全屏装饰层未禁用指针事件

## 1. 背景与问题

- v1.30 将画布手势改为 Pointer Events + setPointerCapture 并绑定到 container（zIndex:2），
  但真机（v1.0.144）仍可能失效。
- 排查中遗漏的项：`FloatingLyrics` 组件渲染的是一个**全屏 `<canvas>`**
  （`position:absolute; inset:0; width/height:100%; zIndex:1`），作为浮动背景歌词的装饰层。
  它**没有 `pointer-events: none`**；而功能近似的全屏中央歌词层 `LyricScroll` 已设置
  `pointer-events: none`（zIndex:5）。
- 该全屏装饰 canvas 与 3D 画布（container zIndex:2）处于相邻层级。标准 stacking 下其 zIndex:1
  低于 container:2，理论上不拦截；但在部分 Android WebView 中，`vizFadeIn` 动画 /
  stacking context 边界处理可能导致该装饰层实际覆盖在 3D 画布之上，从而**吞掉所有指针手势**。
- 这与「页面按钮（zIndex:50）能点、但画布区域手势完全无反应」的现象完全吻合，也解释了为何
  仅把画布事件改成 Pointer Events 仍无效——`pointerdown` 根本不会落到 container（被装饰层截走）。
- 结论：纯装饰性全屏层必须显式 `pointer-events: none`，与 `LyricScroll` 保持一致，
  彻底排除覆盖层拦截画布手势这一根因。

## 2. 目标

- `FloatingLyrics` 不拦截任何指针 / 触摸事件；3D 画布容器稳定、独占地接收手势。
- 视觉表现不变（背景歌词照常飘动，仅关闭其交互命中）。

## 3. 方案

- 在 `FloatingLyrics` 根 `<canvas>` 的 style 中增加 `pointerEvents: 'none'`。
- 不改 zIndex、不改渲染逻辑、不影响其它层。

## 4. 受影响文件

- `frontend/src/components/FloatingLyrics.jsx`：根 canvas 样式增加 `pointerEvents: 'none'`。

## 5. 验证

- `vite build` + `oxlint` 0 error（CI APK 构建）。
- 真机（v1.0.145）进入 3D 模式：单指可见 360° 旋转、双指可见缩放；整页无缩放白条；松手停在当前视角。
