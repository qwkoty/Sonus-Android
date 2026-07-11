# DEV 开发规范：v1.25 全面扫描 — Bug 修复 + 性能/质量优化

> 适用：Sonus 播放器全前端。本文档汇总「扫描 bug 并修复」与「扫描优化点并优化」两类改动。
> 来源：并行双 agent 扫描（bug hunt / perf+quality audit）+ 人工复核确认。
> 原则：仅做 **低风险、可验证（vite build 通过）** 的改动；可视化幅度常量保持 v1.22 定稿不变。

---

## 一、Bug 修复（正确性）

### B1. 歌词 rAF 导致播放时整屏 60fps 重渲染（M2）
- 文件：`frontend/src/store/usePlayerStore.js`（L58-67）
- 问题：`updateLyricTime` 用永久 `requestAnimationFrame` 每帧 `set({ lyricTime })`；`Player.jsx` 用 `usePlayerStore()` 整库订阅 → 每次 set 触发整屏重渲染（含 Visualizer3D Suspense）→ 播放时持续 60fps 重渲染、耗电卡顿。
- 核实：`lyricTime` 全仓无任何读取方（write-only），rAF 纯属浪费。
- 修复：删除该 rAF 循环；`lyricTime` 字段保留声明（置 0）但不再每帧更新，消除重渲染风暴。（歌词高亮本就由 `timeupdate` 事件驱动，4~10Hz 足够。）

### B2. Visualizer3D 卸载未释放灵气光点资源（M1，GPU 泄漏）
- 文件：`frontend/src/components/Visualizer3D.jsx`（cleanup 段）
- 问题：每次切歌/封面变化 → `<Visualizer3D>` 被 remount（见 O1）→ `spiritGeo`/`spiritMat`/`spiritMat.map` 从未 dispose，长期跳歌耗尽 WebGL 上下文（浏览器上限 ~16）→ 静默渲染失败。
- 修复：cleanup 中补 `spiritGeo.dispose(); spiritMat.dispose(); if (spiritMat.map) spiritMat.map.dispose();`

### B3. LyricStage.mixColor 返回畸形 rgba（L1，潜伏 bug）
- 文件：`frontend/src/components/LyricStage.jsx`（L13-20, 调用点 L117-129）
- 问题：`return \`rgba(${r},${g},${b}\`;` 缺 `,${t})`，依赖 5 处调用方手动补 `,${alpha})`。一旦单独使用即产出非法颜色。
- 修复：`mixColor` 改为返回 RGB 三元组 `${r},${g},${b}`；5 处调用方由 `` `${x},${alpha})` `` 改为 `` `rgba(${x},${alpha})` ``。视觉输出不变。

### B4. galaxy 分支 invRmax 除零保护（U1，防御）
- 文件：`frontend/src/components/Visualizer3D.jsx`（L842 附近）
- 修复：`const invRmax = Rmax > 0 ? 1 / Rmax : 0;`（容器 0×0 时避免 Infinity/NaN 传播）。

### B5. 死代码清理（#10）
- `Visualizer3D.jsx`：删除从未读写的 `prevMidRef`（`useRef(0)`）。
- `engine.js`：删除从未被 import 的导出 `readFrequencyData` / `readFrequencyDataLog`。

---

## 二、性能 / 质量优化（低风险重构，无视觉变化除非标注）

### O1. 模式切换 key 改为按 2D/3D 分组（#1，最高收益）
- 文件：`frontend/src/pages/Player.jsx`（可视化背景层）
- 现状：外层 `key={\`${vm}:${v3m}\`}` + 内层 Suspense `key={\`${cover}-${v3m}\`}` → 每次 3D 子模式切换或换封面都整树 remount，重建 ~20k 粒子 + 新建 WebGL 上下文；且 Visualizer3D 内置的跨模式 `morphT` 形变因此永远不触发（死代码）。
- 修复：外层 `key={vm === '3d' ? '3d' : '2d'}`（仅 2D↔3D 边界 remount，保留 150ms 淡入）；**删除内层 Suspense 的 key**（封面由 Visualizer3D 内部 `coverRef` + useEffect 自行重载）。效果：ring↔wave 仅 effect 重启（廉价）；3D 子模式切换走内部 morph（不再 20k 重建）；换封面经内部 useEffect 重载纹理。

