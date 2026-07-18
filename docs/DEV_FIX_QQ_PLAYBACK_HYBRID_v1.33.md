# 开发规范：QQ 播放链路改回「原生优先 + 后端兜底」（v1.33 / APK v1.0.147）

> 前置任务：v1.32（APK v1.0.146）把 QQ 的 `url`/`stream` 整条改为后端 `/stream` 代理。
> 本规范修正 v1.32 的方向性错误。

## 1. 背景与已验证事实

1. **v1.32 的方向是错的**：把 QQ 原生取链（`urlAPK`，走用户设备真实 IP + 设备 Cookie）整条删掉，改为后端 `/stream` 代理。
2. **已实测证明后端取链对 QQ 不可靠**：在沙箱（云服务器 IP）直接请求 QQ `musicu.fcg` 的 `GetVkeyServer`，无论是否带 `Referer`/`User-Agent`，均返回
   `{"code":0,"req_0":{"code":500003,"subcode":860100001}}`——这是 QQ 对**服务端 IP** 的 vkey 风控。后端 `getQQUrl()` 从云 IP 取不到 `purl`，会返回空。
3. **QQ 的原生链路正是为绕开该风控而设计**：`CookieReader.httpGet` 用原生 `HttpURLConnection`、设备真实 IP、注入 `CookieManager` 的 QQ Cookie，不受 WebView CORS 限制，也不易被服务端风控。该链路自 v1.27 起代码未变，架构完整（`AudioProxyServer` 本地代理、CORS `*`、Range 均正确）。
4. **网易云走后端可用 ≠ QQ 走后端可用**：网易云后端代理命中的是网易云自己的接口，与 QQ 的风控无关。不能类比。

## 2. 问题结论

- v1.0.146（仅后端）会让 QQ **确定性地放不出**（后端被风控 → `audio.play()` 必败，且原生兜底被我删除）。
- 正确做法：恢复原生取链为**首选**，后端 `/stream` 仅作**兜底**。这样：
  - 设备 IP 能绕开风控 → 原生取到链接 → 播放成功（主路径）；
  - 若原生偶发失败（设备也被风控/代理异常）→ 兜底走后端（用户生产后端若在非风控 IP 上则可能成功）。

## 3. 改动方案

文件：`frontend/src/sources/qqSource.js`

- 保留 `urlAPK`（原生，不变）与 `qqUrlBackend`（后端，不变）。
- 新增 `qqUrlHybrid(id, cookie, uin, _key, _mediaMid)`：
  - 先 `await urlAPK(...)`；若返回非空 URL 直接采用（原生优先）。
  - 若原生返回空或抛错，兜底返回 `qqUrlBackend(...)`（后端 /stream）。
- 导出中 `url` / `stream` 由 `qqUrlBackend` 改为 `qqUrlHybrid`。
- 签名与播放器调用方 `music.stream(rawId, cookie, uin, key, mediaMid)` 完全一致，零改动播放器。

## 4. 不改动的部分

- `urlAPK` 内部逻辑（vkey 参数、quality 候选、匿名/登录/VIP 三档尝试）不动。
- `AudioProxyServer`、`CookieReaderPlugin`、`MainActivity` 代理启动逻辑不动（已确认健康）。
- 搜索 / 歌词 / 登录 / 歌单 仍走前端原生，不动。
- 网易云链路不动。

## 5. 验证

- 本地 `vite build` 通过、`oxlint` 0 error。
- 无法在此环境跑 Android APK；核心结论基于：①原生链路代码完整且为设备 IP 设计 ②后端链路已被实测风控。
- 真机安装 v1.0.147 后验证 QQ 免费歌 + 登录后 VIP 歌均可播放；若仍整类放不出，需抓原生 `urlAPK` 日志（已带详细 `console.log`）定位是 vkey 取不到还是本地代理转发失败。

## 6. 风险提示

- 若用户设备 IP 也被 QQ 风控、且生产后端也在风控 IP 上，则原生+后端都失败，需进一步方案（如后端带用户 Cookie 的 VIP 路径、或改用不受风控的第三方解析）。当前混合方案已是覆盖最广的最小改动。
