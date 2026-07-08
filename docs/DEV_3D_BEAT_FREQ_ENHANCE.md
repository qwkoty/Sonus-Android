# 开发规范：3D 可视化「鼓点增强 · 频率增强」

> 关联仓库：`qwkoty/Sonus-Android`
> 关联文件：`frontend/src/components/Visualizer3D.jsx`
> 文档性质：**强制规范 + 技术方案**（遵循《AI 项目开发规范》第一原则：先分析、先规范、再写码）
> 维护要求：本规范与代码改动同步，每次相关对话须携带并更新
> 版本：v1.0 · 2026-07-08

---

## 0. 本次需求范围（来自用户指令）

1. **代码任务**：给「除 3D 粒子封面（coverflow）以外的两个 3D 可视化」——即 **galaxy（星河漩涡）** 与 **liquidmetal（液态金属）**——增加「鼓点增强 · 频率增强」效果。
2. **方案任务**：另产出一套《QQ 音乐登录系统优化方案》（见 `sonus-qq-login-optimization.md`）。

本规范只覆盖 **第 1 项（代码任务）**。第 2 项由独立方案文档承载。

---

## 1. 背景与动机

现有 3D 可视化已有一套完整的「鼓点」机制，但**鼓点只推动了「位移/强度」，未放大「频率（频谱）响应」**。具体现状（`Visualizer3D.jsx`）：

| 机制 | 位置 | 现状 |
|---|---|---|
| beat 检测 | L594–627 | 低频能量一阶导 `dBas > BEAT_THRESHOLD(0.16)` 触发，产生径向冲击波 `explodeVel` + 置 `beatPulseRef=1`（每帧 ×0.90 衰减） |
| galaxy 用 beat | L616–625 | 仅触发流星 + 闪烁爆发；**频谱涟漪 `ripple` / 颜色 `localE` 未受 beat 放大** |
| liquidmetal 用 beat | L608–615, L823 | `bassPulse` 只增强「鼓点强度（bass）」项 `bassBoost`；**频谱能量 `energy` 驱动的位移未受 beat 放大** |

**问题**：当用户听到重鼓点时，可视化只会「整体冲击一下」，而随音乐频率起伏的细节（涟漪、频谱位移、频段亮度）没有被同步放大，鼓点的「爽感」未充分体现。

**目标**：在每次 beat 触发的瞬间，让**频率（spectrum）响应被额外放大**——形成「鼓点一来，整个画面随频谱炸开/变亮」的复合反馈。

---

## 2. 需求分析

| 维度 | 说明 |
|---|---|
| 功能描述 | beat 触发时，galaxy 与 liquidmetal 中由频谱驱动的部分（位移幅度 + 颜色亮度）被乘以一个随时间衰减的增益 |
| 用户价值 | 强化「鼓点 = 音乐能量爆发」的视听直觉，提升可视化冲击感与沉浸感 |
| 适用范围 | **仅 galaxy + liquidmetal**；**coverflow 明确排除**（用户指定） |
| 不变量 | 不改变 beat 检测阈值/冲击波逻辑；不改动 coverflow、2D 可视化、后端、登录、状态管理 |

---

## 3. 现有实现分析（引用行号）

### 3.1 beat 检测块（复用的入口）
```
L594  const nowS = now * 0.001;
L595  const dBas = bass - prevBassRef.current;
L596  prevBassRef.current = bass;
L597  if (dBas > BEAT_THRESHOLD && (nowS - lastBeatRef.current) > BEAT_COOLDOWN) {
L598    lastBeatRef.current = nowS;
        ... // 径向冲击波 explodeVel
L605    beatPulseRef.current = 1;
        ... // galaxy/liquidmetal 的 beat 模式事件
L627  }
L628  beatPulseRef.current *= 0.90;
```
`beatPulseRef` 是「鼓点强度」包络，已被 FOV punch-in（L911–913）、liquidmetal `bassBoost`（L823）、galaxy 颜色（L861）复用。

### 3.2 galaxy 频率响应点
- 位移涟漪（L677）：`ripple = sin(...) * spectrumSmooth[band] * planeSize * 0.05` —— **频率驱动，未受 beat 放大**
- 频谱细碎抖动（L732）：`jitter = trebleSmooth * 0.5 * sin(...) * planeSize * 0.004` —— **频率驱动**
- 颜色（L861）：`intensity = 0.42 + bassAttack*1.1 + localE*1.6 + beatPulseRef*0.9 + ...` —— `localE`（= `spectrumSmooth[band]`）项**未受 beat 放大**

### 3.3 liquidmetal 频率响应点
- 频谱能量（L782–785）：`energy` 由 `spectrumSmooth` 8 桶求和得到
- 局部脉冲（L787）：`localPulse = (energy*1.15 + bassAttack*0.7 + midSmooth*0.5) * activeFactor`
- 位移（L788）：`displacement = localPulse * planeSize * 0.09` —— `energy`（频率）项**未受 beat 放大**

---

## 4. 设计方案

### 4.1 新增「鼓点频率增强」包络（与 beatPulse 平行，互不干扰）

- 新增 ref：`beatFreqBoostRef = useRef(0)`，与 `beatPulseRef`（L81）并列声明。
- 在 beat 触发块内（`beatPulseRef.current = 1` 之后，L605 附近）同步：`beatFreqBoostRef.current = 1;`
- 在衰减处（L628 之后）同步衰减：`beatFreqBoostRef.current *= BEAT_FREQ_BOOST_DECAY;`
- 渲染帧读取：`const beatFreqBoost = beatFreqBoostRef.current;`（置于 `totalEnergy` 计算附近 L577 之后）。

