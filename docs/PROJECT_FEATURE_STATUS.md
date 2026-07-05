# 项目功能状态文档

> 配套文档：《AI 项目开发规范（初始版）》
> 维护要求：每次与代码修改相关的对话都必须携带并同步更新本文档。

---

## 图例

| 符号 | 含义 |
|---|---|
| ✅ | 已实现 |
| ❌ | 未实现 |
| ⚠️ | 存在 Bug / 风险 |
| 🧪 | 已测试 |
| ⏳ | 开发中 |

---

## 功能清单

### 一、基础框架

| 功能名称 | 功能描述及作用 | 页面位置 | 依赖关系 | 完成状态 | 是否测试 | 是否存在 Bug | 备注 |
|---|---|---|---|---|---|---|---|
| 项目目录结构 | 前后端、原生、配置、文档分层清晰 | `/workspace` | 无 | ✅ | 否 | - | 已建立 |
| Vite + React 19 前端工程 | 现代化前端构建与组件框架 | `/frontend` | 无 | ✅ | 否 | - | 使用 Vite 8 + React 19 |
| Express 后端工程 | 提供 RESTful API 与静态资源服务 | `/backend` | Node.js | ✅ | 否 | - | 当前 APK 模式调用较少 |
| Capacitor Android 工程 | 将 Web 应用打包为 Android APK | `/frontend/android` | Android SDK | ✅ | 否 | - | Capacitor 8 |
| GitHub Actions 自动构建 | push 到 main 自动构建 release APK | `.github/workflows/build-apk.yml` | GitHub | ✅ | 否 | - | 使用固定签名 |
| Render 部署配置 | 云服务一键部署后端+前端 | `render.yaml` | Render | ✅ | 否 | - | 生产环境静态资源由后端 serving |

### 二、UI / UX

| 功能名称 | 功能描述及作用 | 页面位置 | 依赖关系 | 完成状态 | 是否测试 | 是否存在 Bug | 备注 |
|---|---|---|---|---|---|---|---|
| 启动屏 Splash | HTML 内嵌启动动画，React 挂载后淡出 | `frontend/index.html` | 无 | ✅ | 否 | - | 最少展示 1.2s |
| 玻璃态设计语言 | 统一的背景、边框、阴影、模糊效果 | `frontend/src/index.css` | CSS 变量 | ✅ | 否 | - | `.glass-*` 系列类名 |
| 主播放器页面布局 | 顶部栏、可视化背景、浮窗搜索/调色、可收起底部控制栏、进度条 | `frontend/src/pages/Player.jsx` | 多个组件 | ✅ | 否 | - | 横屏优先 |
| 搜索 Sheet | 底部弹出搜索面板，实时搜索并播放 | `frontend/src/pages/Player.jsx` | `music.search` | ✅ | 否 | - | 防抖 350ms |
| 播放队列 Sheet | 展示当前播放队列，支持点击切歌 | `frontend/src/pages/Player.jsx` | `usePlayerStore` | ✅ | 否 | - | - |
| 视觉设置 Sheet | 切换可视化模式、调色、开关歌词面板 | `frontend/src/pages/Player.jsx` | 本地状态 | ✅ | 否 | - | 持久化到 localStorage |
| 主题色选择 | 预设色 + 自定义 HSL 调色 | `frontend/src/pages/Player.jsx` | CSS 变量 | ✅ | 否 | - | 通过 `--accent-dynamic` 生效 |
| 安全区适配 | 适配刘海、底部手势条 | `frontend/src/index.css` | CSS env | ✅ | 否 | - | `--safe-top/bottom` |

### 三、核心播放

