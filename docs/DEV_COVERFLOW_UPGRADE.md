# 开发规范：删除腻子封面 + 粒子封面（Coverflow）动画升级

- 触发：用户反馈「删除腻子封面，我说的是要优化粒子封面可视化，而不是新建一个，那个动画一坨大的而且也不好看。我要给那个粒子封面可视化添加一个好一点的动画」
- 目标文件：
  - **删除**：`Visualizer3D.jsx`（clay 网格/布光/阴影/jiggle 全套）、`Player.jsx`（clay 模式入口）、`docs/DEV_CLAY_COVER.md`
  - **优化**：`Visualizer3D.jsx`（coverflow 动画块 + coverflow 待机着色块）
- 关联：`docs/DEV_VISUALIZER_BEAT_RESPONSE.md`、`docs/AI_PROJECT_GUIDELINES.md`

## 一、现状诊断

### 1.1 当前 coverflow（粒子封面）的问题

| 问题 | 现状代码 | 视觉效果 |
|---|---|---|
| **几乎无 Z 轴深度** | `DOME_DEPTH_RATIO = 0.02` | 粒子基本在一个平面上飘动，看起来像 2D 布料 |
| **动画是"绸缎飘风"** | fold1/fold2/micro/gustX/Y 正弦叠加 | 感觉像一块布在风中抖，不像"专辑封面"该有的样子 |
| **封面颜色只是平铺** | `applyCoverColors()` 逐像素采样到粒子 | 有封面时只是平面色点阵，没有"封面在动"的沉浸感 |
| **待机与播放差异小** | 同一套 fold 逻辑，仅 amplitude 不同 | 切歌后没有明显视觉冲击 |

用户的核心诉求：**让粒子封面模式看起来像一个「活着的、有深度的 3D 专辑封面」，而不是一块飘动的平面布**。

### 1.2 腻子封面的删除范围

需要清理的代码/配置：

| 文件 | 删除内容 |
|---|---|
| `Visualizer3D.jsx` | `buildCoverTexture()` 函数；`coverTextureRef` ref；clay 网格创建（IcosahedronGeometry + MeshStandardMaterial）；暖光布光（DirectionalLight ×2 + AmbientLight）；接触阴影圆盘；`clayMix/clayJigglePos/clayJiggleVel/JIGGLE_K/JIGGLE_DAMP` 局部变量；animate 中 clay 更新块（~80 行）；cleanup 中 clay 资源释放；鼓点检测中 clay 分支 |
| `Player.jsx` | `VIZ_3D_MODES` 中 `{ key:'clay', label:'腻子封面' }` 条目；`v3m` 合法列表中 `'clay'` |
| `docs/` | `DEV_CLAY_COVER.md` 文档 |

## 二、粒子封面动画升级方案

> 设计理念：**「全息唱片 / 浮雕封面」**——粒子组成一个有深度起伏的 3D 封面表面，像一张悬浮的全息唱片或水晶浮雕，随音频呼吸脉动。

### 2.1 几何改造：从平面穹顶 → 有机浮雕表面

当前 basePositionsCover 是轻微穹顶（`cbz = -planeSize * DOME_DEPTH_RATIO * (1-cos(dc*PI/2))`），深度仅 2%。

改为 **有机浮雕**：中心微凸（像唱片中心孔凸起）+ 边缘自然下沉 + 表面有微小随机起伏（模拟介质纹理）：

```js
// buildBase 中 coverflow 形态重写
// 中心凸起（唱片轴心感）
const dome = Math.exp(-dc * dc * 4.0) * planeSize * 0.08; // 高斯凸起，中心最高

// 边缘下沉（形成碟形/碗形）
const edgeSink = dc * dc * dc * planeSize * 0.06; // 三次缓入，边缘平滑沉下

// 微噪声（介质纹理，确定性）
const grainRng = mulberry32(0xA5A5A5A5);
const grain = (grainRng() - 0.5) * planeSize * 0.008;

basePositionsCover[idx*3]   = x;
basePositionsCover[idx*3+1] = y;
basePositionsCover[idx*3+2] = cbz + dome - edgeSink + grain; // 深度从 0.02 → ~14%
```

