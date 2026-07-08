// 多音源注册表 + 激活源选择
// 调用方（Player / Login / usePlayerStore / useAuthStore）通过 getActiveSource() 取当前音源，
// 切换音源时无需改动业务代码。

import { qqSource } from './qqSource';
import { neteaseSource } from './neteaseSource';
import { kugouSource } from './kugouSource';

const STORAGE_KEY = 'sonus_source';
const registry = new Map();

export function registerSource(adapter) {
  if (adapter && adapter.id) registry.set(adapter.id, adapter);
}

// 启动即注册全部已知音源（实装或骨架）
registerSource(qqSource);
registerSource(neteaseSource);
registerSource(kugouSource);

export function getSource(id) {
  return registry.get(id);
}

export function listSources() {
  return [...registry.values()].map((a) => ({
    id: a.id,
    name: a.name,
    ready: !!a.ready,
  }));
}

export function setActiveSource(id) {
  if (registry.has(id)) localStorage.setItem(STORAGE_KEY, id);
}

export function getActiveSource() {
  const id = localStorage.getItem(STORAGE_KEY);
  return (id && registry.get(id)) || qqSource; // 默认 QQ
}