| 功能名称 | 功能描述及作用 | 页面位置 | 依赖关系 | 完成状态 | 是否测试 | 是否存在 Bug | 备注 |
|---|---|---|---|---|---|---|---|
| HTML5 Audio 播放引擎 | 单例 Audio 元素管理，跨域播放 | `frontend/src/audio/engine.js` | 无 | ✅ | 否 | - | `crossOrigin='anonymous'` |
| Web Audio 频谱分析 | AudioContext + AnalyserNode 提取频谱 | `frontend/src/audio/engine.js` | Audio | ✅ | 否 | - | fftSize=1024 |
| 播放/暂停 | 控制当前歌曲播放与暂停 | `Player.jsx` / `usePlayerStore` | Audio | ✅ | 否 | - | - |
| 上一首/下一首 | 队列内切歌 | `Player.jsx` / `usePlayerStore` | 播放队列 | ✅ | 否 | - | - |
| 进度条拖拽 Seek | 拖动进度条跳转播放位置 | `Player.jsx` | Audio | ✅ | 否 | - | 支持鼠标/触摸 |
| 音量控制 | 调节播放器音量 | `Player.jsx` | Audio | ✅ | 否 | - | 0-1 滑块 |
| 播放模式 | 列表循环 / 随机 / 单曲循环 | `usePlayerStore.js` | 播放队列 | ✅ | 否 | - | 三态切换 |
| 播放队列管理 | 搜索添加、列表播放、去重 | `usePlayerStore.js` | Audio | ✅ | 否 | - | - |
| 歌词解析与同步 | 解析 LRC 时间轴，随播放进度更新 | `usePlayerStore.js` | 歌词 API | ✅ | 否 | - | `[mm:ss.xx]` 格式 |
| 中央当前歌词 | 屏幕中央显示当前一句歌词 | `frontend/src/components/LyricScroll.jsx` | 歌词解析 | ✅ | 否 | - | 淡入淡出 |
| 歌词舞台效果 | 聚光灯、中心光晕、地板反光、浮尘粒子 | `frontend/src/components/LyricStage.jsx` | Web Audio | ✅ | 否 | - | 随音频能量脉动 |
| 漂浮歌词粒子 | 歌词句子上浮氛围效果 | `frontend/src/components/FloatingLyrics.jsx` | 歌词解析 | ✅ | 否 | - | 播放时随机生成 |

### 四、可视化

| 功能名称 | 功能描述及作用 | 页面位置 | 依赖关系 | 完成状态 | 是否测试 | 是否存在 Bug | 备注 |
|---|---|---|---|---|---|---|---|
| 2D 环状频谱 | 径向频谱、中心波形、bass 冲击波 | `frontend/src/components/Visualizer.jsx` | Web Audio | ✅ | 否 | - | ring 模式 |
| 2D 镜像波形 | 上下镜像频谱带 + 时间域波形 | `frontend/src/components/Visualizer.jsx` | Web Audio | ✅ | 否 | - | wave 模式，已阻止多指默认行为 |
| 3D 封面粒子画 | 2 万粒子构成封面穹顶，圆形纹理、间距加大，液体绸缎波动 + 鼓皮膨胀 | `frontend/src/components/Visualizer3D.jsx` | Three.js | ✅ | 否 | - | 3d 模式，手势驱动 |
| 3D 手势控制 | 单指旋转、双指缩放/旋转 | `frontend/src/components/Visualizer3D.jsx` | 触摸事件 | ✅ | 否 | - | - |
| 音频待机动画 | 无音频时的呼吸/涟漪动画 | `Visualizer.jsx` / `Visualizer3D.jsx` | 时间驱动 | ✅ | 否 | - | - |

### 五、搜索与音源

| 功能名称 | 功能描述及作用 | 页面位置 | 依赖关系 | 完成状态 | 是否测试 | 是否存在 Bug | 备注 |
|---|---|---|---|---|---|---|---|
| QQ 音乐搜索（后端） | 后端代理 QQ 音乐搜索 | `backend/routes/music.js` | QQ API | ✅ | 否 | - | `/api/music/search` |
| QQ 音乐搜索（APK 原生） | APK 直接请求 QQ 音乐搜索 | `frontend/src/api/music.js` | CookieReader | ✅ | 否 | - | 绕过 CORS |
| 播放链接获取 | 多轮降级获取播放 URL（匿名/登录/VIP） | `frontend/src/api/music.js` | QQ API | ✅ | 否 | - | 支持多音质 |
| 音频流本地代理 | 本地 NanoHTTPD 代理转发音频流 | `AudioProxyServer.java` | QQ CDN | ✅ | 否 | - | 解决 WebView 403 |
| 封面图代理/加载 | 后端代理或原生加载封面 | `backend/routes/music.js` / `music.cover` | QQ CDN | ✅ | 否 | - | - |

### 六、用户与登录

