/**
 * 股價查詢：透過 Cloudflare Worker 代理 Yahoo Finance。
 * 前端不需要任何 API key；Worker 端有 60 秒快取與 CORS 白名單。
 */

import { apiUrl } from "./api";

export async function fetchQuote(symbol: string): Promise<number | null> {
  const clean = (symbol || "").trim().toUpperCase();
  if (!clean) return null;

  // Cloudflare Worker 代理 Yahoo Finance（本機開發時 API_BASE 留空 → 走 server.ts）
  try {
    const res = await fetch(apiUrl(`/api/stock/${encodeURIComponent(clean)}`));
    if (!res.ok) {
      console.warn(`股價查詢失敗 (${clean})：HTTP ${res.status}`);
      return null;
    }
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("application/json")) return null;

    const data = await res.json();
    const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (typeof price === "number" && price > 0) return price;

    if (data?.error) console.warn(`股價查詢失敗 (${clean})：${data.error}`);
  } catch (e) {
    console.warn(`股價連線失敗 (${clean})`, e);
  }

  return null;
}
