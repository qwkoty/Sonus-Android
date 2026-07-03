// 平台检测工具 —— 仅 APK 模式
// Sonus 只作为 Android App 运行，不再支持浏览器模式

export function isCapacitor(): boolean {
  return typeof window !== 'undefined' &&
    window.Capacitor?.isNativePlatform?.() === true;
}

export function isAndroid(): boolean {
  return typeof window !== 'undefined' &&
    window.Capacitor?.getPlatform?.() === 'android';
}

// 兼容旧代码：始终为 true，表示“在原生应用内”
export function isNativeApp(): boolean {
  return true;
}
