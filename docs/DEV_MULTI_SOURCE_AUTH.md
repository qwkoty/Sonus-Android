# 开发规范：多音源登录抽象层（兼容 QQ / 网易云 / 酷狗）

> 关联仓库：`qwkoty/Sonus-Android`
> 关联文件：`frontend/src/api/music.js` · `frontend/src/pages/Login.jsx` · `frontend/src/store/useAuthStore.js` · `frontend/src/plugins/CookieReader.ts` · `backend/routes/music.js` · 原生 `CookieReaderPlugin.java`
> 文档性质：**强制规范 + 技术方案**（遵循《AI 项目开发规范》第一原则）
> 维护要求：与登录/音源相关迭代同步更新
> 版本：v1.0 · 2026-07-08

---

## 1. 背景：当前「写死 QQ」分布在 5 层

| 层 | 文件 | 写死点 |
|---|---|---|
| 前端音源访问 | `frontend/src/api/music.js` | 全部 QQ：`u.y.qq.com`/`musicu.fcg`、票据 `qm_keyst`、域 `y.qq.com`；`searchAPK/urlAPK/lyricAPK/userInfoAPK/playlistsAPK/playlistAPK` |
| 前端登录页 | `frontend/src/pages/Login.jsx` | L29/L44/L63 硬编码 `https://y.qq.com`；`music.loginByCookie` |
| 前端登录态 | `frontend/src/store/useAuthStore.js` | 存 `cookie/uin/key/nickname`（QQ 语义） |
| 原生桥接 | `frontend/src/plugins/CookieReader.ts` | `getCookiesForUrl(url)` 桥本身通用，但调用方写死 `y.qq.com` |
| 后端代理 | `backend/routes/music.js` | `searchQQ/getQQUrl/getQQLyric/qqUserInfo/...`；路由 `/login/qq/*`；域 `y.qq.com`/`ptlogin2.qq.com` |

> 关键：**主路径（APK 原生）走 `api/music.js` 直连 QQ，不经过后端**；后端仅为 Web 模式兜底。原生 `CookieReader` 桥是**音源无关**的（接受任意 url），只需把"默认域"参数化即可复用。

---

## 2. 目标

把"音源 + 登录"从硬编码 QQ，重构为**可插拔的多音源抽象层**：新增/切换音源时，**调用方（`Player`/`Login`/`usePlayerStore`/`useAuthStore`）零改动**。

---

## 3. 抽象设计

### 3.1 `SourceAdapter` 统一接口（前端 `src/sources/types.js`）

```js
// 每个音源实现一个适配器，覆盖「登录 + 音源访问」全集
interface SourceAdapter {
  id: string;            // 'qq' | 'netease' | 'kugou'
  name: string;          // 显示名
  loginDomains: string[];// Cookie 域，如 QQ: ['y.qq.com']
  // —— 登录 ——
  openLogin(): Promise<{ cookie, uin, key }>; // 内部用通用 CookieReader 桥
  parseCredentials(cookieStr): { uin, key };   // 多 key 优先级各音源不同
  validateLogin(creds): Promise<boolean>;
  // —— 音源访问 ——
  search(keyword): Promise<Track[]>;
  getUrl(rawId, creds): Promise<string>;
  getLyric(rawId): Promise<string>;
  getUserInfo(creds): Promise<UserInfo>;
  getPlaylists(creds): Promise<Playlist[]>;
  getPlaylist(id, creds): Promise<PlaylistDetail>;
}
```

### 3.2 注册表 + 激活源（`src/sources/registry.js`）

```js
const registry = new Map();
export const registerSource = (a) => registry.set(a.id, a);
export const getSource = (id) => registry.get(id);
export const listSources = () => [...registry.values()].map(a => ({ id: a.id, name: a.name, ready: a.ready }));
export const setActiveSource = (id) => localStorage.setItem('sonus_source', id);
export const getActiveSource = () => getSource(localStorage.getItem('sonus_source')) || getSource('qq');
```

- `frontend/src/api/music.js` 改造为：`export const music = getActiveSource();`（兼容 `usePlayerStore` 现有 `music.stream/lyric` 调用，无需改播放器）。
- `Login.jsx` 改为 `CookieReader.getCookiesForUrl(source.loginDomains[0])`，`source.parseCredentials(cookie)`。
- `useAuthStore` 登录态增加 `sourceId` 字段，按源隔离凭证。

### 3.3 原生层：无需改动