同时更新法线（用于光照方向感）：
```js
// 简化法线：Z 分量反映坡度
const nz_approx = 1.0 - dc * 0.8; // 中心接近垂直，边缘倾斜
baseNormalsCover[idx*3]   = 0;
baseNormalsCover[idx*3+1] = 0;
baseNormalsCover[idx*3+2] = nz_approx;
```

### 2.2 动画系统重写：「全息呼吸」替代「绸缎飘风」

替换整个 `targetShape === 'coverflow'` 动画分支（当前 line ~935-957）：

#### 核心机制：三层动画叠加

| 层 | 名称 | 驱动 | 效果 |
|---|---|---|---|
| **L1 呼吸层** | hologramBreathe | totalEnergy + bassAttack | 整体深度起伏——封面像在"呼吸"，鼓点时整体前推+回缩 |
| **L2 波纹层** | rippleWave | spectrumSmooth[band] + beatPulse | 从中心向外扩散的同心波纹（但不是地形那种平面涟漪，而是 Z 轴深度涟漪） |
| **L3 光影层** | shimmerDrift | time + trebleSmooth | 粒子亮度/大小微变，营造全息闪烁感 |

```js
} else if (targetShape === 'coverflow') {
  // ═══ 全息唱片 / 浮雕封面 ═══

  // L1 — 整体呼吸：低频驱动深度缩放，鼓点时有"推镜头"感
  const breatheDepth = hasData
    ? (0.03 + totalEnergy * 0.18 + bassAttack * 0.25)  // 音频驱动
    : (0.04 + Math.sin(time * 0.4) * 0.02);            // 待机缓慢呼吸

  // L2 — 径向波纹：频谱能量沿半径向外传播（类似黑胶唱片的沟槽感）
  const bandIdx = Math.min(63, Math.floor(dc * 63));     // 中心=低频, 外圈=高频
  const localE = spectrumSmooth[bandIdx];
  const wavePhase = dc * 14.0 - time * 4.0;               // 外传速度
  const rippleAmp = localE * zAmp * (0.40 + beatFreqBoost * 1.6);
  const ripple = Math.sin(wavePhase) * Math.cos(wavePhase * 0.7 + i * 0.05) * rippleAmp;

  // L3 — 高频闪烁：粒子级微颤，营造全息投影的不稳定感
  const shimmer = trebleSmooth * Math.sin(u * 40 + v * 30 + time * 12 + i * 0.7)
                  * planeSize * 0.004;

  // 鼓点脉冲：整面瞬间的"闪白前推"
  const beatPush = beatPulseRef.current * zAmp * 0.55;

  // 组合位移（主要是 Z 轴！X/Y 仅微量扰动保留封面完整性）
  const microXY = Math.sin(u * 20 + time * 2.5) * Math.cos(v * 15 + time * 1.8)
                   * planeSize * 0.003 * (hasData ? (0.5 + totalEnergy) : 1);

  x = bx + microXY;
  y = by + microXY * 0.7;
  z = bz + (ripple + shimmer + beatPush) * (1 + breatheDepth); // 深度为主
}
```

关键设计决策：
- **Z 轴为主**：位移主要在深度方向（z），保持 X/Y 的封面图案可读性
- **不破坏封面**：microXY 极小（0.3% planeSize），文字/图案始终清晰
- **鼓点有冲击**：beatPush 让整张封面在重拍时向前"冲"一下
- **待机不死寂**：无音频时仍有缓慢呼吸 + 微波

### 2.3 着色优化：封面色彩增强

当前 coverflow 着色在 `!useCover && !isGalaxy && !isTerrain` 分支（line ~1155-1173）。优化：

