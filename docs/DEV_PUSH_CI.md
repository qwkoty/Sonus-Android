# 开发规范（推送与 CI 核验阶段）

> 项目规则：在开始每次的任务之前，都要写一个开发规范，关于你需要更改的事件的开发规范。
> 本文件针对本次"推送已实现改动并核验 CI"的事件。

## 1. 背景
前序 agent 已完成全部 UI 布局优化 + 登录修复 + 多源同时登录的代码实现，并已在提交 `3a2b557` 推送至 `origin/main`（工作树干净）。本阶段事件为：核验 GitHub Actions（Build Android APK）绿灯；必要时补充开发规范文档。

## 2. 本次事件范围
- **不修改业务代码**：所有源码改动已在 `3a2b557`（vite 代理、多源 Auth Store、QrLoginView 抽离、Profile 账户中心、Player 统一 Now-Playing、响应式 CSS、App 路由）。
- **只做**：追加开发规范文档，并核验 CI 结论为 success。

## 3. 改动文件（已推送）
- `frontend/vite.config.js` — `/api` 代理到后端（修复登录 JSON 解析失败，P0）
- `frontend/src/store/useAuthStore.js` — 多源凭证模型
- `frontend/src/components/QrLoginView.jsx` — 抽离可复用扫码组件
- `frontend/src/pages/Login.jsx` / `Profile.jsx` / `Player.jsx` / `App.jsx` / `index.css`
- `docs/DEV_UI_LAYOUT_OPT.md` / `docs/DEV_IMPL_MULTISRC.md`

## 4. 执行步骤
1. 本地 `npm run build` 通过（已确认：BUILD OK）。
2. 追加本开发规范文档并提交。
3. 推送到 `origin/main`（快进）。
4. 轮询 GitHub Actions run 状态直至 `success`，确认产出 release APK。

## 5. 验收标准
- `origin/main` 包含实现提交与开发规范文档。
- GitHub Actions（Build Android APK）结论为 `success`。

## 6. 风险与回退
| 风险 | 缓解 | 回退 |
|---|---|---|
| 原生 APK 构建因签名/环境失败 | 读取 run 日志；仅前端改动不应触发失败 | 确认前端产物 `dist/` 已正确产出 |
| 推送冲突 | 推送前 `git fetch` 确认领先关系 | `git pull --rebase` 后重试 |
