# QQ 音乐登录系统优化方案

> 关联仓库：`qwkoty/Sonus-Android`
> 关联代码：`frontend/src/pages/Login.jsx` · `frontend/src/store/useAuthStore.js` · `frontend/src/plugins/CookieReader.ts` · `frontend/android/.../CookieReaderPlugin.java` · `LoginWebViewActivity.java` · `.github/workflows/build-apk.yml`
> 文档性质：**优化方案**（独立于《3D 可视化开发规范》，两者无代码耦合）
> 版本：v1.0 · 2026-07-08

---

## 1. 现状与痛点

### 1.1 当前登录链路（代码事实）

| 环节 | 实现 | 位置 |
|---|---|---|
| 入口 | 用户点「登录」→ `openLoginWebView()` 打开原生 WebView | `Login.jsx:40-57` |
| 检测 | 每 **1.2s** 轮询 `CookieReader.getCookiesForUrl('https://y.qq.com')` 是否 `loggedIn` | `Login.jsx:27-37` |
| 回调 | 原生 `qqLoginSuccess` 事件 + `visibilitychange` 二次检测 | `Login.jsx:77-93` |
| 校验 | `music.loginByCookie(cookie)` 调用 QQ 接口验证，失败则降级直接写入 | `Login.jsx:98-119` · `api/music.js:289` |
| 持久化 | 登录态（cookie/uin/key/nickname）明文存入 `localStorage['sonus_auth']` | `useAuthStore.js:4,16-30` |
| 重登 | 重启时 `loadPersisted()` 恢复；`fetchUserInfo()` 拉取资料 | `useAuthStore.js:33,59` |
| 登出 | 清 store + `clearCookiesForUrl` | `Login.jsx:134-141` |

### 1.2 已记录的痛点（《项目功能状态》Bug List / 风险清单）

- ⚠️ **`qm_keyst` 偶发拿不到**：依赖超时兜底，仅 `uin` 登录 → VIP 歌曲可能失效。
- ⚠️ **Cookie 登录风控**：接口变动/风控导致登录失败或账号异常。
- ⚠️ **`MIXED_CONTENT_ALWAYS_ALLOW`**：允许 HTTP/HTTPS 混合内容，中间人攻击风险。
- ⚠️ **签名密钥硬编码于 CI**：`build-apk.yml` 中 `SONUS_KEYSTORE_PASS=sonus123456`、keystore 以 base64 入库，公开仓库长期存放不安全。
- ⚠️ **明文存储**：登录态（含 `uin/key` 票据）以明文存 `localStorage`，root/越权可读。

### 1.3 设计层短板（方案视角新增）

- **与音源强耦合**：登录链写死 QQ 音乐，未来接网易云/酷狗需重写。
- **无票据健康度探测**：恢复登录态后不验证是否仍有效，过期才在播放时暴露。
- **无重试/退避**：`loginByCookie` 失败直接降级写入，可能存「假登录」。
- **Web 模式登录不一致**：后端已有 `/login/qq/qrcode`、`/login/qq/cookie`（`backend/routes/music.js`），但前端 APK 模式未复用，两套逻辑分裂。

---

## 2. 优化目标

1. **更稳**：消除 `qm_keyst` 偶发缺失导致的播放降级；登录态可自愈。
2. **更安全**：票据加密存储、密钥移出仓库、收紧混合内容。
3. **更解耦**：登录抽象层隔离音源，便于扩展与测试。
4. **更可观测**：登录成功率、票据健康度可监控、可调试。

---

## 3. 优化方向

### 3.1 登录态抽象层（AuthAdapter）— 解耦音源

> 现状痛点：登录逻辑散落 `Login.jsx` / `useAuthStore.js` / `api/music.js`，强绑定 QQ。

- 新增 `frontend/src/auth/AuthAdapter.js`：统一接口 `login(provider)`, `getValidToken()`, `refresh()`, `logout()`。
- QQ 实现 `QQAuthAdapter` 封装现有 WebView+Cookie 流程；未来新音源只需实现同接口。
- `useAuthStore` 仅持有「抽象凭据」，不再直接拼装 QQ Cookie 字段。
- **收益**：登录链路可单测（mock adapter）、可热插拔音源、与播放解耦。

### 3.2 票据健壮性 — 根治 `qm_keyst` 偶发缺失

> 现状：`extractMusicKey()` 按优先级取 `qm_keyst > qqmusic_key > music_key > ...`（`api/music.js:64-73`），缺失时仅 `uin` 登录。

- **多轮票据补全**：登录成功后若缺 `qm_keyst`，主动调用 QQ「用户信息/歌单」接口，触发服务端下发完整票据；失败则标记为「受限登录」并提示用户重登。
- **VIP/权限探测**：登录后调用一次 `/user/qq/info` 拿 `vipLevel`，存入 `useAuthStore.userInfo`；播放前若歌曲需 VIP 且无票据，提前提示而非播放失败。
- **票据刷新**：`key` 设软过期（如 6h），到期前静默 `refresh()`（复用 Cookie 重新拉一次用户信息触发续期）。

