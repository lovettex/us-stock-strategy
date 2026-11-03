/**
 * 後端 API 位址。
 *
 * 正式版：Cloudflare Worker（股價代理 + DeepSeek 代理，key 藏在 Worker secret）
 * 本機開發：留空 → 走相對路徑，由 server.ts 的 /api/* 路由處理
 */
export const API_BASE: string = (process.env.API_BASE as string) || "";

export function apiUrl(path: string): string {
  const base = API_BASE.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}
