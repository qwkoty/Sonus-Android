# 开发规范：应用启动图标截字修复

- 触发：用户截图反馈「应用的图片，左右两个字被挡住了」——"Sonus" 的 S 和 s 被截断
- 目标文件：`frontend/android/app/src/main/res/mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher_foreground.png` + `ic_launcher.png` + `ic_launcher_round.png`
- 关联：`docs/DEV_ICON_SONUS.md`（上次图标生成的记录）

## 一、现状诊断

| 项 | 现状 |
|---|---|
| 图标内容 | 白色 "Sonus" 文字（DejaVuSans-Bold） |
| 前景图尺寸 | mdpi=108 / hdpi=162 / xhdpi=216 / xxhdpi=324 / xxxhdpi=432（正方形） |
| 背景色 | `#050608` |
| 字体大小策略 | 二分查找填满 80% 宽度 |

**根因**：Android Adaptive Icon 的前景图层会在运行时被裁切为圆形/圆角方形/水滴形（取决于 OEM），**裁切区域约为中心 66%**（即外圈 17% 会被裁）。当前字体占前景图 80% 宽度 → 裁切后左右边缘的文字必然被吃掉。

## 二、修复方案

### 核心原则：文字必须完全落在「安全区内」

Android adaptive icon 安全区 = 前景图的中心 **66%** 区域（即各边留白 ~17%）。

```python
# 关键参数调整
SAFE_RATIO = 0.60    # 文字宽度占前景图宽度的比例（从 0.80 → 0.60）
PADDING_RATIO = (1 - SAFE_RATIO) / 2  # 左右各留 20% 留白
```

### 具体改动

重新生成全部 15 个 PNG：

| 密度 | fg 尺寸 | legacy 尺寸 | 文字占比 | 说明 |
|---|---|---|---|---|
| mdpi | 108×108 | 48×48 | 60% width | S 完整可见 |
| hdpi | 162×162 | 72×72 | 60% width | |
| xhdpi | 216×216 | 96×96 | 60% width | |
| xxhdpi | 324×324 | 144×144 | 60% width | |
| xxxhdpi | 432×432 | 192×192 | 60% width | |

生成脚本逻辑：
1. Canvas 创建透明背景前景图
2. 字体大小二分查找：使 "Sonus" 文字宽度 = canvas_width × **0.60**（原 0.80）
3. 文字居中绘制（自动获得左右各 20% 安全区）
4. Legacy 图标（`ic_launcher.png` / `_round.png`）：背景 `#050608` + 同上文字（无需再缩，legacy 不裁切）

## 三、验证方式

1. 生成后目视检查每个密度级别的 `ic_launcher_foreground.png`：S 和 s 完整、不贴边
2. Android Studio → Asset Studio Preview 模拟各 OEM 形状（圆/方/圆角方/水滴）确认均不截字
3. 或真机安装 APK 后在桌面查看图标完整性

## 四、风险与回退

| 风险 | 应对 |
|---|---|
| 字太小看不清 | 60% 是安全下限；若仍偏小可试 65%，但 70%+ 有风险 |
| 不同 OEM 裁切区不同 | 66% 是 Google 规范的通用安全区；三星/Huawei/Xiaomi 可能略有差异，60% 足够覆盖所有 |
| 回退 | 恢复到上次的 80% 参数即可 |

## 五、影响范围

| 模块 | 影响 |
|---|---|
| mipmap-* 目录 | 15 个 PNG 全部重新生成（5 密度 × 3 文件） |
| 其他代码 | 无改动 |
