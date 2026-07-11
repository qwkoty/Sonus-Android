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
| 3D 手势控制 | 单指 360° 偏航+俯仰、双指缩放/扭转、滚轮/鼠标缩放、自动旋转空闲恢复 | `frontend/src/components/Visualizer3D.jsx` | 触摸/鼠标事件 | ✅ | 否 | - | coverflow/liquidmetal/galaxy 均支持；默认关闭自动旋转 |
| 3D 星河漩涡 | 对数螺旋星系盘 + 中心核球；低频推核球呼吸、频谱激发由内向外径向涟漪波、鼓点甩出冲击波(弹簧回弹)；内核=主题色、外圈=封面平均色 | `frontend/src/components/Visualizer3D.jsx` | Three.js + Web Audio | ✅ | 否 | - | galaxy 模式，约 3.2 万粒子；盘面内缓慢公转(非镜头自转) |
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
| 用户信息获取 | 获取昵称、头像、VIP 等级 | `useAuthStore.js` / `Profile.jsx` | QQ API | ✅ | 否 | - | v1.15 修复个人界面头像/昵称不显示（兼容多种响应结构 + qlogo 头像兜底） |
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
| 后台播放与 MediaSession | 应用切后台持续播放、锁屏控制 | `MusicPlaybackService` + `MediaControlPlugin` | Android Service | ✅ | 否 | - | 前台服务保活 WebView + MediaSession 通知/锁屏控制 |
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

### 协作规则

- 每次任务结束之后，必须将改动**提交并推送到 `origin/main`**（CI 自动构建 APK）。
- 每次代码修改 / 每次任务开始前，先写对应的 `docs/DEV_*.md` 开发规范（见《AI 项目开发规范》）。

### TODO

