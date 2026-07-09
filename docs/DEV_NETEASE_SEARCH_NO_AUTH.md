# 开发规范：网易云搜索不强制登录 + 无后端兜底

- 触发：用户反馈「网易云登录已实现,但搜索提示未登录无法使用」
- 目标文件：
  - `frontend/src/pages/Player.jsx` — `doSearch` 移除网易云搜索的登录前置检查
  - `frontend/src/sources/neteaseSource.js` — 搜索失败时增加友好错误提示
  - `frontend/src/api/base.js` — (如需要) 无后端时返回明确信号
- 关联：`docs/DEV_LOGIN_QR_NETEASE.md`、`docs/DEV_MULTI_SOURCE_AUTH.md`

## 现状（修改前）

| 项 | 现状 |
|---|---|
| 网易云登录 | ✅ 已完整实现（后端 weapi 扫码登录 + 前端 UI） |
| 网易云搜索 | ❌ `doSearch` 在 `!creds.isLoggedIn` 时直接跳过,不调用 `adapter.search` |
| 网易云搜索后端 | ✅ `routes/netease.js` → `neSearch()` 无需登录,weapi 公开接口 |
| 搜索面板 | ✅ 已有三音源 Tab（QQ/网易云/酷狗）,`SEARCH_SOURCE_TABS` 已定义 |
| APK 模式 | 网易云全部走后端 weapi；APK 若无后端则请求失败 |

## 设计

### 核心思路

网易云的 `neSearch`（weapi `/weapi/search/get`）**不需要登录态**,是公开接口。因此:

1. **移除登录前置检查**：网易云音源搜索时不检查 `isLoggedIn`,直接调用 `adapter.search`
2. **无后端兜底**：当 `apiBase()` 为空（APK 模式无后端）时,网易云搜索应给出明确提示而非静默失败
3. **QQ/酷狗保持不变**：这两个音源仍需登录（QQ 搜索在 APK 下走原生,酷狗是骨架）

### 改动点

#### 1. `Player.jsx` — `doSearch` 函数（第 206-231 行）

修改登录检查逻辑：网易云音源**不需要登录即可搜索**。

```js
// 修改前（第 212-217 行）
const creds = getSourceCreds(s.id);
if (!creds.isLoggedIn) {
  setSearchMap(prev => ({ ...prev, [s.id]: { ...prev[s.id], loading: false, loggedIn: false } }));
  return;
}

// 修改后：网易云跳过登录检查,其他音源保持原逻辑
const creds = getSourceCreds(s.id);
const noAuthSources = ['netease']; // 无需登录即可搜索的音源
if (!creds.isLoggedIn && !noAuthSources.includes(s.id)) {
  setSearchMap(prev => ({ ...prev, [s.id]: { ...prev[s.id], loading: false, loggedIn: false } }));
  return;
}
```

同时,搜索结果渲染区（第 429 行）也要调整：网易云不显示"未登录"提示,而是正常显示搜索列表或"无后端"提示。

#### 2. `Player.jsx` — 搜索面板结果区域

- 网易云 Tab 不再展示 `!entry.loggedIn` 的「未登录」提示
- 新增「无后端连接」提示：当搜索请求抛出网络错误（APK 无后端）时,展示友好文案

#### 3. `neteaseSource.js` — 搜索方法（第 54-57 行）

- 搜索错误时抛出更具体的错误信息,方便 Player 展示

### 不改动的部分

- `qqSource.js` — QQ 搜索仍需登录,不变
- `kugouSource.js` — 骨架,不变
- `useAuthStore.js` — 多源登录状态管理,不变
- `backend/routes/netease.js` — `neSearch` 本身无问题,不变
- `backend/routes/music.js` — 搜索路由 `platform=netease` 分支,不变

## 验收标准

- [ ] 未登录网易云,在搜索面板切换到网易云 Tab,输入关键词 → 正常返回搜索结果（需后端在线）
- [ ] 已登录网易云,搜索行为与修改前一致（零回归）
- [ ] QQ 音乐 Tab 搜索行为与修改前一致（零回归）
- [ ] APK 模式无后端时,网易云搜索失败 → 显示明确错误提示而非空白
- [ ] `vite build` 编译通过
- [ ] `node -c` 后端语法校验通过

## 风险与回退

- 网易云 weapi `/weapi/search/get` 理论上始终公开,但未来若变更为需登录,仅搜索报错,不影响播放功能
- 若后端不可用（APK 无后端）,网易云 Tab 会显示「无法连接后端」——用户仍可切换到 QQ Tab 正常搜索
- 修改仅涉及 `doSearch` 中的一个条件判断,回退成本极低

## 影响范围

| 模块 | 影响 | 说明 |
|---|---|---|
| `Player.jsx` | 修改 | `doSearch` 条件判断 + 搜索结果 UI |
| `neteaseSource.js` | 可能微调 | 错误信息优化 |
| QQ 搜索 | 无影响 | 逻辑不变 |
| 登录系统 | 无影响 | 不涉及 |
| 播放 | 无影响 | 不涉及 |
| 可视化 | 无影响 | 不涉及 |
