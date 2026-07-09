# 开发规范：腻子封面（Clay / Putty Album Cover）动画

- 触发：用户要求「给我一个腻子封面的动画的方案」（随音频跳动的软体封面）
- 目标文件：`frontend/src/components/Visualizer3D.jsx`（新增 `clay` 模式）、`frontend/src/store/*`、`frontend/src/pages/Player.jsx`（模式切换入口）
- 关联：`docs/DEV_VISUALIZER_BEAT_RESPONSE.md`、三模式优化文档、`docs/AI_PROJECT_GUIDELINES.md`
- 状态：**方案文档（待评审，未实现）**

## 一、概念定义

> **腻子封面** = 把专辑封面做成一颗「软泥 / 腻子」质感的圆球：表面哑光、边缘圆润、有轻微不规则的「手捏」痕迹；重拍时整颗球像果冻一样**挤压回弹（squash & stretch）**，并带着**二次抖动的余韵（jiggle）**。

它区别于现有 `liquidmetal`（金属高光、偏硬）与 `coverflow`（平面粒子绸缎）：腻子是**软体（soft-body）**观感——哑光、暖光、慢回弹、有「肉感」。

## 二、为什么用 Mesh 而非纯粒子

现有三模式均为 `Points`（BufferGeometry + PointsMaterial），做不出「哑光腻子」的实体表面质感。腻子封面需要：

| 需求 | Points 粒子 | Mesh 网格 |
|---|---|---|
| 哑光实体表面 | ❌（永远是发光点） | ✅ MeshStandardMaterial |
| 法线光照 / 阴影 | ❌ | ✅ |
| 软体顶点形变 | 勉强（位移点） | ✅ 顶点位移 |
| 专辑图贴图 | 用颜色近似 | ✅ `map` 纹理直贴 |

**决策**：腻子封面使用独立的 `THREE.Mesh`（Icosphere / 高分段 SphereGeometry），`map = 专辑封面纹理`。与粒子系统并存，切换时按现有 `transitionRef` 思路做**透明度淡入淡出 + 缩放桥接**，不破坏单一 Points 的既有逻辑。

## 三、技术方案

### 1. 几何与材质

```js
import * as THREE from 'three';

// 高分段球，顶点够多才能做平滑软体形变
const clayGeo = new THREE.IcosahedronGeometry(planeSize * 0.42, 6); // ≈ 40962 顶点
const clayMat = new THREE.MeshStandardMaterial({
  map: coverTextureRef.current,   // 专辑封面 CanvasTexture
  roughness: 0.85,                // 哑光腻子（非金属）
  metalness: 0.0,
  emissive: new THREE.Color(accentRef.current),
  emissiveIntensity: 0.06,        // 极弱自发光，避免死黑
  bumpScale: 0.04,                // 轻微「手捏」凹凸
});
const clayMesh = new THREE.Mesh(clayGeo, clayMat);
clayMesh.visible = false;
scene.add(clayMesh);
```

- **暖光布光**：一盏柔和方向光（主光）+ 一盏低强度补光（对侧）+ 环境光 `AmbientLight(0xffffff, 0.35)`。腻子要「暖」「软」，色温偏暖。
- **接触阴影**：在球下方放一块半透明暗色圆盘（或 `THREE.ShadowMaterial` 平面），随挤压轻微压扁，强化「放在桌面上的一坨泥」既视感。

### 2. 软体形变（核心）

每帧对网格顶点做**沿法向的低频噪声位移 + 节拍 squash**：

```js
const base = clayBasePositions;        // 原始球顶点坐标缓存
const cur  = clayGeo.attributes.position.array;
const nrm  = clayGeo.attributes.normal.array; // 静止法线

// 静态「手捏」不规则：多频正弦叠加，固定相位（开场算一次）
for (let i = 0; i < vCount; i++) {
  const nx = nrm[i*3], ny = nrm[i*3+1], nz = nrm[i*3+2];
  // 慢速呼吸 + 不规则腻子起伏
  const wob = Math.sin(nx*3 + t*0.6) * 0.5
            + Math.sin(ny*5 - t*0.4) * 0.3
            + Math.sin(nz*7 + t*0.5) * 0.2;
  const k = 1 + wob * 0.05;            // 静态形变幅度 ~5%
  // 节拍挤压（见下）叠加到整球 scale，不在此逐顶点
  cur[i*3]   = base[i*3]   * k;
  cur[i*3+1] = base[i*3+1] * k;
  cur[i*3+2] = base[i*3+2] * k;
}
clayGeo.attributes.position.needsUpdate = true;
clayGeo.computeVertexNormals();        // 形变后重算法线，保证光照正确
```

> ⚠️ `computeVertexNormals()` 每帧开销不小。优化：仅在「有明显形变时」（beatPulse > 0.02 或待机呼吸相位变化大）才重算；静止时跳过。

### 3. 节拍反应：Squash & Stretch + Jiggle

用 `beatPulseRef`（已在 `DEV_VISUALIZER_BEAT_RESPONSE.md` 中提速）驱动整球缩放：

