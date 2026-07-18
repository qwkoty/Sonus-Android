# DEV 开发规范：v1.32 修复 QQ 音乐无法播放——统一走后端 /stream 代理

## 1. 背景与问题

- v1.0.145 修复 360° 旋转后，用户反馈 **QQ 音乐无法播放**（部分或全部歌曲无声/报错）。
- 排查两条音源链路（均为 APK 模式，前端运行于 Capacitor WebView）：
  - **网易云**：`neteaseSource.url(id)` = `apiUrl('/stream?platform=netease&id=...')`，由**后端** `routes/music.js` 的 `/stream` 路由用 axios 拉取网易云直链并 pipe 给前端，带 `Access-Control-Allow-Origin: *` + `Accept-Ranges`，Audio 元素（crossOrigin='anonymous'）可直接播放且 Web Audio 可视化正常。
  - **QQ**：`qqSource.url()` = `urlAPK()`，走**前端原生直连**——`CookieReader.httpGet` 直连 QQ 官方 `musicu.fcg` 取 vkey/purl，再把直链包装成本地 `NanoHTTPD` 代理 `http://localhost:port/?url=...` 转发 CDN 流。后端已有更健壮的 QQ 实现却未被使用。
- 后端 `routes/music.js` 的 QQ 实现明显更稳：`getQQUrl` 用 `platform:'23'` + `h5to:'speed'`，且带旧接口 `fcg_music_express_mobile3.fcg` 的 fallback；`/stream` 是专业流代理（支持 Range、CORS、重定向）。
- 判定：**QQ 专属的「前端原生直连 + 本地 NanoHTTPD 代理」链路在部分环境下不可靠/被 QQ 官方风控（服务器/原生层请求被拒）**，是 QQ 无法播放的根因；网易云因统一走后端而正常。

## 2. 目标

- QQ 播放（`url` / `stream`）改为走**后端 `/stream?platform=qq`**，与网易云完全一致，彻底绕开前端原生直连与本地 NanoHTTPD 代理。
- 播放、Web Audio 可视化（频谱）均正常；封面/歌词/登录等既有逻辑不动。

## 3. 方案

- `frontend/src/sources/qqSource.js`：
  - `url` / `stream` 均改为返回 `apiUrl('/stream?platform=qq&id=' + encodeURIComponent(id))`（匿名免费歌路径，与网易云同构）。
  - `apiUrl` 已在该文件顶部 `import`，无需新增依赖。
  - 保留 `urlAPK` 函数定义（作为调试/回退备用，不被 url/stream 引用不影响编译；oxlint 最多产生未使用函数 warning，与现有 15 个 warning 同级）。
  - `cover`（`getProxyUrl` 本地代理）/ `lyric` / 登录相关维持原逻辑不变，缩小改动面。
- `engine.js`：`audio.crossOrigin = 'anonymous'` + 后端 `Access-Control-Allow-Origin: *` 已满足 CORS，播放与可视化均正常，无需改。

## 4. 受影响文件

- `frontend/src/sources/qqSource.js`：导出对象中 `url` / `stream` 两行实现替换。

## 5. 验证

- `vite build` + `oxlint` 0 error（warning 维持既有水平）。
- 真机（v1.0.146）：进入 QQ 音源，搜索并播放**免费歌曲**应能正常出声、频谱可视化正常；与网易云表现一致。
- 备注：VIP/付费歌曲需登录态，本版先用匿名路径修复免费歌；如用户需要 VIP 歌播放，后续在 `/stream` 传 cookie/uin（需注意 query 长度，必要时改 POST）再迭代。
