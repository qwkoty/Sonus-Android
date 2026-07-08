// 后端 API 基地址：
// - 默认相对路径 ''（生产由后端同源托管前端 /api/music）
// - 可用 VITE_API_BASE 或 localStorage('sonus_api_base') 覆盖（如 APK 指向自有后端）
export function apiBase() {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE) {
      return String(import.meta.env.VITE_API_BASE).replace(/\/$/, '');
    }
  } catch {}
  try {
    const b = localStorage.getItem('sonus_api_base');
    if (b) return String(b).replace(/\/$/, '');
  } catch {}
  return '';
}

// 拼接到 /api/music 下的完整 URL
export function apiUrl(path) {
  const base = apiBase();
  if (base) return `${base}/api/music${path}`;
  // 相对路径：以当前 origin 为基准
  return new URL(`/api/music${path}`, window.location.origin).toString();
}
