# 开发规范：QQ 登录改扫码 + 网易云真实登录（前端 + 后端）

- 触发：用户需求「把 QQ 登录改成扫码登录；并新增网易云真实登录（前端后端都要改）」
- 目标文件：
  - 后端：`backend/routes/music.js`（新增网易云 weapi 加密 + 扫码登录/用户信息/搜索/播放/歌词/歌单接口）
  - 前端：`frontend/src/sources/qqSource.js`（新增 QR 方法）、`frontend/src/sources/neteaseSource.js`（骨架→真实实现）、`frontend/src/pages/Login.jsx`（改为音源无关的扫码登录 UI）
- 关联：`docs/DEV_MULTI_SOURCE_AUTH.md`（SourceAdapter 抽象）、`docs/QQ_LOGIN_OPTIMIZATION.md`

## 现状（修改前）
| 项 | 现状 |
|----|------|
| QQ 登录（后端） | **已完整**：`qqQrCreate()`、`/login/qq/qrcode`、`/login/qq/redirect`（收集 cookie）、前端 JSONP 轮询 `ptqrlogin` 状态 |
| QQ 登录（前端） | **仍是 webview + CookieReader 轮询 cookie**（`Login.jsx` 走 `openLoginWebView` + `getCookiesForUrl`），未接后端扫码接口 |
| 网易云（后端） | `routes/music.js` 无任何网易云接口；依赖已含 `qrcode`/`jsqr` |
| 网易云（前端） | `neteaseSource.js` 仅骨架，`ready:false`，方法全抛「暂未支持」 |
| 前端后端地址 | 前端目前只走 APK 原生直连（qqSource→CookieReader），无后端 base URL 约定 |

## 设计

### 统一扫码登录抽象（SourceAdapter 扩展）
在两个音源的适配器上增加扫码登录接口，使 `Login.jsx` 与具体音源解耦：
```js
loginMethod: 'qr',                  // 当前 QQ / 网易云均为扫码
qrCreate: async () => ({ qrcode, key, ... }),   // 取二维码（dataURL）+ 轮询 key
qrCheck: async (key) => ({ status, cookie?, uid?, nickname? }), // status: waiting|scanned|confirmed|expired
```
- **QQ** 的 `qrCheck`：前端 JSONP 轮询 `ptqrlogin`（绕过服务器 IP 风控，沿用后端既有设计），确认后把 `redirectUrl`+`qrsig` POST 到 `/login/qq/redirect` 收集 cookie。
- **网易云** 的 `qrCreate`/`qrCheck`：直接走后端 `/login/netease/qrcode`、`/login/netease/poll`（后端用 weapi 加密与网易云交互，扫码状态在服务端轮询，避免前端暴露加密细节）。

### 前端后端地址
新增 `apiBase()`：`import.meta.env.VITE_API_BASE` → `localStorage.sonus_api_base` → 默认 `''`（同源 `/api/music`，生产由后端托管前端）。网易云方法统一走此后端。

## 后端改动（routes/music.js）

### 1. 网易云 weapi 加密（新增 `neteaseCrypto.js` 或内联 helper）
标准 weapi（AES-128-CBC 两次 + RSA encSecKey，使用公开常量）：
- `aesKey = '0CoJUm6Qyw8W8jud'`，`iv = '0102030405060708'`
- 第一次 AES-CBC(JSON) → 第二次 AES-CBC(随机 16 字节密钥) → `encSecKey = RSA(反转随机密钥, 公开 modulus, exp=010001)`
- 输出 `params`(hex) + `encSecKey`(hex)，post 到 `https://music.163.com/weapi/...`
- 使用 Node 内置 `crypto`，无需新依赖。

### 2. 网易云扫码登录
- `POST /login/netease/qrcode`：`weapi /weapi/login/qrcode/unikey` `{type:1}` → 取 `unikey`；用 `qrcode` 包把 `https://music.163.com/login?qrimg=<unikey>` 生成 dataURL 返回 `{unikey, qrcode}`。
- `GET /login/netease/poll?key=unikey`：`weapi /weapi/login/qrcode/poll` `{key,type:1}`；按返回 code 映射：`800→waiting / 801→scanned / 802→confirmed / 803→expired`；`802` 时从 set-cookie 收集 `MUSIC_U` 等，并 `weapi /weapi/w/nuser/account/get` 取 `{uid, nickname, avatar}`，返回 `{code:0, status:'confirmed', cookie, uid, nickname}`。

