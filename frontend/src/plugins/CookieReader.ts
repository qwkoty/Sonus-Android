// CookieReader — Capacitor 原生插件桥接
// 在 Android 上读取 WebView CookieManager 的 Cookie（不受 document.cookie 跨域限制）
// 在浏览器环境中降级为空实现

import { registerPlugin } from '@capacitor/core';

export interface CookieReaderResult {
  cookie: string;
  uin: string;
  qqmusic_key: string;
  login_type: string;
  loggedIn: boolean;
}

export interface OpenLoginResult {
  loggedIn: boolean;
}

export interface CookieReaderPlugin {
  getCookiesForUrl(options: { url: string }): Promise<CookieReaderResult>;
  clearCookiesForUrl(options: { url: string }): Promise<void>;
  openLoginWebView(): Promise<OpenLoginResult>;
}

const CookieReaderNative = registerPlugin<CookieReaderPlugin>('CookieReader');

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

  // 通过 Capacitor 插件打开 QQ 音乐登录 WebView，Promise 在用户登录完成后 resolve
  openLoginWebView: async (): Promise<OpenLoginResult> => {
    if (!CookieReader.isAvailable()) {
      throw new Error('CookieReader not available (browser environment)');
    }
    return await CookieReaderNative.openLoginWebView();
  },
};

export default CookieReader;
