# 开发规范（实现级）：多源同时登录 + 账户中心 + 登录修复 + 统一 Now-Playing

> 项目规则：每次任务 / 代码修改前必须编写开发规范。本文件为 `DEV_UI_LAYOUT_OPT.md`（设计级 v2）的**实现级**落地规范，明确本次编码逐文件改动、数据结构、方法与验收。
> 任务来源：`todo_05e9c5d5d8bb4afeb3b32bb132887e5c`
> 关联任务：#9 修复 Vite 代理（P0）、#10 多源 Auth Store、#6 音源切换一级入口、#7 Profile 响应式、#5 统一 Now-Playing、#8 构建/提交/CI

## 0. 现状确认（代码实际状态，非任务列表标记）
- 仓库工作区除 `docs/DEV_UI_LAYOUT_OPT.md`（未跟踪）外**无任何代码改动**，处于 `d8983de`。
- `vite.config.js` **无 proxy** → 登录请求打到 Vite dev server（返回 HTML），JSON 解析失败（P0）。
- `useAuthStore.js` 为**单源**结构（`cookie/uin/key/nickname`），不支持多源并存。
- `Profile.jsx` 单源写死；`Login.jsx` 的 `QrLoginView` 为**内部组件**未导出，无法被 Profile 内嵌。
- `Player.jsx` 进度条为**独立浮层**（与下方控制卡分离），且「额外」页重复做了音源选择器。

## 1. 依赖顺序
Vite 代理 → QrLoginView 抽离 → 多源 Auth Store → Login 改用 QrLoginView → Profile 账户中心 → Player 统一栏 + 去重音源选择器 → App 路由 → index.css 响应式 → 构建/提交/CI。

## 2. 逐文件改动

### 2.1 `frontend/vite.config.js`（Task #9，P0）
新增 `server.proxy`：
```js
export default defineConfig({
  plugins: [react()],
  base: '/',
  server: { proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true } } },
});
```
- 后端挂载于 `/api/music`（server.js:19-20），`apiUrl()` 产出 `/api/music/*`，故匹配 `/api` 即可。
- dev-only，不影响生产 APK 同源托管。

### 2.2 `frontend/src/components/QrLoginView.jsx`（新增，供复用）
从 `Login.jsx` 抽出 `QrLoginView` 为**独立导出组件**，签名：
```jsx
export default function QrLoginView({ sourceId, onConfirmed, compact = false }) { ... }
```
- 内部 `const src = getSource(sourceId)`；`qrCreate()` / `qrCheck(key, { login_sig })` 轮询（复用 Login 现有逻辑）。
- 状态机：`loading→waiting→scanned→confirmed/expired/unsupported/error`，轮询间隔 1500ms。
- `confirmed` 时调用 `onConfirmed({ cookie, uin, key, nickname })`。
- `compact` 为 true 时用于 Profile 内嵌（更小尺寸、无大标题）。

### 2.3 `frontend/src/store/useAuthStore.js`（Task #10，核心）
重构为**多源存储**，保留向后兼容的顶层字段。

**数据结构**
```js
{
  sources: { qq:{isLoggedIn,cookie,uin,key,nickname,userInfo}, netease:{...}, kugou:{...} },
  activeSourceId: 'qq',
  loadingInfo: false,
  // —— 向后兼容顶层字段（始终等于 activeSource 的派生值）——
  cookie, uin, key, nickname, userInfo,
  isLoggedIn: // 任一源已登录
}
```
**关键方法**
- `setAuth(sourceId, {cookie,uin,key,nickname})`：写入指定源槽位；`c.nickname` 缺省按源给默认值；写后 `deriveActive` 重算顶层字段并 `savePersisted`；随后 `fetchUserInfo(sourceId)`。
- `setActiveSource(id)`：调用 `registry.setActiveSource(id)` 同步音源激活态（供 `music` Proxy 使用）+ 更新 `activeSourceId` + 重算顶层字段 + 持久化。
- `getSourceCreds(id)` / `getActiveCreds()`：取对应源凭证对象。
- `fetchUserInfo(sourceId?)`：刷新指定源（默认 active）用户信息，写回 `sources[id].userInfo` 与 `nickname`。
- `logout(sourceId?)`：指定源登出，缺省全部登出；重算 + 持久化。
- `deriveActive(sources, activeSourceId)` 工具：从当前激活源派生 `cookie/uin/key/nickname/userInfo/isLoggedIn` 作为**普通 state 字段**（避免 zustand `set` 合并破坏 getter 的陷阱）。

**持久化**：key 仍为 `sonus_auth`，结构带 `version:2`；迁移函数把旧 `{cookie,uin,sourceId}` 转成 `sources[sourceId]`。仅持久化已登录且有 cookie 的源。

