# 开发规范：控制栏收起位置修复 + 二维码不显示排查修复

> 触发事件：用户反馈两处回归/缺陷
> 1. 底部音乐控制栏"收起"后没有缩到左下角（被改为整条居中，丢失原行为）
> 2. 扫码登录的二维码仍然不显示
>
> 依据项目规则：每次代码修改/任务前必须写开发规范。本文为本次修复事件规范。

## 一、现状与根因

### 事件 A：控制栏收起位置（确定性代码回归）
- **原行为**（`d8983de`，`Player.jsx`）：
  - 收起态 `!controlsExpanded`：胶囊固定在**左下角** `left:14, transform:none, width:156, height:52`（小尺寸）。
  - 展开态 `controlsExpanded`：居中宽条 `left:50%, transform:translateX(-50%), width:min(520px)`。
  - 另有独立细进度条（收起时居中贴底上方，展开时上移）。
- **回归引入**（`3a2b557`，统一 Now-Playing 重构）：
  - 把收起态也改成了 `left:50% / translateX(-50%) / width:min(560px)` 的**整条居中**，导致"收起缩到左下角"行为丢失。
- **修复目标**：恢复收起态为左下角紧凑小胶囊；展开态维持居中宽条。

### 事件 B：二维码不显示（运行环境 + 健壮性）
- 经沙箱实测（后端起在 :3000）：
  - QQ 二维码接口 `/api/music/login/qq/qrcode` 正常返回 `data:image/png;base64,...`，结构 `{code:200,data:{qrcode,qrsig,login_sig}}`，前端 `QrLoginView` 渲染路径正确。
  - 网易云接口在沙箱因数据中心 IP 被风控，所有 weapi 均返回空 body（环境问题，非逻辑错误；用户真实机器通常不受影响）。
- **根因结论**：用户侧"二维码不显示"的主因是**前端请求 `/api/...` 时后端未运行**（dev 下 Vite 代理转发到 `localhost:3000`，后端未启动 → 连接失败）。`QrLoginView` 在生成失败时：
  - 仅 `error` 文案提示，**无重试入口**（只有 `expired` 态有刷新按钮）；
  - 若请求挂起/返回空 `qrcode`，会一直转圈或空白，用户无从感知与恢复。
- **修复目标**：
  - 后端不可达/生成失败时给出**清晰可诊断文案**（如"登录服务未连接，请先启动后端"）。
  - 为 `error`/空结果态增加**重试按钮**，与 `expired` 体验一致。
  - 不改动正常登录成功链路。

## 二、改动范围与方案

### 文件 1：`frontend/src/pages/Player.jsx`
- 收起态（`!controlsExpanded`）恢复为左下角紧凑胶囊：
  - `position:absolute; left:14; bottom:calc(14px + var(--safe-bottom)); transform:none`
  - 固定高度 ~52、紧凑内边距，仅含：封面 + 播放/暂停 + 下一首 + 展开按钮。
  - 为保留进度可见性，收起态**上方保留一条居中细进度条**（沿用原 v2 设计：收起态 `bottom:calc(72px + safe-bottom)`，宽 `min(560px)`，带起止时间）。
- 展开态维持现状（居中宽条，内嵌 `ProgressStrip` + 全控件）。
- 过渡动画：保留 `transition` 让展开/收起平滑（可选，不影响功能）。

### 文件 2：`frontend/src/components/QrLoginView.jsx`
- `phase` 增加稳定处理：`error` 态渲染与 `expired` 一致的居中"刷新二维码"按钮（调用 `startQr`）。
- `qrImage` 为空且非 loading 时（理论上不会，因错误已切 `error`），兜底显示重试入口。
- 文案优化：`error` 时若为网络/连接类，提示"登录服务未连接，请确认后端已启动后重试"。

### 文件 3（仅若需）：`frontend/vite.config.js`
- 维持既有 `/api` → `http://localhost:3000` 代理（本次不改）。
- 备注：生产模式下 `backend/server.js` 同源托管前端与 `/api`，无需代理。

## 三、不动的部分（避免回归）
- 多源 Auth Store、Profile 账户中心、扫码轮询逻辑（JSONP / weapi）均不改动。
- 展开态布局与视觉不改动。
- 网易云/QQ 后端路由不改动（沙箱 IP 风控非代码问题）。

## 四、验证
1. `cd frontend && npm run build` 通过。
2. `npx oxlint` 无新增 error。
3. 启动后端 `cd backend && npm start`（:3000）+ 前端 `cd frontend && npm run dev`（:5173），访问 `/api/music/login/qq/qrcode` 经代理返回 base64 二维码数据。
4. 视觉：收起控制栏应位于屏幕左下角；点击展开回到居中宽条。
5. 后端未启动时，登录页应显示"登录服务未连接"+ 重试按钮，而非空白/无限转圈。
6. 推送前 `git` 提交，CI（Build Android APK）绿灯。