- [ ] 接入 Android 后台播放服务（MediaSession / ForegroundService）
- [ ] 增加歌曲收藏/喜欢功能
- [ ] 增加历史播放记录
- [ ] 补充自动化测试（单元 + E2E）
- [ ] 后端缓存持久化（避免内存 Map 重启丢失）
- [ ] 修复 `AndroidManifest.xml` 中的乱码注释
- [ ] 评估 `MIXED_CONTENT_ALWAYS_ALLOW` 与固定签名密钥的安全风险
- [ ] 三模式可视化优化（规范已就绪，待实施）：液态金属金属质感着色 / 星河核心辉光+密度波 / 地形法线光照（见 `DEV_VISUALIZER_OPT_*`）

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
| 2026-07-08 | v1.3 | 3D 可视化增加 360° 旋转：单指/鼠标拖拽支持偏航+俯仰（俯仰限 ±85°），双指捏合缩放+扭转，滚轮缩放；自动旋转改为交互后空闲 2.5s 恢复 | AI Assistant |
| 2026-07-09 | v1.4 | 网易云搜索移除登录前置检查（搜索接口公开，无需登录）；搜索错误增加具体提示 | AI Assistant |
| 2026-07-09 | v1.5 | 地形可视化大改：频段反转为中心低频/外围高频，静态 fBm 山脉 + 地形色带 + 等高线；新增「每次任务结束推送 main」协作规则 | AI Assistant |
| 2026-07-09 | v1.6 | 分析液态金属/星河漩涡/地形三可视化优化方案，新增 3 份 DEV 优化规范（暂无代码改动，待实施） | AI Assistant |
| 2026-07-09 | v1.7 | 实施三模式节奏反应优化：共享包络提速（bassAttack attack 0.70/release 0.16、频谱非对称平滑）、SHOCK_GAIN 2.2→2.6；液态金属整球 squash + bassBoost 增强；星河 beatSpin 0.14→0.20 + 核心更亮；地形主峰脉冲 0.10/2.5→0.14/3.2 + 涟漪增强 | AI Assistant |
| 2026-07-09 | v1.8 | 新增「腻子封面（Clay/Putty）」动画方案开发规范 DEV_CLAY_COVER.md：哑光软体球 + squash&stretch + jiggle 二次抖动 + 暖光接触阴影，待评审实施 | AI Assistant |
| 2026-07-10 | v1.9 | 落地「腻子封面」模式：独立哑光软体球 + squash&stretch + jiggle 弹簧 + 暖光接触阴影，与粒子系统交叉淡入；Player 新增 clay 模式入口 | AI Assistant |
| 2026-07-10 | v1.10 | 三份新开发规范：DEV_TERRAIN_3D（地形立体化改造）、DEV_ICON_FIX_TRUNCATE（图标截字修复）、DEV_COVERFLOW_UPGRADE（删除腻子模式+粒子封面升级为错层黏土封面：4层错开软质叠片+各层相位动画+鼓点jelly传播） | AI Assistant |
| 2026-07-10 | v1.11 | 实施三项优化：①地形立体化（fBm振幅×1.6+ridged noise+伪漫反射+涟漪收敛）②图标截字修复（15个PNG重生成，文字占比80%→60%，左右留白21.5%）③删除腻子模式+粒子封面升级为错层黏土封面（4层Z错开+各层相位呼吸/飘移+鼓点jelly接力+封面按层渐隐）；vite build 通过 | AI Assistant |
| 2026-07-10 | v1.12 | 三项精细调整：①粒子封面重写为「腻子脱落」动画（全部初始前层完整封面，播放时个别粒子掉到后层再浮回；弹簧积分平滑过渡+频谱驱动脱落+自动回弹）②地形平顶修复（线性归一化→tanh软饱和，山峰不再截断）③星河漩涡扩大音频响应范围×2~3（涟漪0.045→0.12/频谱柱0.10→0.24/核球0.08→0.18/Z波0.04→0.10/臂波0.012→0.03）并去除鼓点冲击波(SHOCK_GAIN)+切向冲击(beatSpin) | AI Assistant |
| 2026-07-10 | v1.13 | 粒子封面「腻子脱落」增强：回弹衰减 0.997→0.972（脱落周期~3.3s→~0.8-1s，粒子持续起落而非掉一次冻结）；新增 MAX_CLAY_FALLEN=2000 硬上限约束同时脱落数(≤10%)保证封面始终完整；随机脱落系数 0.002→0.004 且完全随机位置；clayDepth 增加[0,1]钳制；稳态≈1500~2000 个粒子在随机位置连续起落、落了会回、回了又落 | AI Assistant |
| 2026-07-10 | v1.14 | 粒子封面脱落「保持清晰可读」修正：applyCoverColors 脱落粒子亮度 0.25→0.80、主题色混合 90%→15%（保持封面色不洗图案）；待机着色脱落变暗 75%→20%；新增 CLAY_FALL_DEPTH_SCALE=0.6 把凹陷从 0.30 画幅收到≈0.18 画幅消除透视破洞；脱落动效与自动回弹不变。新增 DEV_COVERFLOW_READABLE.md | AI Assistant |
| 2026-07-10 | v1.15 | 修复登录后个人界面不显示头像/昵称：userInfoAPK 兼容多种响应嵌套(data.data/data/req_0)与字段别名(nick/nickname/name 等)；头像缺失回退 qlogo(uin 拼接)保证必有图；Profile 头像/昵称双兜底。新增 DEV_PROFILE_AVATAR_FIX.md | AI Assistant |
| 2026-07-10 | v1.16 | 播放器 UI 微交互增强：FloatPanel 搜索/队列/视觉面板进入动画(panelIn 下滑淡入+遮罩 fadeIn)；顶栏头像登录态脉冲环(avatar-pulse)；玻璃按钮按压下沉+微缩放；切歌标题/歌手淡入过渡。新增 DEV_PLAYER_UI_MICROINTERACTIONS.md | AI Assistant |
| 2026-07-10 | v1.17 | 修复多源头像昵称交叉污染：Player 顶栏移除昵称按钮（用户要求不显示）；Profile 头像兜底按源区分（仅 QQ 用 qlogo，网易云/酷狗不跨用 QQ 头像服务）；neteaseSource.userInfo 增加多路径字段提取(nickname/name/userName 等)。新增 DEV_FIX_MULTI_SOURCE_AVATAR.md | AI Assistant |
| 2026-07-11 | v1.18 | QQ 昵称深度排查：新增 logKeys() 响应结构日志（仅 key 路径不含敏感值）；deepPick() 覆盖 20+ 条多层嵌套字段路径(info/result/data/base_info/accountInfo)；nick/avatar/vipLevel 全部改用深层探测。新增 DEV_QQ_NICKNAME_DEBUG.md | AI Assistant |
| 2026-07-11 | v1.19 | 地形可视化重设计「平坦→山脉」：buildBase 从 fBm 山峰改为近乎平坦圆盘；terrainRise[0,1] 驱动（播放1.2/s升起/停播0.5s回落/待机微隆0.18）；运行时重算fBm×激活度+音频驱动(增益+20%)；待机呼吸增强3倍；着色增加雾气+峰顶辉光+等高线动态亮度。新增 DEV_TERRAIN_FLAT_TO_PEAKS.md | AI Assistant |
| 2026-07-11 | v1.20 | 修复切换至地形崩溃：地形动画分支引用了 buildBase 作用域内的 trFreq/trPhase（未定义 ReferenceError）。将 trg/trPhase/trFreq 提升到外层作用域（buildBase 与 animate 共享），崩溃消除。commit 82a37ce | AI Assistant |
| 2026-07-11 | v1.21 | 可视化与交互优化（先写方案 DEV_VISUALIZER_OPT_V2.md）：①音频范围放大 engine.js（smoothing 0.75→0.65、minDecibels -90→-100、maxDecibels -15→-10、pow 0.6→0.55、新增 gain=1.12）②2D 波（MAX_R 0.88→0.94、maxAmp 0.40→0.48、辐射环振幅0.14→0.20、环数3→4、新增频谱尖刺、触摸涟漪）③3D 地形（山高0.70→0.95、TERRAIN_GAIN0.22→0.30、升起过冲弹性、雪顶0.5→0.7、流动雾、等高线1.0→1.6、峰顶辉光0.40→0.55、发光湖面倒影、灵气悬浮光点）④交互（横向滑动切模式+指示点、浮层下拉关闭、navigator.vibrate 触觉反馈）| AI Assistant |
| 2026-07-11 | v1.22 | 参数回调（先写方案 DEV_VIZ_TUNE_DOWN_v1.22.md）：用户反馈 v1.21 过曝。①engine 收敛（smoothing 0.65→0.72、gain 1.12→1.04、pow 0.55→0.58）②2D 波回调（MAX_R 0.94→0.90、maxAmp 0.48→0.36、辐射环振幅0.20→0.15、中心填充0.06→0.045、breath 0.20→0.14、尖刺0.06→0.04、冲击波阈值bass>0.45&&Δ>0.14）③3D 地形回调（TERRAIN_GAIN0.30→0.22、山高0.95→0.72、clamp0.95→0.76、beatPulseH0.22→0.14、过冲0.18→0.08/上限1.06、雪顶0.7→0.58）并删除绿色湖面底座 lakeMesh、灵气光点降级（420→280、opacity0.5→0.32）④全模式鼓点阈值调高（BEAT_THRESHOLD0.07→0.12、COOLDOWN0.05→0.08、SHOCK_GAIN2.6→2.2、CLAY脱落0.55→0.62、liquidmetal0.26→0.20、galaxy0.18→0.13、terrain涟漪0.07→0.045）| AI Assistant |
| 2026-07-11 | v1.23 | 质量型优化（先写方案 DEV_VIZ_QUALITY_V1.23.md，不碰幅度常量）：①色彩/渐变（2D 径向频谱双色分层+峰亮谷暗、外圈径向羽化无硬边、频谱尖刺径向渐变描边；3D 地形 3 段 smoothstep 色带深蓝紫→accent→雪顶、坡度受光 ridge 增亮、指数雾；星河 coreMix 1.6→2.4 更聚拢+炽热内核偏暖）②频谱分段（engine getSpectrumBars 低频 warp 1.35 占更多 bar；2D 镜像柱圆角加大+顶底羽化；3D 地形 freqWeight pow(1-rN,1.3) 低频主峰更稳）③过渡/待机（模式切换 150ms 淡入 vizFadeIn、待机呼吸统一~8s+色相漂移、BEAT_PULSE_DECAY 0.93→0.90）④微交互（涟漪随落点频谱能量变色+ease-out 衰减、模式点呼吸光晕 modeDotBreathe、浮层下拉随 dragY 透明化+降模糊）| AI Assistant |
| 2026-07-11 | v1.24 | 修复+回退（先写方案 DEV_VIZ_FIX_v1.24.md）：①修复环形(ring) 2D 渲染失败——v1.23 在 drawRadialWave 中 `idleHueShift` 早于 `const tNow` 声明引用，触发 TDZ ReferenceError 导致每帧抛错、错误边界显示"渲染失败"（仅 ring 模式）；将 tNow 提到 idleHueShift 之前声明修复 ②按用户要求移除屏上三个模式指示点（保留控制台"视觉设置"面板内的切换入口）并删除配套 .mode-dot-active / @keyframes modeDotBreathe 孤儿 CSS | AI Assistant |
| 2026-07-11 | v1.25 | 全面扫描+Bug 修复+性能优化（先写方案 DEV_VIZ_OPTIMIZE_v1.25.md，并行双 agent 扫描+人工复核）：**Bug**——①删除 usePlayerStore 的 60fps 永久 rAF（lyricTime 无读取方，消除整屏重渲染风暴）②Visualizer3D unmount 补 dispose 灵气光点资源(GPU 泄漏)③LyricStage.mixColor 畸形 rgba 改为返回 RGB 三元组+调用方补 rgba()④galaxy invRmax 除零保护⑤清理死代码(prevMidRef、未 import 的 readFrequencyData/readFrequencyDataLog)。**性能/质量**——①模式切换 key 按 2D/3D 分组(3D 子模式走内部 morph，免 20k 粒子重建)②地形 fBm 山高/ridged 预存 buildBase，动画分支免每帧重算(并消除 ocean 着色越界 tTheta 引用隐患)③液态金属热点高斯衰减预存 COUNT*8 查表④wave 模式去掉 hslaWithAlpha 正则直构渐变色⑤galaxy rN 提到循环顶部三处复用⑥ring 模式 cos/sin 预计算查表 12 层/4 环共享⑦3D morph 源形态坐标提到循环外⑧engine 时间域数据缓冲复用⑨待机色相漂移延伸到核心光/尖刺。vite build 通过 | AI Assistant |