| 功能名称 | 功能描述及作用 | 页面位置 | 依赖关系 | 完成状态 | 是否测试 | 是否存在 Bug | 备注 |
|---|---|---|---|---|---|---|---|
| QQ 音乐 WebView 登录 | 打开 QQ 音乐页面扫码/密码登录 | `LoginWebViewActivity.java` / `Login.jsx` | WebView | ✅ | 否 | - | 自动读取 Cookie |
| Cookie 读取与解析 | 从 Android CookieManager 读取并解析 uin/key | `CookieReaderPlugin.java` | CookieManager | ✅ | 否 | - | 多 key 优先级 |
| 登录态持久化 | 登录信息保存到 localStorage | `useAuthStore.js` | localStorage | ✅ | 否 | - | 应用重启自动恢复 |
| 用户信息获取 | 获取昵称、头像、VIP 等级 | `useAuthStore.js` / `Profile.jsx` | QQ API | ✅ | 否 | - | - |
| 用户歌单列表 | 拉取并展示用户创建/收藏歌单 | `Profile.jsx` | QQ API | ✅ | 否 | - | - |
| 歌单详情与播放全部 | 查看歌单内歌曲并全部播放 | `Profile.jsx` | QQ API | ✅ | 否 | - | - |
| 退出登录 | 清除状态与 Cookie | `Login.jsx` / `Profile.jsx` | CookieReader | ✅ | 否 | - | - |

### 七、原生层

| 功能名称 | 功能描述及作用 | 页面位置 | 依赖关系 | 完成状态 | 是否测试 | 是否存在 Bug | 备注 |
|---|---|---|---|---|---|---|---|
| CookieReader Capacitor 插件 | 原生 Cookie 读取/清除/HTTP/登录/代理端口 | `CookieReaderPlugin.java` | Capacitor | ✅ | 否 | - | - |
| AudioProxyServer 本地代理 | 转发 QQ 音乐音频流并注入 Cookie | `AudioProxyServer.java` | NanoHTTPD | ✅ | 否 | - | 随机端口 |
| LoginWebViewActivity | 全屏 WebView 登录窗口 | `LoginWebViewActivity.java` | WebView | ✅ | 否 | - | 首页预热 |
| MainActivity 配置 | 全屏沉浸、WebView 设置、启动代理 | `MainActivity.java` | Capacitor | ✅ | 否 | - | - |
| Cookie 同步到音频流域名 | 将登录 Cookie 同步到 stream 域名 | `CookieReaderPlugin.java` | CookieManager | ✅ | 否 | - | 便于 Audio 直接播放 |

### 八、后端 API

| 功能名称 | 功能描述及作用 | 页面位置 | 依赖关系 | 完成状态 | 是否测试 | 是否存在 Bug | 备注 |
|---|---|---|---|---|---|---|---|
| 健康检查 | 服务状态探测 | `backend/server.js` | Express | ✅ | 否 | - | `/health` |
| 搜索接口 | QQ 音乐搜索代理 | `backend/routes/music.js` | QQ API | ✅ | 否 | - | `/api/music/search` |
| URL 接口 | 获取播放直链 | `backend/routes/music.js` | QQ API | ✅ | 否 | - | `/api/music/url` |
| Stream 接口 | 音频流代理（Range/CORS） | `backend/routes/music.js` | QQ CDN | ✅ | 否 | - | `/api/music/stream` |
| Cover 代理接口 | 封面图代理 | `backend/routes/music.js` | QQ CDN | ✅ | 否 | - | `/api/music/cover` |
| Lyric 接口 | 歌词 base64 解码 | `backend/routes/music.js` | QQ API | ✅ | 否 | - | `/api/music/lyric` |
| QQ 扫码登录接口 | 生成二维码 | `backend/routes/music.js` | QQ 登录 | ✅ | 否 | - | `/login/qq/qrcode` |
| Cookie 登录接口 | 直接验证 Cookie 登录 | `backend/routes/music.js` | QQ API | ✅ | 否 | - | `/login/qq/cookie` |
| 用户信息/歌单接口 | 用户信息与歌单 | `backend/routes/music.js` | QQ API | ✅ | 否 | - | `/user/qq/*`, `/playlist` |

### 九、未实现功能