**兼容性**：`usePlayerStore.authCreds()`、`Player`/`Login`/`Profile`/`App` 现有读取 `cookie/uin/key/isLoggedIn/nickname/userInfo` 均不破坏。

### 2.4 `frontend/src/pages/Login.jsx`
- `import QrLoginView from '../components/QrLoginView'`。
- 原内部 `QrLoginView` 组件**删除**，QR 分支改为 `<QrLoginView sourceId={src.id} onConfirmed={(creds)=>setAuth(src.id, creds)} />`。
- `AccountView` 保留（兼容独立登录页）。

### 2.5 `frontend/src/pages/Profile.jsx`（Task #6 + #7，账户中心）
自上而下：
1. 顶部导航：返回 +「我的账户」+ 刷新。
2. 布局用 CSS 类 `.profile-shell`（双栏）/ `@media(max-width:720px)`（单栏上下），满足响应式（Task #7）。
3. 左栏「账号区」：遍历 `listSources()` 生成**源状态卡**：
   - 已登录（`getSourceCreds(id).isLoggedIn`）：头像 + 昵称 + `source-tag` 彩色标签（QQ 青绿 / 网易云红 / 酷狗灰）+「退出」(`logout(id)`)。点击卡片选中该源并 `setActiveSource(id)`。
   - 未登录 + `ready`：「扫码登录」按钮 → 在卡片内原地展开 `<QrLoginView sourceId={id} compact onConfirmed={(c)=>{setAuth(id,c); setActiveSource(id);}} />`（一次仅展开一个：`expandedSourceId` 状态）。
   - 未登录 + `!ready`：灰色卡片 +「开发中」。
4. 左栏「歌单列表」：展示 `selectedSourceId`（默认首个已登录源）的歌单，调用 `getSource(id).userPlaylists(creds.cookie, creds.uin)`。
5. 右栏「歌单详情」：点击左栏歌单 → 加载 `getSource(id).playlist(pl.id, creds.cookie)` 展示曲目，「播放全部」/ 单曲播放（`playTrackFromList`）。

### 2.6 `frontend/src/pages/Player.jsx`（Task #5，统一 Now-Playing）
- **删除**独立浮层进度条（原 L258-268）。
- 控制卡整合为单一 `.glass-panel`，mini/full 两态均**内嵌进度条**（顶部细条，拖拽复用 `pr` ref + `hp()`）；full 态进度条两侧显示时间。
- 控制卡定位统一为 `left:50%; transform:translateX(-50%); bottom:calc(14px + var(--safe-bottom)); width:min(560px,calc(100% - 32px))`；mini ~58px，full ~100px。
- **移除**「额外」页中的音源选择器区块（音源切换已移至 Profile）；保留「歌词面板」开关。
- 删除不再使用的 `listSources/getActiveSource/setActiveSource` 导入与 `sourceId` 状态。

### 2.7 `frontend/src/App.jsx`
- 头像一律进入 Profile：`onProfile={() => setView('profile')}`。
- `view==='profile'` 渲染 Profile（不再要求 `isLoggedIn`）；保留 `view==='login'` 兼容分支。

### 2.8 `frontend/src/index.css`
新增：
- `.profile-shell / .profile-left / .profile-right` 双栏布局 + `@media (max-width:720px)` 单栏。
- `.source-tag` 胶囊标签（颜色由内联 style 按源指定）。

## 3. 验收标准
1. 登录修复：dev 启动后 QQ/网易云扫码均能生成二维码（不再 JSON parse 错误），流程可走通。
2. 多源同时登录：Profile 中可分别对 QQ、网易云扫码登录，互不干扰，均显示「已登录」。
3. 切换生效：点击已登录源卡片自动 `setActiveSource`，Player 搜索/播放跟随激活源。
4. Now-Playing 统一：底部单一卡片，进度条内嵌，mini/full 平滑。
5. 响应式：宽屏双栏、窄屏（<720px）单栏，不溢出不重叠。
6. 构建：`npm install && npx vite build` 通过；CI 绿灯。

## 4. 风险与回退
| 风险 | 缓解 | 回退 |
|---|---|---|
| zustand `set` 合并破坏 getter | 顶层字段用普通 state + `deriveActive` 重算 | 已规避 |
| 旧 localStorage 失效 | `version:2` 迁移函数 | 删除迁移分支 |
| 多源轮询冲突 | 每个 QrLoginView 独立 state/ref | 退回独立 Login 页 |
| 激活源与凭证错位一个渲染周期 | `setActiveSource` 同步 registry + store | 显式传参 |
| Proxy 仅 dev 生效 | 生产由后端同源托管前端 | 无影响 |
