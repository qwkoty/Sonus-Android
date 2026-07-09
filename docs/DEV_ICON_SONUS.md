# 开发规范：应用图标改为白色大字「Sonus」

- 触发：用户需求「把图标改为白色大字项目名称」
- 目标文件：
  - `frontend/android/app/src/main/res/mipmap-*/ic_launcher_foreground.png` — 自适应前景（透明底 + 白色 Sonus）
  - `frontend/android/app/src/main/res/mipmap-*/ic_launcher.png` — 传统完整图标（深色底 + 白色 Sonus）
  - `frontend/android/app/src/main/res/mipmap-*/ic_launcher_round.png` — 圆形图标（同传统）
  - `frontend/android/app/src/main/res/values/ic_launcher_background.xml` — 背景色统一为项目深色 `#050608`
- 关联：`docs/AI_PROJECT_GUIDELINES.md`（UI 颜色规范）

## 现状（修改前）

| 项 | 现状 |
|---|---|
| 图标类型 | Capacitor 自适应图标（API 26+）+ 传统 PNG（API <26） |
| 背景 | `@color/ic_launcher_background` = `#000000`（纯黑） |
| 前景 | `mipmap-*/ic_launcher_foreground.png` — SN 字样的位图 |
| 项目名 | `Sonus`（`values/strings.xml` 中 `app_name`） |
| 设计语言 | 玻璃态深色 `#050608` 背景 + 白色强调 |

## 设计

目标：桌面启动图标显示为 **深色背景 + 居中白色粗体「Sonus」大字**，与项目玻璃态深色语言一致。

### 实现方式

使用 Python (Pillow) 批量生成各密度 PNG，保证跨设备清晰不糊：

1. **自适应前景 `ic_launcher_foreground.png`**：透明背景 + 白色 `#FFFFFF` 粗体「Sonus」，字号自动缩放至画布宽度约 80%（居中）。自适应图标的深色底由 `ic_launcher_background` 提供。
2. **传统完整图标 `ic_launcher.png` / `ic_launcher_round.png`**：满画布深色 `#050608` 背景 + 白色「Sonus」，用于 API <26 设备。
3. **背景色**：`values/ic_launcher_background.xml` 由 `#000000` 改为项目深色 `#050608`，使自适应当黑底与 legacy 一致。

### 各密度尺寸

| 密度 | foreground (108 基准) | legacy (标准) |
|---|---|---|
| mdpi | 108px | 48px |
| hdpi | 162px | 72px |
| xhdpi | 216px | 96px |
| xxhdpi | 324px | 144px |
| xxxhdpi | 432px | 192px |

### 字体

使用系统 `DejaVuSans-Bold`（英文渲染无依赖问题），白色粗体。

### 不改动的部分

- `AndroidManifest.xml` — 仍引用 `@mipmap/ic_launcher` / `@mipmap/ic_launcher_round`，无需改
- `mipmap-anydpi-v26/ic_launcher.xml` — foreground/background 引用不变
- `drawable-v24/ic_launcher_foreground.xml`、`drawable/ic_launcher_background.xml` — 未被引用的 Capacitor 模板遗留文件，保留不动（避免误删被引用资源）

## 验收标准

- [ ] 启动器图标显示深色底 + 白色「Sonus」大字
- [ ] 各密度（mdpi~xxxhdpi）下文字清晰不模糊
- [ ] 自适应图标（圆角方）与传统图标视觉一致
- [ ] `vite build` 不受影响（仅 Android 资源）
- [ ] Gradle 构建 APK 成功（CI 自动验证）

## 风险与回退

- 纯资源替换，不影响代码逻辑，无运行时风险
- 若文字在圆形设备（roundIcon）上被裁，可缩小字号比例（脚本参数化，改动成本低）
- 回退：保留旧 PNG 可随时还原

## 影响范围

| 模块 | 影响 | 说明 |
|---|---|---|
| Android 启动图标 | 修改 | 5 密度 × 3 文件 = 15 个 PNG + 1 个 color |
| 前端代码 | 无影响 | 仅资源 |
| 播放/搜索/登录 | 无影响 | 不涉及 |
| 可视化 | 无影响 | 不涉及 |
