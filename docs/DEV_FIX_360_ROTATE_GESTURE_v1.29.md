# DEV 开发规范：修复 3D 360° 拖拽旋转被 WebView 页面缩放劫持（v1.29）

> 适用：Sonus 播放器 3D 可视化旋转交互 + Android WebView 手势。
> 背景：v1.28 移除了「横向滑动切模式」并声称恢复了 360° 拖拽旋转，但实测在设备上**单指拖拽无法旋转、手势被当成整屏缩放**（"只能放大或缩小，绝对不能旋转"）。本规范定位并修复根因。

---

## 一、现象

- 进入 3D 可视化（coverflow / liquidmetal / galaxy / terrain）后，单指/鼠标拖拽**无法 360° 旋转**。
- 拖拽或双指手势被 Android WebView 当作**页面缩放**处理：整个屏幕被放大/缩小。
- `Visualizer3D.jsx` 内的旋转手势代码本身存在且逻辑正确（见第三节）。

## 二、根因分析

`Visualizer3D.jsx` 的 360° 旋转手势代码（单指拖拽 = 偏航 yaw+俯仰 pitch；双指捏合缩放+扭转；滚轮缩放）**逻辑正确、监听器已正确挂载到 canvas（`renderer.domElement`），且 canvas 已设 `touch-action: none`**。问题不在 React/Three.js 手势代码，而在**宿主 WebView 在原生层把触摸手势劫持用于页面缩放**：

1. **`frontend/index.html` 的 viewport 未禁用缩放**：
   `<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />` —— 缺少 `user-scalable=no, maximum-scale=1.0, minimum-scale=1.0`，页面允许被缩放。
2. **`MainActivity.java` 未关闭 WebView 缩放**：`WebSettings` 未调用 `setSupportZoom(false)`（默认 `true`）。在 `setSupportZoom(true)` 下，WebView 会在原生层拦截/延迟触摸手势以用于缩放与滚动，**导致 canvas 的 `touchstart/touchmove` 被吞或延迟**，旋转手势失效；未被 canvas `preventDefault` 兜住的部分直接表现为整屏缩放。
3. **`Visualizer3D.jsx` 容器 div 未设 `touch-action`**：canvas 已设 `touch-action: none`，但外层容器 div 没有，存在边缘/时序上手势未被独占的隐患（兜底加固）。

> 结论：旋转"失效"不是代码被删，而是**手势被系统级页面缩放劫持**。禁掉页面缩放后，现有（正确的）canvas 手势即可独占并正常工作。

## 三、现有旋转手势代码（确认正确，不改动）

- `Visualizer3D.jsx` 130–150 行 `gestureRef`：`rotationY`(偏航/360°) + `rotationX`(俯仰/±85°)、`dragging`/`pinching`、`autoRotate:false`。
- 1291–1311 行：每帧 `g.rotationY/X` 缓动后写入 `points.rotation.y/x`，实现拖拽旋转。
- 1354–1436 行：canvas 上的 `touchstart/touchmove/touchend`（单指拖拽旋转、双指捏合缩放+扭转）、`wheel`（滚轮缩放）、鼠标拖拽；`dom.style.touchAction='none'`、`dom.style.cursor='grab'`。

## 四、修改方案

### 改动 1：`index.html` 禁用页面缩放
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no, viewport-fit=cover" />
```

### 改动 2：`MainActivity.java` 关闭 WebView 缩放
在 `settings.setAllowContentAccess(true);` 之后新增：
```java
// 关闭 WebView 内置缩放，避免 3D 可视化拖拽手势被系统当成页面缩放（修复 360° 旋转失效）
settings.setSupportZoom(false);
settings.setBuiltInZoomControls(false);
```

### 改动 3：`Visualizer3D.jsx` 容器兜底 `touch-action: none`
容器 div 的 style 增加 `touchAction: 'none'`（与 canvas 一致，确保整块 3D 区域独占手势）：
```jsx
return (
  <div
    ref={containerRef}
    style={{
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      zIndex: 2,
      touchAction: 'none',
    }}
  />
);
```

### 不改动项
- 旋转手势逻辑（保持，逻辑正确）。
- `autoRotate` 默认 `false`：**保持关闭**（用户明确"不需要自动旋转"）。
- 已移除的「横向滑动切模式」（v1.28）：保持移除。
- 2D 可视化（ring/wave）无旋转需求：不改动。

## 五、影响范围

| 项 | 影响 |
|---|---|
| 3D 旋转（单指拖拽 360° 偏航+俯仰） | 恢复（手势不再被页面缩放劫持） |
| 3D 双指捏合缩放+扭转 | 恢复（原被系统缩放吞掉） |
| 3D 滚轮缩放 | 不受影响（原本正常） |
| 页面缩放（整屏放大缩小） | 禁用（WebView/视口层面） |
| 2D 可视化 / 歌词 / 搜索 / 播放控制 | 不受影响 |
| 自动旋转 | 保持关闭（按用户要求） |

## 六、验收

- [ ] `vite build` 通过；`oxlint` 0 error。
- [ ] 3D 可视化：单指/鼠标拖拽可 360° 偏航 + 俯仰(±85°)，双指捏合缩放+扭转，滚轮缩放正常。
- [ ] **整屏不再被缩放**（页面缩放已禁用）；旋转手势流畅跟手。
- [ ] 2D ring/wave、歌词、搜索、队列、调色、播放控制均正常。
- [ ] 无新增控制台报错；无死代码。
- [ ] 同步 `docs/PROJECT_FEATURE_STATUS.md` 维护记录与更新日志（v1.29）。
- [ ] 提交并推送 `origin/main`（触发 CI 自动构建 APK）。

## 七、自查清单

- [ ] 是否影响其它页面：否
- [ ] 是否产生 Bug：否
- [ ] 是否出现重复代码：否
- [ ] 是否违反开发规范：否
- [ ] 是否存在性能问题：否
- [ ] 是否存在安全问题：禁用页面缩放为常规 app 做法，无安全风险
- [ ] 是否存在内存泄漏：否
- [ ] 是否存在死代码：否
- [ ] 是否遗漏功能：旋转与缩放均已处理
