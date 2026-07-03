// CookieReader — Capacitor 原生插件桥接
import { registerPlugin } from '@capacitor/core';

export interface CookieReaderResult {
  cookie: string; uin: string; qqmusic_key: string; login_type: string; loggedIn: boolean;
}
export interface HttpGetResult {
  status: number; body: string; ok: boolean;
}
export interface CookieReaderPlugin {
  getCookiesForUrl(options: { url: string }): Promise<CookieReaderResult>;
  clearCookiesForUrl(options: { url: string }): Promise<void>;
  httpGet(options: { url: string; cookieDomain?: string }): Promise<HttpGetResult>;
  openLoginWebView(): Promise<{ loggedIn: boolean }>;
}

const Native = registerPlugin<CookieReaderPlugin>('CookieReader');
const IS_CAP = () => typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.();

export const CookieReader = {
  isAvailable: IS_CAP,
  getCookiesForUrl: async (url: string): Promise<CookieReaderResult> => {
    if (!IS_CAP()) return { cookie: '', uin: '', qqmusic_key: '', login_type: '', loggedIn: false };
    return Native.getCookiesForUrl({ url });
  },
  clearCookiesForUrl: async (url: string) => { if (IS_CAP()) return Native.clearCookiesForUrl({ url }); },
  // 原生 HTTP GET：自动注入 CookieManager 里对应域的 Cookie，零 CORS 限制
  httpGet: async (url: string, cookieDomain = 'https://y.qq.com'): Promise<HttpGetResult> => {
    if (!IS_CAP()) throw new Error('Not in Capacitor');
    return Native.httpGet({ url, cookieDomain });
  },
  openLoginWebView: async () => {
    if (!IS_CAP()) throw new Error('Not in Capacitor');
    return Native.openLoginWebView();
  },
};
export default CookieReader;