### 3.3 安全存储 — 杜绝明文 + 密钥泄露

| 项 | 现状 | 优化 |
|---|---|---|
| 登录态存储 | `localStorage` 明文 | Android 端经 `CookieReader` 存入 **EncryptedSharedPreferences**；Web 端用 `crypto.subtle` 派生密钥加密后存 `localStorage` |
| 签名密钥 | `build-apk.yml` 硬编码 + `sonus.keystore.b64` 入库 | **迁移到 GitHub Secrets / 私有仓库变量**；CI 从 `secrets` 注入，不入库；或改由用户自签 |
| 混合内容 | `MIXED_CONTENT_ALWAYS_ALLOW` | 改为 **`MIXED_CONTENT_NEVER_ALLOW`** + 音频流统一走本地代理（已是 HTTPS 包装），移除明文回退 |
| Cookie/Token 日志 | 部分 `console.log` 打印 cookie 片段 | 全量清除涉密日志，生产环境仅打脱敏标识 |

### 3.4 风控规避 — 降低被封/被拦概率

> 现状：用官方 WebView 登录 + UA 一致（已较优），但仍有风控风险。

- **UA 锁定**：`LoginWebViewActivity` 固定与 QQ 官方一致的 UA，且 `httpGet` 全程复用，杜绝切换 UA 触发风控。
- **登录频率控制**：WebView 登录 + 轮询合并为「单次打开 + 原生回调」，减少重复探测（当前 1.2s 轮询可改为仅依赖 `qqLoginSuccess` 事件，去掉轮询）。
- **失败指数退避**：`loginByCookie` 失败时不立即降级写入，改为最多 3 次指数退避重试；全失败才标记受限并提示。
- **Cookie 域同步保留**：维持 `syncStreamCookies` 把登录态同步到音频流域名（绕过 403 的关键），但改用 HTTPS-only。

### 3.5 失败兜底与自愈

- **健康度探测**：应用启动时对持久化登录态做一次轻量校验（拉用户信息或musicu 心跳），失败则自动触发静默重登或清退。
- **受限登录提示**：缺 `qm_keyst` 时 UI 明确「部分 VIP 歌曲可能不可播放，点此重新登录」，而非静默降级。
- **跨模式统一**：APK 与 Web 共用 `AuthAdapter`，Web 端走后端 `/login/qq/qrcode` 扫码，避免两套实现漂移。

### 3.6 可观测性

- 登录事件埋点（成功/失败/受限/刷新），本地环形日志，便于排障。
- 票据健康度在「账号页」可视化展示（有效/受限/即将过期）。

---

## 4. 实施路线图（分阶段，遵循项目路线图规范）

| 阶段 | 内容 | 产出 |
|---|---|---|
| P0 安全止血 | 密钥移入 Secrets；`MIXED_CONTENT_NEVER_ALLOW`；清除涉密日志 | 高风险项归零 |
| P1 存储加密 | EncryptedSharedPreferences + Web 端加密存储；`AuthAdapter` 骨架 | 抽象层 + 安全存储 |
| P2 票据健壮 | `qm_keyst` 补全、VIP 探测、软过期刷新、失败退避 | 登录成功率↑ |
| P3 自愈与观测 | 启动健康度探测、受限提示、埋点 | 可运维 |
| P4 多音源 | 第二个 `XxxAuthAdapter` 验证抽象层 | 扩展性验证 |

> 阶段间不跳跃；每阶段更新《项目功能状态》文档。

---

## 5. 验收标准

- [ ] 登录态不再以明文出现在 `localStorage`（Web）或可被 root 直接读（Android）。
- [ ] 仓库内不再存在可还原的签名密钥；CI 从 Secrets 注入。
- [ ] `MIXED_CONTENT_ALWAYS_ALLOW` 已从原生配置移除。
- [ ] 缺 `qm_keyst` 时播放 VIP 歌曲前有明确提示，而非无声失败。
- [ ] 登录失败有明确重试与受限态，不再「假登录」。
- [ ] `AuthAdapter` 可单测，新增音源无需改动 `Login.jsx` / `useAuthStore`。

---

## 6. 风险与权衡

| 风险 | 影响 | 缓解 |
|---|---|---|
| 加密存储改存储格式 | 旧版用户登录态失效，需重新登录 | 版本号迁移：旧 `sonus_auth` 检测即清退引导重登 |
| 收紧混合内容 | 个别旧 CDN 音频可能无法播放 | 优先走本地 HTTPS 代理；保留白名单兜底 |
| 移除轮询改回调 | 个别机型回调延迟 | 保留 `visibilitychange` 兜底检测 |
| 抽象层重构 | 短期回归风险 | 分阶段、单测覆盖、功能状态文档同步 |

---

## 7. 与 3D 增强的关系

本方案与《3D 可视化鼓点频率增强开发规范》**零代码耦合**：前者改登录/存储/安全，后者改 `Visualizer3D.jsx` 渲染。可独立评审、独立合入、独立回滚。
