# 开发规范：地形山峰平顶修复

- 触发：用户反馈「地形高度达到一定高度的时候还是变成平的」
- 根因：`hN = (terH / 3.8 * 0.5 + 0.5) * radial` 的线性归一化在 `|terH| > 3.8` 时截断 → 平顶
- 目标文件：`frontend/src/components/Visualizer3D.jsx` line ~419（buildBase 地形块）
- 改动量：极小（1行公式）

## 方案

将线性归一化 `terH / 3.8` 替换为 **tanh 软饱和**，让高值区域平滑过渡而非硬截断：

```js
// BEFORE（平顶）:
const hN = (terH / 3.8 * 0.5 + 0.5) * radial;

// AFTER（软饱和，高值不截断）:
const hN = (Math.tanh(terH * 0.4) * 0.5 + 0.5) * radial;
```

`tanh(x*0.4)` 特性：
- `x=0` → `tanh(0)=0` → `hN=0.5*radial`
- `x=±2` → `tanh(±0.76)≈±0.64` → 线性区
- `x=±4` → `tanh(±1.6)≈±0.92` → 接近饱和但**永远不截断**
- `x=±10`→ `tanh(±4)≈±0.999` → 极限趋近但不等于1

同时调整高度乘数以匹配新范围：
```js
basePositionsTerrain[idx*3+1] = (hN - 0.40) * planeSize * 0.68; // 微调偏移与振幅
```

## 验收
- [ ] 最高峰不再是平顶（有尖锐/圆润的山尖）
- [ ] `vite build` 通过
