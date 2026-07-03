// 平台检测工具
// 区分 Capacitor APK 环境和浏览器环境

export function isCapacitor(): boolean {
  return typeof window !== 'undefined' &&
    window.Capacitor?.isNativePlatform?.() === true;
}

export function isAndroid(): boolean {
  return isCapacitor() && window.Capacitor?.getPlatform?.() === 'android';
}

export function isBrowser(): boolean {
  return !isCapacitor();
}

// 登录方式：
// - Capacitor Android: WebView 内嵌 QQ 音乐官网 + CookieReader 自动读 Cookie
// - 浏览器: ptlogin2 扫码 + JSONP 检查（有 bug，但作为 fallback）
export function getLoginMode(): 'webview' | 'qrscan' {
  return isAndroid() ? 'webview' : 'qrscan';
}