> 设计理由：复用同一 beat 触发点，但**新增独立的衰减包络**专门服务于「频率放大」，与已有「强度放大」`beatPulse` 解耦，避免相互耦合导致调参困难。

### 4.2 参数表（集中定义，便于调参，遵循项目「间距/动画集中管理」规范）

在文件顶部常量区（L13–25 galaxy 参数附近）新增：

| 常量 | 值 | 含义 |
|---|---|---|
| `BEAT_FREQ_BOOST_DECAY` | `0.90` | 频率增强包络每帧衰减（与 beatPulse 一致，≈鼓点后 0.3s 归零） |
| `GALAXY_BEAT_FREQ_GAIN` | `2.2` | galaxy 鼓点时频谱响应放大倍数（涟漪/抖动/颜色） |
| `LIQUID_BEAT_FREQ_GAIN` | `1.6` | liquidmetal 鼓点时频谱响应放大倍数（位移） |

### 4.3 galaxy 应用点（频率增强）

1. **涟漪（L677）**：改为
   `const ripple = Math.sin(rN*RIPPLE_FREQ - time*RIPPLE_SPEED) * spectrumSmooth[band] * planeSize * 0.05 * (1 + beatFreqBoost * GALAXY_BEAT_FREQ_GAIN);`
2. **频谱抖动（L732）**：`jitter` 后追加 `* (1 + beatFreqBoost * GALAXY_BEAT_FREQ_GAIN)`。
3. **颜色（L861）**：`localE * 1.6` → `localE * 1.6 * (1 + beatFreqBoost * GALAXY_BEAT_FREQ_GAIN)`，使鼓点瞬间该频段更亮。

### 4.4 liquidmetal 应用点（频率增强）

1. **频谱能量位移（L787）**：`localPulse` 中 `energy * 1.15` → `energy * 1.15 * (1 + beatFreqBoost * LIQUID_BEAT_FREQ_GAIN)`。
   - 因 `displacement = localPulse * planeSize * 0.09`，频谱驱动的形变在鼓点被同步放大，与已有的 `bassBoost`（鼓点强度）形成「频率+强度」双维度增强。

> 不触碰：`bassBoost`（L823，保留原有鼓点强度增强）、`bassPulse` 相关、coverflow 全部逻辑、2D `Visualizer.jsx`、后端、登录。

---

## 5. 影响范围

| 文件 | 改动 |
|---|---|
| `frontend/src/components/Visualizer3D.jsx` | 仅新增 1 个 ref + 2 处赋值/衰减 + 1 个局部变量 + 顶部 3 个常量 + galaxy(3 处)/liquidmetal(1 处) 乘法因子 |
| 其他文件 | **无改动** |

- 不影响 coverflow / wave / ring 模式。
- 不影响播放、登录、状态管理、后端。
- 纯前端渲染期计算，无新增网络/存储/权限。

---

## 6. 复用项目既有规范

- **命名规范**：新增常量与 ref 沿用大写下划线常量 + `*Ref` 后缀，与 `BEAT_THRESHOLD`/`beatPulseRef` 一致。
- **注释规范**：复杂逻辑必须注释「为什么」；本次在 beat 触发处与增益处补充「为何新增独立包络」「频率增强目的」说明。
- **性能规范**：增益为 O(1) 标量乘法，单帧额外开销可忽略（不新增数组/循环）。
- **颜色规范**：3D 颜色走 THREE 顶点色 + 加色混合，不涉及 CSS 变量，无需改动。

---

## 7. 验收标准

- [ ] galaxy 模式下，重鼓点时径向涟漪振幅与频段亮度明显大于非鼓点时刻（肉眼可辨）。
- [ ] liquidmetal 模式下，重鼓点时频谱能量驱动的球面形变幅度明显大于非鼓点时刻。
- [ ] coverflow 模式行为与改动前**完全一致**（回归无影响）。
- [ ] 无新增 console 报错；ErrorBoundary 不触发。
- [ ] 帧率无可见下降（增益为标量乘法）。
- [ ] 无死代码、无重复逻辑、未破坏既有鼓点冲击波/强度增强。

---

## 8. 风险与回退

| 风险 | 缓解 |
|---|---|
| 增益过大导致 galaxy 粒子飞出画面 | 增益经 `BEAT_FREQ_BOOST_DECAY` 快速衰减（≈0.3s）；参数可调小 |
| 与现有 `beatPulse`/冲击波叠加过曝 | 二者作用维度不同（频率 vs 强度），且均有限幅 `Math.min(1, ...)` |
| 误改 coverflow | 改动点均带 `isGalaxy` / `targetShape==='liquidmetal'` 条件，已隔离 |

**回退**：本改动集中在单文件、单分支，若异常 `git revert` 对应提交即可，或删除 4.1–4.4 标注的增量即可还原。

---

## 9. 与登录优化方案的关系

本规范只覆盖 3D 可视化增强。QQ 音乐登录系统的优化（WebView 登录、Cookie 读取、风控、安全存储等）由独立文档 `sonus-qq-login-optimization.md` 承载，二者无代码耦合，可独立交付与评审。
