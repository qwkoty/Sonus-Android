# 开发规范：修复多源头像昵称交叉污染 + 顶栏去昵称

- 触发：用户反馈三问题：
  ① 播放器顶栏显示了「QQ音乐用户」（不是真名），且用户明确说「这个界面不用显示名称」
  ② Profile 切到网易云标签却显示 QQ 的头像（qlogo 兜底被所有源复用，是 QQ 专用的）
  ③ 网易云昵称也是默认「网易云用户」，没拉到真名/头像

## 一、根因分析

### Bug 1：顶栏不该显示名称（用户要求移除）
v1.16 在顶栏加了 `{isLoggedIn && nickname && (...)}` 昵称按钮。但：
- QQ 的 `userInfoAPK` 可能仍取不到真 nick → 回退「QQ音乐用户」→ 用户看到的是默认文字而非真名
- 用户明确表态：「这个界面不用显示名称」
- **修复：直接移除顶栏昵称按钮**

### Bug 2：Profile 头像跨源污染（关键）
v1.15 在 `Profile.jsx` 给所有源统一用了 QQ 头像兜底：
```js
const qlogo = selectedCreds.uin ? `https://q1.qlogo.cn/g?b=qq&nk=${selectedCreds.uin}&s=640` : '';
const src = selectedCreds.userInfo?.avatar || qlogo; // ← 网易云也走这个！
```
`q1.qlogo.cn` 是 **QQ 专属头像服务**，网易云的 uin 不是 QQ 号 → 解析出错误图片。
酷狗同理（且 kugouSource 根本没有 `userInfo` 方法）。

**修复：按音源 ID 分别兜底头像 URL**
| 音源 | 头像兜底方案 | 备注 |
|---|---|---|
| QQ | `https://q1.qlogo.cn/g?b=qq&nk={uin}&s=640` | 已有 |
| 网易云 | 后端 `/user/netease/info` 返回的 avatar 字段；无则显示默认人形图标 | 需增强字段提取 |
| 酷狗 | 无 userInfo 能力 → 始终显示默认人形图标 | 骨架源 |

### Bug 3：网易云 userInfo 字段提取不健壮
`neteaseSource.js:77-79`：
```js
userInfo: async (cookie) => {
  const j = await getJSON('/user/netease/info', { cookie });
  return j?.data || { uid: '', nickname: '网易云用户', avatar: '' };
},
```
只取了 `j?.data` 整体返回，不做字段提取。如果后端返回结构是 `{ data: { profile: { nickname: ... } } }` 或类似嵌套，nickname/avatar 就全为空。

**修复：对 neteaseSource.userInfo 也做多路径 pick 提取（与 qqSource 同理）**

## 二、改动文件与内容

### 文件 1：`frontend/src/pages/Player.jsx`
- **删除** 顶栏昵称按钮（lines ~297-301）
- **保留** 头像按钮（仅头像、点击进 Profile）
- `nickname` 从解构中可移除（不再使用），但保留也无害

### 文件 2：`frontend/src/pages/Profile.jsx`
- 头像兜底改为**按源区分**：
```js
function getAvatarFallback(sourceId, uin) {
  if (sourceId === 'qq' && uin) return `https://q1.qlogo.cn/g?b=qq&nk=${uin}&s=640`;
  return ''; // 非 QQ 源不提供通用兜底，走 userInfo.avatar || 默认图标
}
// 使用：
const avSrc = selectedCreds.userInfo?.avatar || getAvatarFallback(selectedSourceId, selectedCreds.uin);
```

### 文件 3：`frontend/src/sources/neteaseSource.js`
- `userInfo` 方法增加多路径字段提取：
```js
userInfo: async (cookie) => {
  const j = await getJSON('/user/netease/info', { cookie });
  const raw = j?.data ?? {};
  const pick = (...keys) => keys.map(k => raw?.[k]).find(v => v !== undefined && v !== null && v !== '');
  return {
    uid: raw?.uid || raw?.account?.id || raw?.userId || '',
    nickname: pick('nickname', 'name', 'userName', 'profileNickname') || '网易云用户',
    avatar: pick('avatar', 'profileImageUrl', 'headImgUrl', 'icon'),
  };
},
```

## 三、验收标准

- [ ] 播放器顶栏**不再显示昵称文字**（只有头像按钮）
- [ ] Profile 中 QQ 标签显示 QQ 真实头像/昵称
- [ ] Profile 中网易云标签**不显示 QQ 头像**；有 userInfo 时显示网易云自己的头像/昵称，无时显示默认人形图标+「网易云用户」
- [ ] 酷狗标签始终显示默认人形图标（骨架源，正常行为）
- [ ] `vite build` 通过