| 功能名称 | 功能描述及作用 | 页面位置 | 依赖关系 | 完成状态 | 是否测试 | 是否存在 Bug | 备注 |
|---|---|---|---|---|---|---|---|
| 后台播放与 MediaSession | 应用切后台持续播放、锁屏控制 | 待设计 | Android Service | ❌ | 否 | - | 需要原生服务 |
| 歌曲收藏/喜欢 | 标记喜欢歌曲 | 待设计 | 用户登录 | ❌ | 否 | - | - |
| 本地缓存/离线播放 | 缓存音频与封面，离线可听 | 待设计 | 存储空间 | ❌ | 否 | - | - |
| 历史播放记录 | 记录并展示最近播放 | 待设计 | 本地/后端存储 | ❌ | 否 | - | - |
| 深色/浅色主题切换 | 多主题切换 | 待设计 | CSS 变量 | ❌ | 否 | - | 当前只有深色 |
| 国际化 i18n | 多语言支持 | 待设计 | 翻译文件 | ❌ | 否 | - | 当前仅中文 |
| 单元测试与 E2E 测试 | 自动化测试覆盖 | 待设计 | 测试框架 | ❌ | 否 | - | 目前无测试 |
| 后端缓存持久化 | Redis/文件持久化缓存 | `backend/routes/music.js` | 缓存中间件 | ❌ | 否 | - | 当前仅内存 Map |
| 歌单搜索 | 搜索并添加他人歌单 | 待设计 | QQ API | ❌ | 否 | - | - |
| 歌手/专辑详情页 | 展示歌手/专辑信息 | 待设计 | QQ API | ❌ | 否 | - | - |
| 分享功能 | 分享歌曲/歌单链接 | 待设计 | 系统分享 | ❌ | 否 | - | - |

---

## 维护记录

### TODO

- [ ] 接入 Android 后台播放服务（MediaSession / ForegroundService）
- [ ] 增加歌曲收藏/喜欢功能
- [ ] 增加历史播放记录
- [ ] 补充自动化测试（单元 + E2E）
- [ ] 后端缓存持久化（避免内存 Map 重启丢失）
- [ ] 修复 `AndroidManifest.xml` 中的乱码注释
- [ ] 评估 `MIXED_CONTENT_ALWAYS_ALLOW` 与固定签名密钥的安全风险

### 已完成

- Vite + React 19 + Express 基础框架搭建
- Capacitor Android 工程集成
- 玻璃态 UI 设计语言与播放器页面
- 2D / 3D 音频可视化
- 搜索、播放、歌词、队列等核心功能
- QQ 音乐 WebView 登录与用户信息/歌单同步
- CookieReader 原生插件与 AudioProxyServer 本地代理
- GitHub Actions 自动构建 release APK
- Render 部署配置

### 待优化

- 3D 可视化首次加载封面时的性能
- 播放失败时的错误提示更友好
- 后端 `/api/music/*` 在 APK 模式下利用率低，可考虑统一或精简
- 日志分级与生产环境日志清理

### Bug List

- 无已确认功能性 Bug，以下潜在风险：
  - `MIXED_CONTENT_ALWAYS_ALLOW` 允许 HTTP/HTTPS 混合内容，存在中间人攻击风险。
  - 构建脚本中 keystore 密码硬编码于 CI 配置，不适合公开仓库长期存放。
  - 登录流程偶尔可能拿不到 `qm_keyst`，依赖超时兜底（仅 uin 登录）。

### 风险清单

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| QQ 音乐接口变更 | 搜索/播放/登录全部失效 | 抽象 API 层，便于快速替换 |
| Cookie 登录风控 | 登录失败或账号异常 | 使用官方 WebView 登录，UA 一致 |
| 音频 CDN 403/CORS | 无法播放 | 本地代理 + Cookie 同步 |
| 签名密钥泄露 | APK 被伪造 | 迁移到 GitHub Secrets 管理 |
| 后台播放未实现 | 切后台暂停 | 后续接入 MediaSession 服务 |

### 技术债务

- `frontend/src/utils/platform.ts` 中 `isNativeApp()` 硬编码返回 `true`，未来若支持 Web/PWA 需重构。
- 后端使用内存 `Map` 缓存，无 TTL 清理策略，长期运行可能内存增长。
- APK 模式与网页模式的 API 实现存在重复逻辑（`backend/routes/music.js` vs `frontend/src/api/music.js`）。
- CSS 中部分样式仍使用内联 `style`，与 glass 类名混用，建议逐步收敛到统一方案。

---

## 更新日志

| 日期 | 版本 | 更新内容 | 更新人 |
|---|---|---|---|
| 2026-07-05 | v1.0 | 初始版本，基于 Sonus 项目现状建立 | AI Assistant |
| 2026-07-05 | v1.1 | Player UI：搜索/调色改为浮窗；底部控制栏可收起/展开；禁用全局文本选择；3D 可视化开启 360° 自转并优化性能 | AI Assistant |
| 2026-07-05 | v1.2 | 回滚 3D 到原始 2 万粒子并改为封面穹顶 + 液体绸缎动画；修复 wave 模式双指滑动卡顿；新增歌词舞台效果 | AI Assistant |
