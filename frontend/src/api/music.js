// music.js — 多音源动态代理薄壳
// 原 QQ 实现已迁入 sources/qqSource.js；此处仅按当前激活音源动态转发，
// 使 usePlayerStore / Login / useAuthStore 等调用方无需感知具体音源。

import { getActiveSource } from './sources/registry';

// 动态转发到当前激活音源，支持运行时切换
const music = new Proxy({}, {
  get(_t, prop) {
    const src = getActiveSource();
    return src ? src[prop] : undefined;
  },
});

// Visualizer3D 直接 import 的封面代理（转发到活跃源）
export const getProxyUrl = (url) => {
  const src = getActiveSource();
  if (src && typeof src.getProxyUrl === 'function') return src.getProxyUrl(url);
  return url;
};

export { music };
export default music;
