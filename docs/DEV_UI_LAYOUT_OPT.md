# 开发规范 v2：UI 布局优化 + 登录修复 + 多源同时登录

> 项目规则：每次代码修改 / 任务前必须编写开发规范。本文件为本次迭代的实现依据。

## 1. 背景与问题

### 1.1 登录全部报错（P0 阻塞）
**现象**：QQ 和网易云扫码登录均显示 `生成二维码失败：Unexpected token < in JSON at position 0`。
**根因**：`frontend/vite.config.js` **缺少代理配置**。开发模式下前端跑在 Vite（5173端口），API 请求 `/api/music/*` 打到 Vite dev server，返回的是 index.html（`<html...`），JSON.parse 失败。
**修复**：在 vite.config.js 添加 `server.proxy`，将 `/api` 转发到后端 `http://localhost:3000`。

### 1.2 UI 结构问题
| 页面 | 现状 | 目标 |
|---|---|---|
| **Player 底部** | 进度条与控制条两个独立浮层叠放，视觉断裂、移动端误触风险高 | 合并为统一 Now-Playing 卡片（收起/展开两态） |
| **音源切换入口** | 藏在「视觉设置→额外」三级菜单里 | 移入 Profile 个人页，作为账号管理核心功能 |
| **登录页** | 独立全屏页，扫码前无法切换源；单源认证模型 | 简化为 Profile 内嵌的「登录卡片」（可切换源扫码）；支持多源同时在线 |
| **Profile** | 双栏写死宽度、无响应式 | 响应式 + 账号/歌单/音源三合一管理面板 |
| **Auth Store** | 单 `{cookie, uin, sourceId}` — 同时只能登一个源 | 改为 per-source map：`{ sources: { qq: {...}, netease: {...} } }` |

### 1.3 用户需求
> "简化一点，把那个音源切换和账号登录都放在个人界面，而且可以选择两个音源同时支持"

## 2. 改动范围

### 2.1 必改文件
| 文件 | 改动 |
|---|---|
| **`frontend/vite.config.js`** | 新增 `/api` → `http://localhost:3000` proxy（修复登录） |
| **`frontend/src/store/useAuthStore.js`** | 重构为多源存储模型：`sources: { qq: {...}, netease: {...} }`；`setAuth(sourceId, creds)` 按 sourceId 写入对应槽位；`getActiveCreds()` 取当前激活源的凭证；保留向后兼容的 `cookie` / `uin` getter（取当前激活源值） |
| **`frontend/src/pages/Profile.jsx`** | 重构为「账户中心」：顶部显示已登录各源的状态（头像+昵称+来源标签）；每个未登录源提供「扫码登录」按钮（内嵌 QrLoginView）；底部保留歌单区。响应式双栏→单栏折叠。 |
| **`frontend/src/pages/Login.jsx`** | 大幅简化：不再作为独立页面使用。保留组件但改为由 Profile 内嵌调用（传入 targetSourceId）。或直接将 QrLoginView 组件抽离供 Profile 复用。 |
| **`frontend/src/pages/Player.jsx`** | 合并进度条进控制卡片 = 统一 NowPlaying 栏（mini/full 两态）；移除顶栏音源 pill（已移至 Profile）；精简视觉设置「额外」页（移除重复的音源选择器）。 |
| **`frontend/src/index.css`** | 新增少量辅助样式（source-tag pill、响应式断点 helper）。 |

### 2.2 不改文件
- 后端（routes/server.js / netease.js / music.js）— 无变更
- 可视化组件（Visualizer / Visualizer3D）
- 音频引擎
- 音源适配器（qqSource / neteaseSource / kugouSource / registry）

## 3. 设计细节

### 3.1 Vite 代理（修复登录）
```js
// vite.config.js
export default defineConfig({
  plugins: [react()],
  base: '/',
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
```
效果：开发模式 `http://localhost:5173/api/music/login/netease/qrcode` → `http://localhost:3000/api/music/login/netease/qrcode`。

### 3.2 多源 Auth Store
```
// 新数据结构
{
  sources: {
    qq:      { isLoggedIn:true, cookie:'...', uin:'123', nickname:'...', userInfo:{...} },
    netease: { isLoggedIn:false, cookie:'', uin:'', nickname:'', userInfo:null },
  },
}
// 兼容 getter（给 Player/search/playlist 等消费方用）
get cookie()       → this.sources[activeSourceId]?.cookie || ''
get uin()          → this.sources[activeSourceId]?.uin || ''
get isLoggedIn()   → !!this.getActiveCreds()?.isLoggedIn
get nickname()     → this.getActiveCreds()?.nickname || 'Sonus'
```

关键方法：
- `setAuth(sourceId, { cookie, uin, key, nickname })` — 向指定源写入凭证
- `logout(sourceId)` — 登出指定源（传 undefined 则全部登出）
- `getActiveCreds()` — 返回当前激活源（registry.getActiveSource().id）的凭证对象
- `getSourceCreds(sourceId)` — 返回指定源的凭证
- `fetchUserInfo(sourceId?)` — 刷新指定源用户信息（默认当前激活源）
- localStorage 持久化 key 不变（`sonus_auth`），结构升级带版本标记做迁移。

### 3.3 Profile 重构为「账户中心」

