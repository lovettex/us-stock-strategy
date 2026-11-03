import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import "dotenv/config";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "25mb" }));

  // 本機開發用的 DeepSeek 代理（正式環境由 Cloudflare Worker 處理）
  app.post("/api/ai", async (req, res) => {
    const key = process.env.DEEPSEEK_API_KEY;
    if (!key) {
      return res.status(500).json({ error: "DEEPSEEK_API_KEY 未設定（.env）" });
    }
    try {
      const response = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(req.body),
      });
      const text = await response.text();
      res.status(response.status).type("application/json").send(text);
    } catch (error) {
      console.error(error);
      res.status(502).json({ error: "DeepSeek 連線失敗" });
    }
  });

  // Add a proxy route for Yahoo Finance
  app.get("/api/stock/:symbol", async (req, res) => {
    try {
      const { symbol } = req.params;
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d`;
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json'
        }
      });
      
      if (!response.ok) {
         return res.status(response.status).json({ error: 'Failed to fetch data' });
      }
      
      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    // For Express 4
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
