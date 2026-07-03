// CookieReader — Capacitor 原生插件桥接
// 在 Android 上读取 WebView CookieManager 的 Cookie（不受 document.cookie 跨域限制）
// 在浏览器环境中降级为空实现

import { registerPlugin } from '@capacitor/core';

export interface CookieReaderResult {
  cookie: string;       // 完整 cookie 字符串（如 "uin=123; qqmusic_key=abc; ..."）
  uin: string;          // QQ 号（已去除 o 前缀）
  qqmusic_key: string;  // 播放票据（qm_keyst > qqmusic_key > p_skey > skey 优先级）
  login_type: string;   // "1"=QQ登录, "2"=微信登录
  loggedIn: boolean;    // 是否已登录（uin 非空 + key 非空）
}

export interface CookieReaderPlugin {
  getCookiesForUrl(options: { url: string }): Promise<CookieReaderResult>;
  clearCookiesForUrl(options: { url: string }): Promise<void>;
}

const CookieReaderNative = registerPlugin<CookieReaderPlugin>('CookieReader');

// 导出包装函数，自动处理 Capacitor/浏览器环境
export const CookieReader = {
  isAvailable: () => {
    return typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.();
  },

  getCookiesForUrl: async (url: string): Promise<CookieReaderResult> => {
    if (!CookieReader.isAvailable()) {
      return { cookie: '', uin: '', qqmusic_key: '', login_type: '', loggedIn: false };
    }
    return await CookieReaderNative.getCookiesForUrl({ url });
  },

  clearCookiesForUrl: async (url: string): Promise<void> => {
    if (!CookieReader.isAvailable()) return;
    return await CookieReaderNative.clearCookiesForUrl({ url });
  },

  // 打开 QQ 音乐登录 WebView（通过 AndroidBridge）
  openLoginWebView: async (): Promise<boolean> => {
    if (!CookieReader.isAvailable()) return false;
    try {
      // 通过 Capacitor 的 AndroidBridge 调用 MainActivity 的方法
      const bridge = window.Capacitor?.getPlatform?.() === 'android'
        ? (window as any).AndroidBridge
        : null;
      if (bridge && bridge.openQQLoginWebView) {
        bridge.openQQLoginWebView();
        return true;
      }
      // 如果没有 AndroidBridge，尝试用 Intent 方式
      return false;
    } catch {
      return false;
    }
  },
};

export default CookieReader;