`CookieReader` 的 `getCookiesForUrl(url)` / `openLoginWebView()` / `httpGet(url, cookieDomain)` **本就音源无关**，只需调用方传入对应域名（QQ→`y.qq.com`，网易云→`music.163.com`，酷狗→`www.kugou.com`）。无需新增原生代码。

### 3.4 后端（Web 模式，可选同步）

`backend/routes/music.js` 同样抽 `SourceAdapter`（Node 侧），路由改为 `/api/<source>/search` 等，或保留 `/api/music/*` 但内部按 `source` 派发。**优先级低于前端主路径**，列为 P1。

---

## 4. 分阶段实施

| 阶段 | 内容 | 说明 |
|---|---|---|
| **P0 抽象框架 + QQ 实装迁移** | 建 `src/sources/*`；把 `api/music.js` 的 QQ 逻辑整体迁入 `qqSource` 适配器；`registry` + 激活源选择；`Login`/`useAuthStore` 接适配；**行为 100% 不变** | 落地"不写死"的架构，QQ 全功能照旧 |
| **P0 网易云/酷狗骨架** | 实现 `neteaseSource`/`kugouSource` 的 `SourceAdapter` 接口，方法返回"暂未支持"占位；UI 音源切换下拉显示，未就绪项标"开发中" | 架构可插拔，证明"兼容多软件" |
| **P1 后端同步抽象** | `backend/routes/music.js` 抽适配器，Web 模式多音源 | 次要 |
| **P2 真接通网易云/酷狗** | 实现各自加密/签名与登录（见 §6 风险） | 需逆向 + 合规评估，**不在本次默认范围** |

---

## 5. 影响范围

| 文件 | 改动 |
|---|---|
| `frontend/src/sources/types.js` · `registry.js` · `qqSource.js` · `neteaseSource.js`(骨架) · `kugouSource.js`(骨架) | **新增** |
| `frontend/src/api/music.js` | 改为 `export const music = getActiveSource()`（薄壳） |
| `frontend/src/pages/Login.jsx` | 用 `source.loginDomains` 替代写死 `y.qq.com` |
| `frontend/src/store/useAuthStore.js` | 登录态加 `sourceId`，凭证按源 |
| `frontend/src/pages/Player.jsx` | 音源切换入口（下拉） |
| `backend/routes/music.js` | P1 抽适配器（可选） |
| 原生 `CookieReaderPlugin.java` | **不改动**（桥通用） |
| 播放引擎/可视化/队列 | **不改动** |

---

## 6. 风险与合规（必须在实现前知悉）

- ⚠️ **网易云/酷狗无官方开放 API**：其搜索/播放接口需逆向加密——网易云 `weapi`(AES-128+CBC+随机数)/`eapi`(AES-256)，酷狗 `signature`(MD5(dfid+clienttime+...))。实现真接通需自研加密层，且**违反各平台服务条款**，项目风险清单已标注"QQ 接口变更"同类风险会放大。
- ⚠️ **合规建议**：P2 前做合规评估；优先支持具备开放授权的音源；不内置任何平台密钥/证书。
- 回退：抽象层为纯新增 + 薄壳改造，QQ 行为不变，`git revert` 单 PR 即可还原。

---

## 7. 与《QQ 音乐登录优化方案》的关系

本文档是《QQ 音乐登录系统优化方案》(`sonus-qq-login-optimization.md`) 的**扩展与落地**：该方案的 3.1 `AuthAdapter` 抽象在此升级为**多音源 `SourceAdapter`**（登录只是其中一部分）。安全存储、风控规避、票据健壮等优化点仍按该方案推进，且因抽象层隔离，未来可针对单音源做专属优化而不影响其他。

---

## 8. 验收标准（P0）

- [ ] 存在 `src/sources/registry.js`，`listSources()` 返回 ≥3 个音源（QQ 就绪 + 网易云/酷狗骨架）。
- [ ] 切换激活源后，`Login.jsx` 不再出现硬编码 `y.qq.com`（改用 `source.loginDomains`）。
- [ ] QQ 音源全功能（搜索/播放/歌词/登录/歌单）与改造前**行为一致**（回归无差异）。
- [ ] `grep -rn "y.qq.com" frontend/src` 仅剩 QQ 适配器内部，调用方无残留硬编码。
- [ ] 网易云/酷狗在 UI 可切换但功能占位，不崩溃、不误导。
- [ ] 播放引擎、可视化、队列零改动。