### 3. 网易云用户信息 / 目录（使其「真实可用」）
- `GET /user/netease/info?cookie=`：`weapi /weapi/w/nuser/account/get` → `{uid, nickname, avatar}`。
- `GET /search?platform=netease&keyword=&limit=`：`weapi /weapi/search/get` `{s,type:1,limit,offset:0}` → 归一化为与 QQ 同形状（id 前缀 `ne_`）。
- `GET /url?platform=netease&id=`：`weapi /weapi/song/enhance/player/url` `{ids:[id],br:320000}` → `data[0].url`。
- `GET /lyric?platform=netease&id=`：`weapi /weapi/song/lyric` `{id,lv:-1,kv:-1}` → `{lyric, tlyric}`。
- `GET /playlist?platform=netease&id=`：`weapi /weapi/v3/playlist/detail` `{id,n:1000,s:8}` → `playlist.tracks` 归一化。
- `GET /user/netease/playlists?cookie=&uid=`：`weapi /weapi/user/playlist` → 歌单列表。
- 既有 QQ 接口保持不变；`/search`、`/url`、`/lyric`、`/playlist` 按 `platform` 参数分支。

## 前端改动

### qqSource.js
- 新增 `loginMethod: 'qr'`、`qrCreate()`（GET `/login/qq/qrcode`，返回 `{qrcode, qrsig, login_sig}`）、`qrCheck(qrsig)`（JSONP `ptqrlogin` 轮询；确认后 POST `/login/qq/redirect` 得 cookie，返回 `{status, cookie, uid, nickname}`）。保留原生 search/url 等 APK 直连方法不变。

### neteaseSource.js（骨架→真实）
- `ready: true`，`loginMethod: 'qr'`。
- `qrCreate()` → 后端 `/login/netease/qrcode`；`qrCheck(key)` → 后端 `/login/netease/poll`。
- `search/url/lyric/playlist/userPlaylists/userInfo` 全部走后端 `apiBase()`（带 `platform=netease`）。
- `loginByCookie(cookie)`：用 cookie 调 `/user/netease/info` 校验并返回 `{code:0, uid, nickname, cookie}`。
- `getProxyUrl(url)`：原样返回（封面走 `/cover` 代理，与 QQ 同机制由 Player 决定）。
- `parseCredentials/validateLogin`：与 qqSource 同形（按 cookie 提取 uid/nickname）。

### Login.jsx
- 移除 webview + CookieReader 轮询路径；改为**音源无关的扫码 UI**：
  - `const src = getActiveSource();` 取 `loginMethod`。
  - 渲染 `src.qrCreate()` 的二维码图片 + 轮询 `src.qrCheck(key)`（~1.5s）。
  - 状态：`waiting`（展示二维码）→ `scanned`（「已扫描，请在手机确认」）→ `confirmed`（`setAuth({cookie, uid, nickname, sourceId})`）→ `expired`（刷新二维码）。
  - 顶栏标题随音源名变化（QQ 音乐 / 网易云音乐）。
- 保留「账号页 / 歌单 / 退出」逻辑（`sourceId` 已持久化）。
- `handleLogout` 清除对应音源登录态（不再依赖 CookieReader）。

## 验收标准
- [ ] QQ 登录：进入登录页展示二维码，手机扫码 → 前端轮询确认 → 自动 `setAuth`，无需 webview。
- [ ] 网易云登录：切换音源后登录页展示网易云二维码，扫码确认 → `setAuth({sourceId:'netease', ...})`，账号页显示网易云昵称。
- [ ] 后端 `GET /login/netease/qrcode` 返回 `{unikey, qrcode(dataURL)}`；`/login/netease/poll` 状态机正确（800/801/802/803）。
- [ ] 网易云 search/url/lyric/playlist 经后端 weapi 返回与 QQ 同形状的归一化数据（可用 Playwright/接口自测）。
- [ ] QQ 旧接口与前端原生播放（search/url）零回归。
- [ ] `vite build` 与后端 `node -c` 语法校验通过；CI 成功。

## 风险与回退
- 网易云 weapi 加密常量/接口路径随版本变动，若某接口失效，仅该接口报错，不影响整体构建（按接口隔离 try/catch）。
- 网易云服务器对数据中心 IP 有风控，`/login/netease/qrcode` 与轮询走服务端 weapi，**可能**被限频；扫码由用户手机完成，服务端仅轮询，风险低于手机号登录。
- 合规：与既有的 QQ 逆向代理同属一类，需在文档声明「仅用于个人学习/已授权账号」。
- 若扫码 UI 出兼容问题，可保留 CookieReader 作为 QQ 兜底（本期先全切扫码，结构留 `loginMethod` 便于回退）。
