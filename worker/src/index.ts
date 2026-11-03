/**
 * Cloudflare Worker：美股交易策略紀錄 的後端代理
 *
 * 端點：
 *   GET  /api/stock/:symbol   → Yahoo Finance 行情代理（前端不需任何 API key）
 *   POST /api/ai              → DeepSeek 代理（DEEPSEEK_API_KEY 只存在 Worker secret 中）
 *   GET  /                    → 健康檢查
 *
 * 安全性：只允許本專案的網域呼叫（CORS 白名單），DeepSeek key 永遠不會出現在前端 bundle。
 */

export interface Env {
  DEEPSEEK_API_KEY: string;
}

const ALLOWED_ORIGINS = [
  "https://us-stock-strategy-app.web.app",
  "https://us-stock-strategy-app.firebaseapp.com",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
];

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(data: unknown, status: number, headers: Record<string, string>, cacheSeconds = 0): Response {
  const h: Record<string, string> = { ...headers, "Content-Type": "application/json;charset=utf-8" };
  if (cacheSeconds > 0) h["Cache-Control"] = `public, max-age=${cacheSeconds}`;
  return new Response(JSON.stringify(data), { status, headers: h });
}

const SYMBOL_RE = /^\/api\/stock\/([A-Za-z0-9.\-^=]{1,20})$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const headers = corsHeaders(request.headers.get("Origin"));

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    // ---- 股價代理 ----
    const stockMatch = url.pathname.match(SYMBOL_RE);
    if (stockMatch && request.method === "GET") {
      const symbol = stockMatch[1];
      const upstream = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
        symbol
      )}?interval=1d`;
      try {
        const res = await fetch(upstream, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept: "application/json",
          },
          cf: { cacheTtl: 60, cacheEverything: true },
        } as RequestInit);
        if (!res.ok) {
          return json({ error: `Yahoo 回應 ${res.status}` }, 502, headers);
        }
        const data = await res.json();
        return json(data, 200, headers, 60);
      } catch (e: any) {
        return json({ error: `行情查詢失敗：${e?.message || e}` }, 502, headers);
      }
    }

    // ---- AI 代理 ----
    if (url.pathname === "/api/ai" && request.method === "POST") {
      if (!env.DEEPSEEK_API_KEY) {
        return json({ error: "Worker 未設定 DEEPSEEK_API_KEY secret" }, 500, headers);
      }
      const body = await request.text();
      try {
        const res = await fetch("https://api.deepseek.com/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
          },
          body,
        });
        const text = await res.text();
        return new Response(text, {
          status: res.status,
          headers: { ...headers, "Content-Type": "application/json;charset=utf-8" },
        });
      } catch (e: any) {
        return json({ error: `DeepSeek 連線失敗：${e?.message || e}` }, 502, headers);
      }
    }

    // ---- 健康檢查 ----
    if (url.pathname === "/" || url.pathname === "") {
      return json(
        {
          ok: true,
          service: "us-stock-strategy-api",
          endpoints: ["GET /api/stock/:symbol", "POST /api/ai"],
          deepseekKeyConfigured: Boolean(env.DEEPSEEK_API_KEY),
        },
        200,
        headers
      );
    }

    return json({ error: "not found" }, 404, headers);
  },
};
