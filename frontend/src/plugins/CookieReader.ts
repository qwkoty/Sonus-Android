// CookieReader — Capacitor 原生插件桥接
import { registerPlugin } from '@capacitor/core';

export interface CookieReaderResult {
  cookie: string; uin: string; qqmusic_key: string; login_type: string; loggedIn: boolean;
  neteaseUid?: string; neteaseLoggedIn?: boolean;
}
export interface HttpGetResult {
  status: number; body: string; ok: boolean;
  setCookies?: string; // 响应 Set-Cookie 拼接的 name=value 字符串（用于网易云扫码登录）
  finalUrl?: string; // 跟随重定向后的最终 URL（用于网易云 outer URL 302 跳转）
  location?: string; // noRedirect 模式下的 Location 头
}
export interface CookieReaderPlugin {
  getCookiesForUrl(options: { url: string }): Promise<CookieReaderResult>;
  clearCookiesForUrl(options: { url: string }): Promise<void>;
  httpGet(options: { url: string; cookieDomain?: string; cookies?: string; noRedirect?: boolean }): Promise<HttpGetResult>;
  syncStreamCookies(options?: { url?: string }): Promise<void>;
  openLoginWebView(): Promise<{ loggedIn: boolean; cookie: string; nickname: string; avatar: string }>;
  openNeteaseLoginWebView(): Promise<{ loggedIn: boolean; cookie: string }>;
  getProxyPort(): Promise<{ port: number; available: boolean }>;
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
  // noRedirect=true 时不跟随 302，便于读取 Location 头
  httpGet: async (url: string, cookieDomain?: string, cookies?: string, noRedirect?: boolean): Promise<HttpGetResult> => {
    if (!IS_CAP()) throw new Error('Not in Capacitor');
    const domain = cookieDomain || deriveOrigin(url) || 'https://y.qq.com';
    const payload: { url: string; cookieDomain?: string; cookies?: string; noRedirect?: boolean } = { url, cookieDomain: domain };
    if (cookies) payload.cookies = cookies;
    if (noRedirect) payload.noRedirect = true;
    return Native.httpGet(payload);
  },
  // 把 y.qq.com 登录 Cookie 同步到音频流域名，让 Audio 元素播放时带登录态
  syncStreamCookies: async (url = 'https://y.qq.com') => {
    if (!IS_CAP()) return;
    return Native.syncStreamCookies({ url });
  },
  openLoginWebView: async () => {
    if (!IS_CAP()) throw new Error('Not in Capacitor');
    return Native.openLoginWebView();
  },
  // 打开网易云音乐登录 WebView（与 QQ 音乐同思路，但针对 music.163.com 域）
  openNeteaseLoginWebView: async (): Promise<{ loggedIn: boolean; cookie: string }> => {
    if (!IS_CAP()) throw new Error('Not in Capacitor');
    return Native.openNeteaseLoginWebView();
  },
  // 获取本地音频代理服务器端口；非原生环境返回 0
  getProxyPort: async (): Promise<{ port: number; available: boolean }> => {
    if (!IS_CAP()) return { port: 0, available: false };
    return Native.getProxyPort();
  },
};
export default CookieReader;
