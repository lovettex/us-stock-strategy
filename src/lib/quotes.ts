/**
 * 股價查詢：多層備援
 *  1. 本機開發用的 Express 代理 /api/stock/:symbol（只在 npm run dev 有效）
 *  2. TwelveData 免費 API（需設定 TWELVEDATA_API_KEY，800 次/天免費）
 *  3. 全部失敗回傳 null，由呼叫端處理
 */

export async function fetchQuote(symbol: string): Promise<number | null> {
  const clean = (symbol || "").trim().toUpperCase();
  if (!clean) return null;

  // 1) 本機 Express 代理（Firebase Hosting 上不存在，會回 index.html 而解析失敗）
  try {
    const res = await fetch(`/api/stock/${encodeURIComponent(clean)}`);
    if (res.ok) {
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        const data = await res.json();
        const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
        if (typeof price === "number" && price > 0) return price;
      }
    }
  } catch {
    /* ignore */
  }

  // 2) TwelveData
  const key = process.env.TWELVEDATA_API_KEY as string | undefined;
  if (key) {
    try {
      const res = await fetch(
        `https://api.twelvedata.com/price?symbol=${encodeURIComponent(clean)}&apikey=${encodeURIComponent(key)}`
      );
      const data = await res.json();
      const raw = data?.price ?? data?.close;
      const price = Number(raw);
      if (Number.isFinite(price) && price > 0) return price;
      if (data?.status === "error") {
        console.warn(`TwelveData 查詢 ${clean} 失敗：${data?.message}`);
      }
    } catch (e) {
      console.warn(`TwelveData 連線失敗 (${clean})`, e);
    }
  }

  return null;
}
