# 开发规范：QQ 昵称仍为默认值 — 深度排查与修复

- 触发：v1.15/v1.17 已做字段兼容 + qlogo 兜底，但 Profile 仍显示「QQ音乐用户」而非真名。
- 目标文件：`frontend/src/sources/qqSource.js`

## 一、现状诊断

当前 `userInfoAPK`（v1.15 改后）已做多路径提取：
```js
const raw = d?.req_0?.data?.data ?? d?.req_0?.data ?? d?.req_0 ?? {};
const pick = (...keys) => keys.map(k => raw?.[k]).find(v => v !== undefined && v !== null && v !== '');
const nick = pick('nick', 'nickname', 'name', 'user_name', 'usrName');
```

但仍返回 `'QQ音乐用户'`（fallback），说明 **raw 对象里没有以上任何 key**。

可能原因（按概率排序）：
1. QQ 音乐 API 响应结构比预期**多嵌套一层**：如 `{ req_0: { data: { info: { nick: ... } } } }` 或 `{ req_0: { data: { result: { nick: ... } } } }`
2. API 返回了 `code != 0`（未登录/cookie 过期），`data` 为空对象 → pick 全部 undefined
3. 字段名完全不同（如 `nickname_` / `base_info.nick` 等深层路径）

## 二、修正方案

### 1) 增加原始响应完整日志（关键排查手段）

在 `userInfoAPK` 返回前，打印**整个响应对象的 key 树**（不打印值，避免泄漏隐私）：

```js
// 排查日志：打印响应结构（仅 key 路径，不含敏感值）
function logKeys(obj, prefix = '', depth = 0) {
  if (depth > 4 || !obj || typeof obj !== 'object') return;
  for (const k of Object.keys(obj).slice(0, 30)) {
    console.log(`[userInfo] ${prefix}${k} : ${typeof obj[k]}`);
    logKeys(obj[k], `${prefix}${k}.`, depth + 1);
  }
}
console.log('[userInfo] === full response key tree ===');
logKeys(d);
```

这样用户在控制台看到的就是实际 API 返回的完整结构，我们就能精确匹配路径。

### 2) 扩展嵌套层级探测（覆盖更深层）

```js
// 三层嵌套探测：data.data.info / data.data.result / data.info / data.result 等
const deepPick = (obj, ...paths) => {
  for (const path of paths) {
    let cur = obj;
    for (const seg of path) {
      if (!cur || typeof cur !== 'object') break;
      cur = cur[seg];
    }
    if (cur !== undefined && cur !== null && cur !== '' && typeof cur !== 'object') return cur;
  }
  return undefined;
};

const rawBase = d?.req_0?.data ?? d?.req_0 ?? {};
const nick = deepPick(rawBase,
  ['nick'], ['nickname'], ['name'], ['user_name'], ['usrName'],
  // 多一层嵌套
  ['info', 'nick'], ['info', 'nickname'], ['info', 'name'],
  ['result', 'nick'], ['result', 'nickname'], ['result', 'name'],
  ['data', 'nick'], ['data', 'nickname'],
  // 再深一层
  ['info', 'base_info', 'nick'], ['accountInfo', 'nick'],
) || 'QQ音乐用户';
```

同理对 avatar 做 deepPick。

### 3) 头像兜底保持不变

qlogo 兜底（`q1.qlogo.cn/g?b=qq&nk={uin}`）已确认可用（截图显示头像正常），保留。

## 三、验收标准

- [ ] Profile 显示 **真实 QQ 昵称**（不再是「QQ音乐用户」）
- [ ] 控制台有 `[userInfo]` 日志可查（方便后续调试）
- [ ] 头像正常显示（已有 qlogo 兜底）
- [ ] `vite build` 通过

## 四、风险

| 风险 | 应对 |
|---|---|
| QQ 音乐改了 API 结构导致永远取不到 | 日志输出完整 key tree，下次一眼看出 |
| Cookie 过期/无效导致 data 为空 | fetchUserInfo 有 try/catch，不会崩溃；Profile 显示默认名 |