布局自上而下：
```
┌─────────────────────────────────────┐
│ ← 返回          我的账户              │
├──────────┬──────────────────────────┤
│          │                          │
│  账号区   │     歌单详情区             │
│  ┌─────┐ │                          │
│  │ QQ  │ │  (点击左侧歌单展开)         │
│  │✓ 已登录│ │                          │
│  └─────┘ │                          │
│  ┌─────┐ │                          │
│  │网易  │ │                          │
│  │+ 扫码 │ │                          │
│  └─────┘ │                          │
│  ┌─────┐ │                          │
│  │酷狗  │ │                          │
│  │开发中│ │                          │
│  └─────┘ │                          │
│          │                          │
│  歌单列表 │                          │
│  ─────── │                          │
│  我喜欢的..│                         │
│  收藏的歌..│                         │
│          │                          │
├──────────┴──────────────────────────┤
└─────────────────────────────────────┘
```
- 左栏（窄屏时在上）：每个源一张状态卡
  - **已登录**：头像 + 昵称 + 来源标签（pill 色） + 「退出」按钮
  - **未登录 + ready**：「扫码登录」按钮 → 点击后在卡片内原地展开 QrLoginView（不跳转新页面）
  - **未登录 + !ready（如酷狗）**：灰色卡片 + 「开发中」标签
- 右栏（宽屏）/ 下半部（窄屏）：歌单列表（合并所有已登录源的歌单，按源分组显示）
- 点击某源的歌单时，该源自动设为激活源（`setActiveSource(id)`），播放走该源的接口。

### 3.4 Login.jsx 简化
- Login 页面保留但不作为 App 一级路由使用（App.jsx 中 `view==='login'` 分支保留兼容）
- 核心组件 `QrLoginView` 抽离为独立导出，供 Profile 内嵌调用：
  ```js
  export function QrLoginView({ sourceId, onConfirmed }) { ... }
  ```
- Profile 内嵌调用时：`<QrLoginView sourceId="netease" onConfirmed={(creds) => setAuth('netease', creds)} />`

### 3.5 Player —— 统一 Now-Playing 栏
- **删除**独立的悬浮进度条 div（原 L258-268）
- 控制卡片整合为单一 `.glass-panel`，两种形态：

**收起态（mini，~56px 高）**：
```
┌──────────────────────────────────────────────┐
│ ▎▎▎▎▎▎▎▎▎░░░░░░░░░░░░░░░  1:23 / 4:56     │  ← 极细进度条（内嵌顶部）
│ [封面] 歌名 · 歌手     [⏮][▶][⏭] [∨]        │
└──────────────────────────────────────────────┘
```

**展开态（full，~100px 高）**：
```
┌──────────────────────────────────────────────┐
│  1:23  ▎▎▎▎▎▎▎▎▎▎░░░░░░░░░░░░  4:56        │  ← 完整进度条 + 时间
│ [封面]  歌名                                  │
│         歌手           [⏮][▶][⏭]  🔁 🔊 [∧] │
└──────────────────────────────────────────────┘
```
- 定位：`left:50%; transform:translateX(-50%); bottom: calc(14px + safe-bottom); width: min(560px, 100% - 32px)`
- 进度条拖拽复用既有 `pr` ref + `hp()` 函数
- 视觉设置「额外」中的音源选择器**移除**（已在 Profile 中一级展示）

## 4. 验收标准

1. **登录修复**：开发模式下 `npm run dev` 启动后，QQ 和网易云扫码登录均能正常生成二维码（不再 JSON parse 错误）；扫码流程完整走通。
2. **多源同时登录**：Profile 页中可分别对 QQ 和网易云执行扫码登录，互不影响；两个源均可显示「已登录」状态。
3. **切换生效**：在 Profile 中点击已登录源的歌单/搜索时，自动切换激活源；Player 的搜索和播放跟随当前激活源。
4. **Now-Playing 统一**：底部控制区为单一卡片，进度条内嵌；收起/展开过渡平滑。
5. **Profile 响应式**：宽屏双栏、窄屏（<720px）单栏上下排布，内容不溢出不重叠。
6. **构建通过**：`npm install && npx vite build` 成功；CI 绿灯。

## 5. 风险与回退

| 风险 | 缓解 | 回退方案 |
|---|---|---|
| Auth store 结构迁移导致旧 localStorage 数据失效 | 迁移函数检测旧格式并自动转换 | 删除迁移逻辑即可回退旧格式 |
| 多源 store 的 `cookie`/`uin` getter 时序（切换源后旧值残留一个渲染周期） | 在 `setActiveSource` 后立即触发 re-render | 回退为显式传参 |
| Profile 内嵌 QrLoginView 导致轮询冲突（两个源同时扫码） | 每个 QrLoginView 实例独立 state + ref，互不干扰 | 退回独立 Login 页面 |
| Vite proxy 与 Capacitor APK 冲突（APK 不走 Vite） | proxy 仅 dev 生效；生产环境 APK 由后端同源托管前端 | 无影响，proxy 是 dev-only |

## 6. 提交与流程
- 单次提交：`feat(ui): 统一 Now-Playing 栏 + 多源同时登录 + Profile 账户中心 + 修复登录代理`
- 推送 main → CI 轮询至 success。
