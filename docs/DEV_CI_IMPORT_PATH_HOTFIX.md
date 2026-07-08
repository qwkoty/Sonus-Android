# 开发规范：CI 构建失败热修（sources 相对路径）

- 关联提交：`f7ff007 feat(auth): 多音源登录抽象层`
- 触发：GitHub Actions `Build Android APK` run `28919930837` 结论 `failure`
- 失败步骤：`Build web assets`（`vite build`）

## 现象
```
[UNRESOLVED_IMPORT] Could not resolve './sources/registry' in src/api/music.js
```

## 根因
> **相对路径基准点随文件所在目录变化，不是项目根。**

`music.js` 位于 `src/api/`，其 `./sources/registry` 被解析为
`src/api/sources/registry.js`（不存在）。真正的源文件在 `src/sources/registry.js`，
因此从 `src/api/` 出发应写成 `../sources/registry`。

这是一个**仅影响生产构建**的回归：本地 esbuild 纯语法校验与 `ls` 文件名核对都
未能发现相对路径偏差，因为语法层面 `./sources/registry` 是合法的 import 语句。

## 受影响 / 不受影响范围
| 文件 | 目录 | 写法 | 结论 |
|------|------|------|------|
| `api/music.js` | `src/api/` | `./sources/registry` ❌ | **需改为 `../sources/registry`** |
| `pages/Login.jsx` | `src/pages/` | `../sources/registry` | 正确 |
| `pages/Player.jsx` | `src/pages/` | `../sources/registry` | 正确 |
| `store/useAuthStore.js` | `src/store/` | `../sources/registry` | 正确 |
| `sources/registry.js` | `src/sources/` | `./qqSource` 等 | 正确（同目录） |
| `sources/qqSource.js` | `src/sources/` | `../plugins/CookieReader` | 正确 |

## 修改内容
- 仅改 `frontend/src/api/music.js` 第 5 行：
  ```diff
  - import { getActiveSource } from './sources/registry';
  + import { getActiveSource } from '../sources/registry';
  ```

## 验收标准
1. `vite build` 不再报 `UNRESOLVED_IMPORT`（即 CI `Build web assets` 通过）。
2. 其余 7 个文件保持未改动（路径本就正确），不引入额外 diff。
3. 重新推送后 Actions 运行结论为 `success`。

## 预防
- 新增/移动模块文件时，import 路径以**被修改文件自身目录**为基准，而非项目根。
- 本地校验不能只做语法检查，需在 CI 跑完整 `vite build` 验证模块解析；
  后续可在 PR 流程里把 `npm run build` 作为必过检查。