### O2. 地形 fBm 高度预计算（#2，高收益）
- 文件：`Visualizer3D.jsx` buildBase + ocean 动画分支
- 现状：ocean 动画分支每帧每粒子重算 terH(4×sin)+ridge+radial+tanh（≈120k 超越函数/帧）。
- 修复：buildBase 已算过相同 hN/ridge，新增 `terrainHN[i]`/`terrainRidge[i]`（两枚 `Float32Array(COUNT)`）存盘；动画分支直接读取，删除每帧重算。地形着色 `ridgeNow` 也复用 `terrainRidge[i]`。

### O3. liquidmetal 热点衰减预计算（#3，高收益）
- 文件：`Visualizer3D.jsx` 热点初始化 + liquidmetal 动画分支
- 现状：每帧每粒子 ×8 热点重算 `acos`+`exp`（≈318k 超越函数/帧）。法线为静态球面方向（与缩放无关）。
- 修复：热点初始化时预计算 `hotspotFalloff`（一枚 `Float32Array(COUNT*8)`）；动画分支 `hotDisp += pulse * hotspotFalloff[i*8+h]`。

### O4. wave 模式去除每帧正则（#4，中收益）
- 文件：`Visualizer.jsx` drawWave
- 现状：`hslaWithAlpha` 每帧 128 次正则+split+map（解析固定色串）。
- 修复：直接用 `H,S,L` 模板字符串构造渐变端点色（不再走正则），并删除 `hslaWithAlpha` 辅助函数。

### O5. galaxy rN 提升（#5，低收益）
- 文件：`Visualizer3D.jsx` 动画循环
- 现状：`rN = Math.min(1, galaxyR[i]*invRmax)` 在位置/动画/着色三处各算一次。
- 修复：循环顶部统一计算 `const rN = isGalaxy ? Math.min(1, galaxyR[i]*invRmax) : Math.sqrt(v);`，三处复用（同时覆盖 ocean 自身的 `rN=sqrt(v)`）。

### O6. ring 模式 cos/sin 预计算（#6，中收益）
- 文件：`Visualizer.jsx` drawRadialWave
- 现状：填充环（12 层×65 步）与辐射环（4 层×97 步）中 `cos(angle)`/`sin(angle)` 随层重复计算（≈1750 次/帧）。
- 修复：帧内预计算 `cosF/sinF`（FILL_STEPS+1）与 `cosR/sinR`（STEPS+1）查表复用；相位项保留内联。

### O7. 3D 形变 baseFor 提升出循环（#8）
- 文件：`Visualizer3D.jsx` galaxy morph 分支
- 现状：`baseFor(tr.from).pos` 在 i 循环内每粒子调用（每帧 ~20k 次对象分配）。
- 修复：将 `const fb = baseFor(tr.from).pos;` 提升到 i 循环外（morph 期间常量）。

### O8. 时间域数据缓冲复用（#9，低收益）
- 文件：`engine.js` readTimeDomainData
- 现状：每帧 new `Uint8Array(fftSize)`（60×/s GC）。
- 修复：复用模块级持久缓冲（同 `spectrumBuf`/`rawFreq` 做法）。

### O9. 待机色相漂移延伸到尖刺/核心光（#14，质感，on-spec）
- 文件：`Visualizer.jsx` drawRadialWave
- 现状：`idleHueShift` 已用于填充层与外圈光晕，但尖刺 `spikeGrad` 与核心 `coreGrad` 仍硬编码 `H`。
- 修复：两处渐变 hue 加上 `idleHueShift`，待机整片环形场统一缓慢呼吸（纯着色，不加剧幅度）。

---

## 三、验收
- [ ] 播放时 Player 不再 60fps 重渲染（设备无持续卡顿/发热）
- [ ] 切歌/换封面多次后无 WebGL 上下文耗尽报错
- [ ] 歌词舞台颜色正常（mixColor 修复后无非法 rgba）
- [ ] ring / wave / 3D 各模式与 3D 子模式切换流畅（3D 子模式走 morph，不再 20k 重建）
- [ ] 地形/液态金属视觉与修复前一致（仅性能提升）
- [ ] `vite build` 通过