```js
// beatPulse ∈ [0,1]，鼓点置 1 后逐帧衰减
const bp = beatPulseRef.current;
// 挤压：纵向压扁、横向鼓出（体积感守恒近似）
const squashY = 1 - bp * 0.18;         // 纵向最多压 18%
const squashXZ = 1 + bp * 0.12;       // 横向鼓 12%
clayMesh.scale.set(squashXZ, squashY, squashXZ);
```

**二次抖动（jiggle）**：用一组 per-axis 弹簧，鼓点给一个冲量，之后阻尼回弹，产生「果冻余颤」：

```js
// 在鼓点触发处（mode===clay）注入冲量
if (modeRef.current === 'clay') {
  jiggleVel.y -= 0.6;                  // 向下砸一下
}
// 每帧弹簧积分
jiggleVel.y += -jigglePos.y * JIGGLE_K;   // 回中力
jiggleVel.y *= JIGGLE_DAMP;               // 阻尼
jigglePos.y += jiggleVel.y * dt;
clayMesh.position.y = baseY + jigglePos.y * planeSize * 0.06;
```

参数建议：`JIGGLE_K ≈ 80`、`JIGGLE_DAMP ≈ 0.86`（约 3~4 次可见余颤后稳定）。

### 4. 低/中/高频的差异化反应

借力共享包络（`bassAttack / midSmooth / trebleSmooth`）：

| 频段 | 腻子表现 |
|---|---|
| 低频（鼓/贝斯） | 整球 squash 强脉冲 + jiggle 下砸 |
| 中频 | 表面缓慢「流动」起伏幅度增大 |
| 高频 | 顶点高频微颤（噪点感），幅度小 |

```js
// 高频微颤叠加到顶点
const tremble = trebleSmooth * 0.03 * Math.sin(i * 0.7 + t * 30);
// 中频流动：提升静态 wob 幅度
```

### 5. 与现有模式的切换衔接

- 复用 `transitionRef`：从 `liquidmetal`/`galaxy`/`ocean`/`coverflow` 切到 `clay` 时，粒子系统 `opacity` 渐隐、网格 `visible=true` 且 `scale` 从 0.6 弹到 1（弹簧），反向亦然。
- `clayMesh` 的 `map` 复用 `applyCoverColors()` 已生成的 `coverTextureRef`，无需额外资源。
- 无封面（无图）时：`map` 退化为 `accent` 主题色的哑光球，加轻微噪声，保证不空。

## 四、待机表现

无音频时腻子仍「活着」：缓慢呼吸缩放（±3%）、表面极慢流动、`emissiveIntensity` 微呼吸。目标：**即使没歌，也像一坨有生命的软泥在桌上轻轻起伏**。

## 五、验收标准

- [ ] 腻子封面为哑光实体球，专辑图清晰贴附，非发光粒子
- [ ] 鼓点触发明显 squash（纵压横鼓）并带回弹 jiggle 余颤
- [ ] 低频驱动最强、中频流动、高频微颤，分工清晰
- [ ] 暖光 + 接触阴影营造「腻子」质感
- [ ] 与其他四模式切换无回归、无卡顿
- [ ] `vite build` + CI 通过；`computeVertexNormals` 仅在形变时调用

## 六、风险与回退

| 风险 | 应对 |
|---|---|
| `computeVertexNormals` 每帧开销大 | 仅形变时重算；或预计算法线更新增量 |
| 网格与粒子并存内存翻倍 | 网格仅在 `clay` 模式 `visible` 时参与渲染（Three.js 自动剔除不可见对象） |
| 软体参数过抖/过僵 | `JIGGLE_K / DAMP / squash 系数` 集中为常量，便于调参 |
| 专辑图拉伸变形 | 用 `texture.center=(0.5,0.5)` + 等比映射；球极区允许轻微畸变（符合「手捏」感） |
| 回退 | 不引入 clay 模式，或默认隐藏，由设置开关控制 |

## 七、影响范围

| 模块 | 影响 | 说明 |
|---|---|---|
| Visualizer3D.jsx | 新增 | `clay` 模式：网格创建、软体形变、squash/jiggle、着色 |
| 布光 | 新增 | 暖光方向光 + 补光 + 环境光 + 接触阴影 |
| 模式注册/切换 | 修改 | `transitionRef`、`modeRef` 枚举、Player 切换入口 |
| 性能 | 略增 | 仅 clay 模式加载网格；法线按需重算 |
| 其余四模式 | 中性 | 不改动既有逻辑 |

## 八、实现待办（落地时）

1. 在 `Visualizer3D.jsx` 顶部引入 `THREE`（若未引入）并创建 `clayMesh`（懒初始化）。
2. 实现 `buildClayBase()`：缓存原始顶点 + 预计算静态「手捏」噪声相位。
3. 实现 `updateClay(dt, t)`：静态形变 + squash + jiggle + 频段反应 + 按需重算法线。
4. 在 `modeRef` 枚举与 `Player.jsx` 切换入口加入 `clay`，并接入 `transitionRef` 淡入淡出。
5. 接入 `applyCoverColors()` 的封面纹理作为 `map`。
6. 调参：`JIGGLE_K / JIGGLE_DAMP / squash 系数 / 噪声幅度`。
7. `vite build` + 真机（Capacitor Android）验证帧率与观感。
