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
  httpGet(options: { url: string; cookieDomain?: string; cookies?: string }): Promise<HttpGetResult>;
  openLoginWebView(): Promise<{ loggedIn: boolean }>;
}

const Native = registerPlugin<CookieReaderPlugin>('CookieReader');
const IS_CAP = () => typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.();

// 从请求 URL 提取 origin（scheme://host），用于匹配 CookieManager 中的 Cookie 域
function deriveOrigin(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return '';
  }
}

export const CookieReader = {
  isAvailable: IS_CAP,
  getCookiesForUrl: async (url: string): Promise<CookieReaderResult> => {
    if (!IS_CAP()) return { cookie: '', uin: '', qqmusic_key: '', login_type: '', loggedIn: false };
    return Native.getCookiesForUrl({ url });
  },
  clearCookiesForUrl: async (url: string) => { if (IS_CAP()) return Native.clearCookiesForUrl({ url }); },
  // 原生 HTTP GET：自动注入 CookieManager 里对应域的 Cookie，零 CORS 限制
  // cookieDomain 省略时自动从请求 URL 提取 origin，保证 Cookie 域匹配
  // 原生 HTTP GET：自动注入 Cookie。
  // 如果传了 cookies 字符串，直接注入该字符串；否则从 CookieManager 读取 cookieDomain 对应域。
  httpGet: async (url: string, cookieDomain?: string, cookies?: string): Promise<HttpGetResult> => {
    if (!IS_CAP()) throw new Error('Not in Capacitor');
    const domain = cookieDomain || deriveOrigin(url) || 'https://y.qq.com';
    const payload: { url: string; cookieDomain?: string; cookies?: string } = { url, cookieDomain: domain };
    if (cookies) payload.cookies = cookies;
    return Native.httpGet(payload);
  },
  openLoginWebView: async () => {
    if (!IS_CAP()) throw new Error('Not in Capacitor');
    return Native.openLoginWebView();
  },
};
export default CookieReader;