```js
// coverflow 专属着色增强
if (!useCover && targetShape === 'coverflow') {
  // 封面颜色已由 applyCoverColors() 写入 colorAttr（播放中）
  // 此处处理：无封面时的默认主题色 + 音频点亮 + 全息辉光
  const intensity = 0.50 + totalEnergy * 1.8 + bassAttack * 0.6 + beatPulseRef.current * 1.2;

  // 全息闪烁：高频时粒子亮度随机微跳
  const holoFlicker = trebleSmooth * 0.15 * ((i * 0.13) % 1);

  const outFactor = 1 - dc * 0.18; // 边缘略暗（聚光感）
  colorAttr.array[i*3]   = Math.min(1, ar_mod * intensity * outFactor + bassPulse * 0.55 + holoFlicker);
  colorAttr.array[i*3+1] = Math.min(1, ag_mod * intensity * outFactor + bassPulse * 0.55 + holoFlicker);
  colorAttr.array[i*3+2] = Math.min(1, ab_mod * intensity * outFactor + bassPulse * 0.55 + windGlow * 0.25 + holoFlicker * 1.2);
}
```

## 三、实施步骤

1. **删除腻子封面**（一次性清理）
   - 从 `Visualizer3D.jsx` 移除 clay 全套（网格/布光/阴影/ref/animate块/cleanup）
   - 从 `Player.jsx` 移除 clay 模式条目与合法列表项
   - 删除 `docs/DEV_CLAY_COVER.md`
   - `vite build` 验证零回归

2. **改造 coverflow 基础几何**
   - 重写 `buildBase` 中 coverflow 形态（dome + edgeSink + grain）
   - 更新 `baseNormalsCover` 近似法线
   - 调整 `DOME_DEPTH_RATIO` 或移除（新逻辑不再依赖此常量）

3. **重写 coverflow 动画分支**
   - 替换 line ~935-957 为新的「全息呼吸」三层层叠动画
   - 确保 Z 轴位移为主、X/Y 微扰为辅

4. **优化 coverflow 着色**
   - 增强 intensity 基础值 + 全息闪烁 + 聚光边缘衰减
   - 保持 `applyCoverColors()` 不变（已有封面时直接用）

5. **编译验证 + commit + push**

## 四、验收标准

- [ ] clay 模式完全清除（代码/入口/文档均无残留）
- [ ] 粒子封面有明显 Z 轴深度（非扁平平面）
- [ ] 封面图案/文字在动画中保持可读（不被 X/Y 扰动打碎）
- [ ] 低频鼓点时整面有明显的前推/回缩（"呼吸"感）
- [ ] 有径向波纹沿深度方向扩散（非平面同心圆）
- [ ] 待机时不死寂（缓慢呼吸 + 微波）
- [ ] `vite build` 通过；与其他三模式切换零回归

## 五、风险与回退

| 风险 | 应对 |
|---|---|
| Z 轴深度太大导致穿出视锥体 | `breatheDepth` 上限控制在 `zAmp * 0.8` 以内；clamp 已有 |
| 封面图案因 Z 深度产生错位/撕裂 | 粒子是独立点，不会有几何撕裂问题；Z 差异控制在合理范围 |
| 动画太"素"不如绸缎飘风有动感 | 可随时加回 fold1/fold2 作为 L4 叠加层 |
| 删除 clay 后 localStorage 存了旧值 'clay' | Player 的 `useState` fallback 已含 valid 检查，自动降级为 'liquidmetal' |
| 回退 | git revert 即可恢复到 clay 版本 |

## 六、影响范围

| 模块 | 影响 | 说明 |
|---|---|---|
| Visualizer3D.jsx | 大改 | 删除 clay (~150 行) + 重写 coverflow 几何 + 动画 + 着色 |
| Player.jsx | 小改 | 删除 clay 模式条目 |
| docs | 清理 | 删除 DEV_CLAY_COVER.md |
| 其余三模式 | 中性 | 不改动 |
