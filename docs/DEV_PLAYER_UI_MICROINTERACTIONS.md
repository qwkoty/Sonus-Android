# 开发规范：播放器 UI 微交互增强

- 触发：用户希望「添加更多的交互动画」，明确方向为**播放器 UI 微交互**（按钮/面板/头像/切歌的过渡与反馈）。
- 目标文件：
  - `frontend/src/index.css`（新增进入动画 keyframe / 头像脉冲环）
  - `frontend/src/pages/Player.jsx`（`FloatPanel` 进入动画、顶栏头像脉冲、切歌标题动画）
- 关联：`DEV_PROFILE_AVATAR_FIX.md`（头像/昵称展示，本次协同）

## 一、现状诊断

| 现状 | 位置 | 问题 |
|---|---|---|
| `FloatPanel` 直接 `return null` 关闭、挂载即显示 | `Player.jsx:164` | 搜索/队列/视觉 面板**无进入/退出动画**，出现突兀 |
| 顶栏头像按钮无状态反馈 | `Player.jsx:294` | 登录后只是静态图，缺"活"的反馈 |
| 切歌时标题/歌手瞬变 | `Player.jsx:298-299` | 歌曲切换无过渡，略生硬 |
| 玻璃按钮已有 hover/active/涟漪 | `index.css:106-184` | 基础交互具备，可在此之上再丰富 |

基础设施已存在：`slideUp`/`fadeIn`/`scaleIn`/`pulseAccent`/`coverBreathe` 等 keyframe（`index.css:178-359`），可直接复用。

## 二、增强方案（全部 CSS 驱动，低侵入）

### 1) 面板进入动画（关键缺口）

新增 `panelIn` keyframe（自顶部轻微下滑 + 淡入，适配 `FloatPanel` 顶部定位）：

```css
@keyframes panelIn {
  from { opacity: 0; transform: translateY(-10px) scale(.985); }
  to   { opacity: 1; transform: none; }
}
.animate-panelIn { animation: panelIn .22s cubic-bezier(.16, 1, .3, 1) both; }
```

`FloatPanel` 应用：面板加 `animate-panelIn`，遮罩加 `animate-fadeIn`：

```jsx
<div className="animate-fadeIn" style={{ position:'fixed', inset:0, zIndex:180 }} onClick={onClose} />
<div className="glass-panel animate-panelIn" style={{ ...top:70, right:14... }}>
```

### 2) 顶栏头像脉冲环（登录态"活"反馈）

新增头像外环脉冲（柔和、不刺眼）：

```css
@keyframes avatarPulse {
  0%,100% { box-shadow: 0 0 0 0 rgba(0,245,212,.0), 0 0 10px rgba(0,245,212,.18); }
  50%     { box-shadow: 0 0 0 3px rgba(0,245,212,.10), 0 0 16px rgba(0,245,212,.30); }
}
.avatar-pulse { animation: avatarPulse 2.4s ease-in-out infinite; }
```

顶栏头像按钮：登录且有头像时加 `avatar-pulse` 类；点击已有 `:active` 缩放（继承自 `.glass-button`）。

### 3) 切歌标题/歌手过渡

用 `key={currentTrack?.id}` 触发重挂载 + `animate-fadeIn`（轻微上滑更自然，复用 `slideUp` 思路）：
将标题、歌手包一层 `<span key={currentTrack?.id} className="animate-slideUp">`，切歌时自动重播进入动画。

### 4) 玻璃按钮 press 反馈增强（轻量）

`.glass-button:active` 现仅有 `translateY(-1px)`（hover 态）。新增按压下沉 + 微缩放，强化"点下去"手感：

```css
.glass-button:active { transform: translateY(0) scale(.95); }
```
（避开与 hover 的冲突：hover 上浮、active 下沉缩放，符合直觉。）

## 三、保持不变

- 现有 `:hover` 上浮、`::after` 涟漪、`pulseAccent`、各 slideUp/fadeIn 动画原样保留。
- 面板定位、尺寸、交互逻辑不变，仅追加进入动画 class。

## 四、验收标准

- [ ] 搜索/队列/视觉 面板打开时有平滑进入动画（下滑淡入），遮罩淡入
- [ ] 登录后顶栏头像有柔和脉冲环反馈
- [ ] 切歌时标题/歌手有过渡动画（不突兀瞬变）
- [ ] 玻璃按钮按压有下沉+缩放反馈，不破坏原有 hover/涟漪
- [ ] `vite build` 通过

## 五、风险

| 风险 | 应对 |
|---|---|
| `key` 重挂载导致标题闪烁 | 用短 `.22s` 动画，幅度小，观感为"轻扫"而非闪烁 |
| 动画在低端机卡顿 | 仅 transform/opacity，GPU 友好；脉冲环周期 2.4s 低频 |
| 与现有 `:active` 冲突 | 仅微调 transform，复用既有 transition 曲线 |
