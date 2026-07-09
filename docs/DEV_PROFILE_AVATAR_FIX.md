# 开发规范：登录后显示 QQ 音乐头像与昵称

- 触发：用户反馈「个人界面（Profile）不会显示头像，名称也不会显示」——登录后拉取到的用户信息没有正确展示。
- 目标文件：
  - `frontend/src/sources/qqSource.js`（`userInfoAPK` 字段解析）
  - `frontend/src/store/useAuthStore.js`（`fetchUserInfo` 落库）
  - `frontend/src/pages/Profile.jsx`（个人界面展示）
  - `frontend/src/pages/Player.jsx`（顶栏头像 + 昵称）
- 关联：`DEV_COVERFLOW_READABLE.md`（本次不含封面改动）

## 一、现状诊断

| 现象 | 代码位置 | 根因 |
|---|---|---|
| Profile 头像不显示（回退默认人形图标） | `Profile.jsx:271` 仅用 `userInfo?.avatar` | `userInfoAPK` 只在 `d.req_0.data` 且字段名恰好为 `headpic/headimg/avatar/face/headPic` 时才取到头像；真实接口嵌套层级/字段名可能不同 → `avatar===''` → 回退人形 |
| 昵称不显示（回退为「QQ音乐用户」/音源名） | `Profile.jsx:274` 用 `selectedCreds.nickname` | `userInfoAPK` 仅取 `i?.nick`；真实字段可能是 `nickname/name` 等 → 取不到 → 默认名 |
| 头像无兜底 | `userInfoAPK:218` | 接口没返回头像时直接给空串，没有任何兜底 |
| 播放器顶栏无昵称 | `Player.jsx:294` 头像按钮只放图，无文字 | 顶栏从未显示昵称 |

> 注：`fetchUserInfo` 在 `setAuth` 时已调用（`useAuthStore.js:121`），拉取逻辑存在；问题集中在**解析健壮性 + 头像兜底 + 展示完整性**。

## 二、修正方案

### 1) `userInfoAPK`：兼容多种响应结构 + 头像兜底（关键）

```js
async function userInfoAPK(uin, cookie = '') {
  const d = await nativeGet(qqUrl({
    comm: { uin: String(uin), format: 'json', ct: 24, cv: 0 },
    req_0: { module: 'music.UserInfo.userInfoServer', method: 'GetLoginUserInfo', param: {} },
  }), cookie);
  // 兼容多种嵌套：data.data / data / req_0 自身
  const raw = d?.req_0?.data?.data ?? d?.req_0?.data ?? d?.req_0 ?? {};
  const pick = (...keys) =>
    keys.map(k => raw?.[k]).find(v => v !== undefined && v !== null && v !== '');
  const nick = pick('nick', 'nickname', 'name', 'user_name', 'usrName');
  const avatar = pick('headpic', 'headimg', 'avatar', 'face', 'headPic', 'pic', 'picurl', 'headpic_url', 'icon');
  const qlogo = uin ? `https://q1.qlogo.cn/g?b=qq&nk=${String(uin)}&s=640` : ''; // 稳定兜底头像
  return {
    nickname: nick || 'QQ音乐用户',
    avatar: avatar || qlogo,           // 接口头像缺失时回退 qlogo（按 uin 拼，必定有图）
    uin: String(uin),
    vipLevel: raw?.vipLevel || 0,
    isVip: !!(raw?.isVip || raw?.vip || raw?.vipStatus || raw?.svipLevel || raw?.payPackId),
    follow: raw?.follow || 0,
    fans: raw?.fans || 0,
  };
}
```

### 2) `fetchUserInfo`：保证头像落库

`info.avatar` 已由上面保证非空（qlogo 兜底），`set` 时 `userInfo: info` 直接写入即可，无需额外改动。
（保留 `nickname: info?.nickname || ...` 的回退逻辑不变。）

### 3) `Profile.jsx`：双兜底展示

```jsx
const uin = selectedCreds.uin;
const qlogo = uin ? `https://q1.qlogo.cn/g?b=qq&nk=${uin}&s=640` : '';
const avatarSrc = selectedCreds.userInfo?.avatar || qlogo;
const showName = selectedCreds.userInfo?.nickname || selectedCreds.nickname || selectedSource.name;
```
- 头像 `<img src={avatarSrc} ... />`（仍保留 `UserIcon` 作为 img 加载失败的最终兜底）
- 昵称用 `showName`

### 4) `Player.jsx` 顶栏：登录后显示昵称

在头像按钮旁增加紧凑昵称标签（已登录时显示，点击同样打开 Profile）：

```jsx
{isLoggedIn && (
  <button onClick={onProfile} className="glass-button" style={{...ellipsis...}}>
    <span>{nickname || '我'}</span>
  </button>
)}
```
- `nickname` 取自 `useAuthStore` 的 `nickname`
- 文案过长省略号，避免挤压中间歌曲标题

## 三、验收标准

- [ ] 登录 QQ 音乐后，Profile 个人界面**显示真实头像**（接口头像或 qlogo 兜底）
- [ ] 登录后 Profile **显示真实昵称**（不再回退为「QQ音乐用户」/音源名）
- [ ] 播放器顶栏登录后显示昵称（点击打开 Profile）
- [ ] 即使接口未返回头像，也能通过 uin 拼出 qlogo 头像，不会空白
- [ ] `vite build` 通过

## 四、风险与回退

| 风险 | 应对 |
|---|---|
| `nativeGet` 仍可能因网络/Cookie 失败 → `userInfo` 为 null | 头像/昵称走 qlogo + creds.nickname 兜底；至少头像恒有图 |
| qlogo 在某些网络下加载慢 | `<img>` 加 `loading="lazy"` + 默认人形兜底，不阻塞 |
| 昵称字段仍取不到 | 默认「QQ音乐用户」，不报错 |
