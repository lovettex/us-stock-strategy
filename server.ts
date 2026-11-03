import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { GoogleGenAI, Type } from "./src/lib/ai-server.ts";
import "dotenv/config";
import { db } from "./src/db/index.ts";
import { uploadedHtmlFiles } from "./src/db/schema.ts";
import { eq, desc, and } from "drizzle-orm";

async function generateContentWithRetry(ai: GoogleGenAI, params: any, maxRetries = 4, initialDelay = 1000) {
  let attempt = 0;
  const originalModel = params.model;
  // Recommended reliable models for text, vision, and tool-use tasks
  const fallbackList = ["gemini-2.5-flash", "gemini-3.1-flash-lite", "gemini-flash-latest"];
  
  // Normalize gemini-3.8-flash to gemini-2.5-flash to avoid 503 high demand spikes on attempt 1
  if (params.model === "gemini-3.8-flash") {
    params.model = "gemini-2.5-flash";
  }

  while (true) {
    try {
      return await ai.models.generateContent(params);
    } catch (error: any) {
      attempt++;
      console.warn(`Gemini API attempt ${attempt} notice with model ${params.model}:`, error?.message || error);
      
      const errStr = String(error?.message || error || "");
      const isTransient = 
        errStr.includes("503") || 
        errStr.includes("502") || 
        errStr.includes("504") || 
        errStr.includes("500") || 
        errStr.includes("UNAVAILABLE") || 
        errStr.includes("high demand") || 
        errStr.includes("429") || 
        errStr.includes("ResourceExhausted") || 
        errStr.includes("RESOURCE_EXHAUSTED") || 
        errStr.includes("overloaded") || 
        errStr.includes("timeout") || 
        errStr.includes("limit") ||
        error?.status === 503 ||
        error?.status === 429 ||
        error?.status === 500 ||
        error?.status === 502 ||
        error?.status === 504;
      
      if (attempt >= maxRetries || !isTransient) {
        // Restore the original model name before throwing
        params.model = originalModel;
        throw error;
      }
      
      // If we got a 503 or 429 error and current model is in our fallback list, transition to next model
      if (fallbackList.includes(params.model)) {
        const currentIndex = fallbackList.indexOf(params.model);
        if (currentIndex !== -1 && currentIndex < fallbackList.length - 1) {
          const nextModel = fallbackList[currentIndex + 1];
          console.info(`Attempt ${attempt} retrying with fallback model ${nextModel}...`);
          params.model = nextModel;
        }
      } else {
        params.model = "gemini-2.5-flash";
      }
      
      const delay = initialDelay * Math.pow(2, attempt - 1);
      console.info(`Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Increase payload limit for base64 images
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // HTML Files Upload Endpoint
  app.post("/api/html-files", async (req, res) => {
    try {
      const { userId, symbol, filename, htmlContent } = req.body;
      if (!userId || !symbol || !filename || !htmlContent) {
        return res.status(400).json({ error: "缺少必要欄位：userId, symbol, filename, htmlContent" });
      }

      const [inserted] = await db.insert(uploadedHtmlFiles).values({
        userId,
        symbol,
        filename,
        htmlContent,
      }).returning();

      res.json({ success: true, file: inserted });
    } catch (err: any) {
      console.error("Error saving HTML file:", err);
      res.status(500).json({ error: "儲存 HTML 檔案時出錯: " + err.message });
    }
  });

  // HTML Files Listing Endpoint
  app.get("/api/html-files", async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    try {
      const { symbol } = req.query;

      let files = [];
      if (symbol && typeof symbol === "string" && symbol.trim()) {
        const cleanSymbol = symbol.trim().toUpperCase();
        files = await db.select({
          id: uploadedHtmlFiles.id,
          userId: uploadedHtmlFiles.userId,
          symbol: uploadedHtmlFiles.symbol,
          filename: uploadedHtmlFiles.filename,
          createdAt: uploadedHtmlFiles.createdAt,
        })
        .from(uploadedHtmlFiles)
        .where(eq(uploadedHtmlFiles.symbol, cleanSymbol))
        .orderBy(desc(uploadedHtmlFiles.createdAt));
      } else {
        files = await db.select({
          id: uploadedHtmlFiles.id,
          userId: uploadedHtmlFiles.userId,
          symbol: uploadedHtmlFiles.symbol,
          filename: uploadedHtmlFiles.filename,
          createdAt: uploadedHtmlFiles.createdAt,
        })
        .from(uploadedHtmlFiles)
        .orderBy(desc(uploadedHtmlFiles.createdAt));
      }

      res.json(files);
    } catch (err: any) {
      console.error("Error querying HTML files:", err);
      res.status(500).json({ error: "查詢 HTML 檔案時出錯: " + err.message, files: [] });
    }
  });

  // Serves HTML File content with proper text/html content-type for Sandbox Iframe Preview
  app.get("/api/html-files/:id/content", async (req, res) => {
    try {
      const { id } = req.params;
      const fileId = parseInt(id, 10);
      if (isNaN(fileId)) {
        return res.status(400).send("無效的檔案 ID");
      }

      const [file] = await db.select({
        htmlContent: uploadedHtmlFiles.htmlContent,
        filename: uploadedHtmlFiles.filename,
      })
      .from(uploadedHtmlFiles)
      .where(eq(uploadedHtmlFiles.id, fileId))
      .limit(1);

      if (!file) {
        return res.status(404).send("找不到該 HTML 檔案");
      }

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(file.htmlContent);
    } catch (err: any) {
      console.error("Error retrieving HTML content:", err);
      res.status(500).send("讀取 HTML 內容時出錯: " + err.message);
    }
  });

  // Delete HTML File Endpoint
  app.delete("/api/html-files/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const fileId = parseInt(id, 10);
      if (isNaN(fileId)) {
        return res.status(400).json({ error: "無效的檔案 ID" });
      }

      await db.delete(uploadedHtmlFiles).where(eq(uploadedHtmlFiles.id, fileId));
      res.json({ success: true });
    } catch (err: any) {
      console.error("Error deleting HTML file:", err);
      res.status(500).json({ error: "刪除 HTML 檔案時出錯: " + err.message });
    }
  });

  // Cross-device User AI Prompt Templates Storage
  const PROMPTS_FILE = path.join(process.cwd(), "data", "user_prompts.json");

  function getUserPromptsData(): Record<string, any[]> {
    try {
      if (fs.existsSync(PROMPTS_FILE)) {
        const raw = fs.readFileSync(PROMPTS_FILE, "utf-8");
        return JSON.parse(raw);
      }
    } catch (err) {
      console.error("Failed to read user prompts file:", err);
    }
    return {};
  }

  function saveUserPromptsData(data: Record<string, any[]>) {
    try {
      const dir = path.dirname(PROMPTS_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(PROMPTS_FILE, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
      console.error("Failed to write user prompts file:", err);
    }
  }

  app.get("/api/user-prompts", (req, res) => {
    try {
      const { userId } = req.query;
      const data = getUserPromptsData();
      let prompts = (userId && typeof userId === "string") ? data[userId] : null;
      if (!prompts || prompts.length === 0) {
        prompts = data["default"] || Object.values(data)[0] || [];
      }
      res.json({ success: true, prompts });
    } catch (err: any) {
      console.error("Error fetching user prompts:", err);
      res.status(500).json({ error: "讀取指令模版時出錯: " + err.message });
    }
  });

  app.post("/api/user-prompts", (req, res) => {
    try {
      const { userId, prompts } = req.body;
      if (!userId || !Array.isArray(prompts)) {
        return res.status(400).json({ error: "缺少必要欄位：userId, prompts (陣列)" });
      }
      const data = getUserPromptsData();
      data[userId] = prompts;
      data["default"] = prompts;
      saveUserPromptsData(data);
      res.json({ success: true, prompts });
    } catch (err: any) {
      console.error("Error saving user prompts:", err);
      res.status(500).json({ error: "儲存指令模版時出錯: " + err.message });
    }
  });

  // Add the chip analysis route
  app.post("/api/analyze-chips", async (req, res) => {
    try {
      const { imageBase64, symbol } = req.body;
      if (!imageBase64) {
        return res.status(400).json({ error: "請上傳或提供股票走勢圖檔進行分析" });
      }

      const apiKey = process.env.DEEPSEEK_API_KEY || process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "伺服器未設定 DEEPSEEK_API_KEY，請在 .env 中添加金鑰。" });
      }

      const ai = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      // Extract raw base64 data from potential data url
      const matches = imageBase64.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
      let mimeType = "image/png";
      let data = imageBase64;
      if (matches && matches.length === 3) {
        mimeType = matches[1];
        data = matches[2];
      }

      const prompt = `
你是一位精通技術分析與籌碼面（主力資金操作路徑）的 AI 投資顧問。
請仔細掃描並分析使用者上傳的 K 線走勢圖（或股票截圖）。

請結合以下主力資金週期與量價行為框架進行分析：
1. 主力資金操作5大階段特徵：
   - 吸籌：週期底部，K線小幅震盪、股價橫盤、成交量萎縮（低位量縮）。籌碼由散戶流向主力。散戶不宜重倉介入，應納入觀察清單。
   - 洗盤：股價刻意打壓、洗盤震盪，甚至跌破關鍵支撐後迅速拉回（假跌破）。初期可能量增（恐慌拋售），末期浮籌乾淨量縮（賣壓枯竭）。散戶要確認支撐位，別被洗出去。
   - 拉升：試升期（溫和量增、小陽線推進），主升段（突破關鍵壓力、均線呈現多頭排列、放量上漲）。散戶應順勢跟上，鎖定趨勢溢價。
   - 整理(換手)：中高位橫向震盪、量能縮小。主力未大規模撤離，是在進行籌碼沉澱（正向訊號）。散戶應保持耐心觀察換手。
   - 出貨：多月高位或股價大幅上漲後高檔震盪。有致命量價背離（量大不漲），或跌破關鍵支撐底線下行。散戶要提高警覺，果斷減倉避險。

2. 移動平均線 (SMA) 決策過濾（5/10/20日短期、50/100/200日長期）：
   - 黃金交叉買入：短期線上穿長期線（長期基準線如 200 SMA 斜率需持平或向上，若長期線下跌則嚴禁買入以免踩假突破）。
   - 死亡交叉賣出：短期線下穿長期線時，若長期基準線仍上升則為強勢回調，嚴禁盲目追空。

3. 水平線支撐/壓力轉換：
   - 壓力被突破轉換為第一道支撐防禦線；支撐位被跌破則轉換為未來反彈的沉重壓力。

4. 微觀K線預警組合：
   - 十字星（多空博奕平局，趨勢衰竭變盤）及超長下影線（代表有強大支撐，代表下方買盤介入）。
   - W底/頭肩底/倒頭肩/三重底具備高勝率 65%-80% 買入條件，M頭/雙頂/菱形頂/倒V型反轉則是歷史上防範暴跌高可靠的 100% 賣出/避險信號。

請針對此走勢圖（個股：${symbol || '未命名'}）進行深入量價位與結構剖析，並回覆結構化 JSON 內容，完全契合 responseSchema 的定義：
- 主力所處的操作階段（選取正在發生的階段，請客觀判斷）
- 詳細的技術型態與籌碼說明，務必詳盡專業
- 具體的散戶應對策略與操作建議
- 是否存在買入/賣出警告、它的類型（只能是 "買入警告"、"賣出警告" 或 "無"）和詳細分析（請對照手冊裡的警告概率，指出 100%, 80%, 65% 等級）
- 微觀K線支持（是否有十字星/超長下影線支撐，類型為 "十字星"、"超長下影線"、"無" 或 "兩者皆有"）
- 是否屬於 買入 / 賣出 / 等待 交易信號型態，以及原因。
`;

      const response = await generateContentWithRetry(ai, {
        model: "gemini-2.5-flash",
        contents: [
          {
            inlineData: {
              mimeType,
              data,
            },
          },
          {
            text: prompt,
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              stage: {
                type: Type.OBJECT,
                properties: {
                  accumulation: { type: Type.BOOLEAN, description: "吸籌期：低位量縮、橫盤整理（悄悄買）" },
                  shakeout: { type: Type.BOOLEAN, description: "洗盤期：假跌破、趕散戶、初期量增末期量縮" },
                  markup: { type: Type.BOOLEAN, description: "拉升期：均線多頭、放量上漲、主升段推進" },
                  consolidation: { type: Type.BOOLEAN, description: "整理期(換手)：高位換手、籌碼沈澱" },
                  distribution: { type: Type.BOOLEAN, description: "出貨期：高檔震盪、量價背離、破底下跌" }
                },
                required: ["accumulation", "shakeout", "markup", "consolidation", "distribution"]
              },
              patternExplanation: { type: Type.STRING, description: "技術型態說明。分析經典型態（如W底/M頭/旗形等）、支撐壓力轉換與移動平均線" },
              actionSuggestions: { type: Type.STRING, description: "散戶應對策略與操作建議。必須明確、具體且簡潔明瞭" },
              warnings: {
                type: Type.OBJECT,
                properties: {
                  hasWarning: { type: Type.BOOLEAN, description: "是否存在買入或賣出警告" },
                  type: { type: Type.STRING, description: "必須是以下之一：'買入警告', '賣出警告', '無'" },
                  details: { type: Type.STRING, description: "警告的存在性與概率詳細分析" }
                },
                required: ["hasWarning", "type", "details"]
              },
              candlestickSupport: {
                type: Type.OBJECT,
                properties: {
                  hasSupport: { type: Type.BOOLEAN, description: "是否有十字星或超長下影線支撐" },
                  type: { type: Type.STRING, description: "必須是以下之一：'十字星', '超長下影線', '無', '兩者皆有'" },
                  details: { type: Type.STRING, description: "微觀 K 線支撐詳細分析" }
                },
                required: ["hasSupport", "type", "details"]
              },
              signalType: { type: Type.STRING, description: "必須是以下之一：'買入', '賣出', '等待'" },
              signalExplanation: { type: Type.STRING, description: "屬於買入、賣出或等待等技術型態的原因解釋" }
            },
            required: [
              "stage",
              "patternExplanation",
              "actionSuggestions",
              "warnings",
              "candlestickSupport",
              "signalType",
              "signalExplanation"
            ]
          }
        }
      });

      const responseText = response.text;
      if (!responseText) {
        return res.status(500).json({ error: "Gemini 晶片分析回傳空白內容" });
      }

      const result = JSON.parse(responseText.trim());
      res.json(result);
    } catch (error: any) {
      console.error("Chip analysis error:", error);
      res.status(500).json({ error: error.message || "主力與籌碼分析失敗，請稍後再試。" });
    }
  });

  // Proxy route for stock quotes & historical charts (Yahoo Finance & TWSE/TPEx fallback)
  app.get("/api/stock/:symbol", async (req, res) => {
    try {
      const { symbol } = req.params;
      const { range, interval } = req.query;

      if (!symbol || !symbol.trim()) {
        return res.status(400).json({ error: "股票代號不可為空" });
      }

      const targetInterval = (interval as string) || "1d";
      const targetRange = range ? `&range=${range}` : "";
      const rawSymbol = decodeURIComponent(symbol).trim();

      // Build candidate tickers
      const candidates: string[] = [];
      candidates.push(rawSymbol);

      // Extract 4-6 digit Taiwan stock code if present (e.g. "2330", "2330 台積電", "台積電(2330)", "0050")
      const digitMatch = rawSymbol.match(/(\d{4,6})/);
      let twCode: string | null = null;
      if (digitMatch) {
        twCode = digitMatch[1];
        candidates.push(`${twCode}.TW`);
        candidates.push(`${twCode}.TWO`);
        candidates.push(twCode);
      }

      // If symbol has letters e.g. "NVDA", "AAPL"
      const alphaMatch = rawSymbol.match(/^([A-Za-z.\-^=]{1,10})$/);
      if (alphaMatch) {
        candidates.push(alphaMatch[1].toUpperCase());
      }

      const uniqueCandidates = [...new Set(candidates)];
      let foundData: any = null;
      let resolvedPrice: number | null = null;
      let resolvedSymbol: string = rawSymbol;

      // 1. Try Yahoo Finance with candidate symbols across query1 & query2
      for (const cand of uniqueCandidates) {
        for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
          try {
            const url = `https://${host}/v8/finance/chart/${encodeURIComponent(cand)}?interval=${targetInterval}${targetRange}`;
            const response = await fetch(url, {
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                Accept: "application/json",
              },
            });

            if (!response.ok) continue;
            const data = await response.json();
            const result = data?.chart?.result?.[0];
            if (result) {
              const metaPrice = result.meta?.regularMarketPrice;
              const prevClose = result.meta?.chartPreviousClose;
              const closes = result.indicators?.quote?.[0]?.close?.filter((p: any) => p !== null && !isNaN(p));
              const lastClose = closes && closes.length > 0 ? closes[closes.length - 1] : undefined;

              const price = typeof metaPrice === "number" && !isNaN(metaPrice) && metaPrice > 0
                ? metaPrice
                : (typeof lastClose === "number" && !isNaN(lastClose) && lastClose > 0
                  ? lastClose
                  : (typeof prevClose === "number" && !isNaN(prevClose) && prevClose > 0 ? prevClose : null));

              if (price) {
                foundData = data;
                resolvedPrice = price;
                resolvedSymbol = cand;
                break;
              }
            }
          } catch {
            // continue to next host/cand
          }
        }
        if (foundData && resolvedPrice) break;
      }

      // 2. If price still not resolved and we have a Taiwan stock code, query official TWSE MIS API as fallback
      if (!resolvedPrice && twCode) {
        try {
          const tseUrl = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_${twCode}.tw|otc_${twCode}.tw&json=1&delay=0`;
          const resp = await fetch(tseUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              Accept: "application/json",
            },
          });
          if (resp.ok) {
            const data = await resp.json();
            const msgList = data?.msgArray || [];
            for (const item of msgList) {
              const tradePrice = parseFloat(item.z);
              const yesterdayClose = parseFloat(item.y);
              const price = !isNaN(tradePrice) && tradePrice > 0
                ? tradePrice
                : (!isNaN(yesterdayClose) && yesterdayClose > 0 ? yesterdayClose : null);

              if (price) {
                resolvedPrice = price;
                resolvedSymbol = `${twCode}.TW`;
                // Construct a mock Yahoo-compatible chart object if none was found
                foundData = {
                  chart: {
                    result: [
                      {
                        meta: {
                          currency: "TWD",
                          symbol: resolvedSymbol,
                          regularMarketPrice: price,
                          chartPreviousClose: !isNaN(yesterdayClose) ? yesterdayClose : price,
                        },
                        indicators: {
                          quote: [{ close: [price] }],
                        },
                      },
                    ],
                  },
                };
                break;
              }
            }
          }
        } catch (twErr) {
          console.warn("TWSE MIS fallback error:", twErr);
        }
      }

      if (foundData) {
        // Ensure price & symbol are also top-level for convenience
        return res.json({
          ...foundData,
          price: resolvedPrice,
          resolvedSymbol,
        });
      }

      return res.status(404).json({ error: `找不到股票代號 ${rawSymbol} 的報價資料` });
    } catch (error) {
      console.error("Stock price API error:", error);
      res.status(500).json({ error: "取得股票報價時發生伺服器內部錯誤" });
    }
  });

  // Proxy route for generating stock operation notes with Gemini & Search Grounding
  app.post("/api/generate-operation-note", async (req, res) => {
    try {
      const {
        symbol,
        currentPrice,
        rating,
        qualityScore,
        valueScore,
        crashSimilarity,
        buyRate,
        sellRate,
        volatility,
        strategyData,
      } = req.body;

      const apiKey = process.env.DEEPSEEK_API_KEY || process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "伺服器未設定 DEEPSEEK_API_KEY，請在 .env 中添加金鑰。" });
      }

      const ai = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      const currentPriceStr = currentPrice ? `$${currentPrice}` : "未知";

      const prompt = `
        你是一個量化與風控並重的選股模型設計顧問，協助建立可實際交易的選股框架。
        請根據以下的股票資訊、個股評分指標及使用者的交易計畫，給出「執行操作備註」的建議。
        請善用你內建的 Google Search 能力尋找該股票 (${symbol}) 最新的新聞、財報數據或技術分析，
        並結合以下三個面相來擬定內容：
        1. 當前情境分析：結合最新現價 (${currentPriceStr})、市況與「個股評分指標」來評估目前狀況。
        2. 進場操作建議：融合當前計畫（分批進出場規劃、止盈/止損、關鍵價格門檻），給予具體的執行細節。
        3. 綜合考量與注意事項：點出潛在風險（特別是崩盤相似度、波動性等），以及距離目標價的多寡。

        請保持專業簡潔，條理分明。按照上述三大點進行段落劃分，輸出格式為純文字（Markdown 格式）。

        [當前狀態]
        股票代號: ${symbol}
        目前現價: ${currentPriceStr}

        [個股評分指標]
        綜合評分: ${rating || "未評分"} / 10
        企業體質 (Quality): ${qualityScore || "未評分"} / 10
        估值 (Value): ${valueScore || "未評分"} / 10
        崩盤相似度 (Crash Similarity): ${crashSimilarity || "未評分"} / 10
        看多訊號 (Buy Rate): ${buyRate || "未評分"} / 10
        看空訊號 (Sell Rate): ${sellRate || "未評分"} / 10
        波動性: ${volatility || "未知"}
        正向價值 (Pos Value): ${Math.max(0, Number(rating||5) - 5) + Math.max(0, Number(qualityScore||5) - 5) + Math.max(0, Number(valueScore||5) - 5) + Number(buyRate||5)}
        負向價值 (Neg Value): ${Math.max(0, 5 - Number(rating||5)) + Math.max(0, 5 - Number(qualityScore||5)) + Math.max(0, 5 - Number(valueScore||5)) + Number(sellRate||5)}
        
        [交易計畫與策略紀錄]
        分批進場規劃: ${JSON.stringify(strategyData?.entries || [])}
        止盈設定: ${JSON.stringify(strategyData?.tpTargets || [])}
        止損設定: ${JSON.stringify(strategyData?.slTargets || [])}
        止損條件: ${strategyData?.slConditions || "無"}
        上方壓力區: ${JSON.stringify(strategyData?.resistanceZones || [])}
        下方支撐區: ${JSON.stringify(strategyData?.supportZones || [])}
      `;

      const response = await generateContentWithRetry(ai, {
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }]
        }
      });

      res.json({ text: response.text || "" });
    } catch (error: any) {
      console.error("AI operation note error:", error);
      res.status(500).json({ error: error.message || "取得 AI 操作備註失敗，請稍後再試。" });
    }
  });

  // Proxy route for scanning and extracting strategy details from PDF
  app.post("/api/scan-pdf", async (req, res) => {
    try {
      const { pdfBase64 } = req.body;
      if (!pdfBase64) {
        return res.status(400).json({ error: "請提供 PDF Base64 檔案內容。" });
      }

      const apiKey = process.env.DEEPSEEK_API_KEY || process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "伺服器未設定 DEEPSEEK_API_KEY，請在 .env 中添加金鑰。" });
      }

      const ai = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      const response = await generateContentWithRetry(ai, {
        model: "gemini-2.5-flash",
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  data: pdfBase64,
                  mimeType: "application/pdf",
                },
              },
              {
                text: "Extract the trading strategy details from this PDF. Please match the data into entries (分批進場 - direction should be 'BUY' or 'SELL'), tpTargets (止盈設定), slTargets (止損設定) including slConditions (condition notes, if any), resistanceZones (關鍵心理門檻 壓力區) and supportZones (支撐區). For prices in resistanceZones and supportZones, if it's a range (e.g., 100~200), compute and return the average (150). Also, remove any currency symbols like $.",
              },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              entries: {
                type: Type.ARRAY,
                description: "List of entry orders (分批進出場規劃)",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    type: { type: Type.STRING, description: "BUY or SELL" },
                    priceStr: {
                      type: Type.STRING,
                      description: "Price or range",
                    },
                    quantityStr: { type: Type.STRING, description: "Quantity" },
                    notes: {
                      type: Type.STRING,
                      description: "Annotations or context",
                    },
                  },
                },
              },
              tpTargets: {
                type: Type.ARRAY,
                description: "List of take profit targets (止盈設定)",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    price: {
                      type: Type.NUMBER,
                      description: "Take profit price",
                    },
                    quantity: {
                      type: Type.NUMBER,
                      description: "Take profit quantity",
                    },
                  },
                },
              },
              slTargets: {
                type: Type.ARRAY,
                description: "List of stop loss targets (止損設定)",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    price: {
                      type: Type.NUMBER,
                      description: "Stop loss price",
                    },
                    percentage: {
                      type: Type.NUMBER,
                      description: "Stop loss percentage",
                    },
                    quantity: {
                      type: Type.NUMBER,
                      description: "Stop loss quantity",
                    },
                  },
                },
              },
              slConditions: {
                type: Type.STRING,
                description: "Stop loss dynamic/conditional description (動態/條件止損說明)",
              },
              resistanceZones: {
                type: Type.ARRAY,
                description: "List of resistance zones (關鍵心理門檻 壓力區)",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    price: {
                      type: Type.NUMBER,
                      description: "Resistance price point. If a range is given, compute the average. Remove $ symbols.",
                    },
                    notes: {
                      type: Type.STRING,
                      description: "Annotations or context",
                    },
                  },
                },
              },
              supportZones: {
                type: Type.ARRAY,
                description: "List of support zones (關鍵心理門檻 支撐區)",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    price: {
                      type: Type.NUMBER,
                      description: "Support price point. If a range is given, compute the average. Remove $ symbols.",
                    },
                    notes: {
                      type: Type.STRING,
                      description: "Annotations or context",
                    },
                  },
                },
              },
            },
          },
        },
      });

      const text = response.text;
      if (!text) throw new Error("No text returned from Gemini");

      const data = JSON.parse(text);
      res.json(data);
    } catch (error: any) {
      console.error("PDF Scan error:", error);
      res.status(500).json({ error: error.message || "掃描 PDF 失敗，請稍後再試。" });
    }
  });

  // AI analysis prompt search with Google Search grounding and Airtop support
  app.post("/api/ai-search-prompt", async (req, res) => {
    try {
      const { prompt, symbol } = req.body;
      if (!prompt) {
        return res.status(400).json({ error: "請提供 Prompt 內容。" });
      }

      const airtapKey = process.env.AIRTAP_API_KEY || process.env.AIRTOP_API_KEY || "";

      if (airtapKey) {
        console.log("Using Airtop API key for web-grounded analysis...");
        try {
          // 1. Create Airtop session
          console.log("Creating Airtop session...");
          const sessionRes = await fetch("https://api.airtop.ai/v1/sessions", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${airtapKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ configuration: {} })
          });

          if (!sessionRes.ok) {
            const errText = await sessionRes.text();
            throw new Error(`Airtop Session Creation failed: ${sessionRes.status} - ${errText}`);
          }

          const sessionJson: any = await sessionRes.json();
          const sessionId = sessionJson.data?.id || sessionJson.id;
          if (!sessionId) {
            throw new Error(`Airtop did not return a session ID: ${JSON.stringify(sessionJson)}`);
          }
          console.log(`Successfully created Airtop session: ${sessionId}`);

          try {
            // 2. Create window and load search query
            const searchUrl = symbol 
              ? `https://www.google.com/search?q=${encodeURIComponent(symbol)}+stock+latest+news+fundamental+technical+analysis`
              : "https://www.google.com";

            console.log(`Creating Airtop window loading URL: ${searchUrl}`);
            const windowRes = await fetch(`https://api.airtop.ai/v1/sessions/${sessionId}/windows`, {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${airtapKey}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({ url: searchUrl })
            });

            if (!windowRes.ok) {
              const errText = await windowRes.text();
              throw new Error(`Airtop Window Creation failed: ${windowRes.status} - ${errText}`);
            }

            const windowJson: any = await windowRes.json();
            const windowId = windowJson.data?.id || windowJson.id;
            if (!windowId) {
              throw new Error(`Airtop did not return a window ID: ${JSON.stringify(windowJson)}`);
            }
            console.log(`Successfully created Airtop window: ${windowId}`);

            // 3. Execute prompt query on the window
            console.log("Executing query prompt on Airtop window...");
            const queryRes = await fetch(`https://api.airtop.ai/v1/sessions/${sessionId}/windows/${windowId}/query`, {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${airtapKey}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({ prompt: prompt })
            });

            if (!queryRes.ok) {
              const errText = await queryRes.text();
              throw new Error(`Airtop Query execution failed: ${queryRes.status} - ${errText}`);
            }

            const queryJson: any = await queryRes.json();
            const outputText = queryJson.data?.output || queryJson.data?.text || queryJson.output || queryJson.text;
            if (!outputText) {
              throw new Error(`Airtop query returned empty output: ${JSON.stringify(queryJson)}`);
            }

            console.log("Airtop search and analysis completed successfully!");
            return res.json({ text: outputText });

          } finally {
            // Always terminate session to prevent leaking credits
            console.log(`Cleaning up Airtop session: ${sessionId}`);
            try {
              await fetch(`https://api.airtop.ai/v1/sessions/${sessionId}`, {
                method: "DELETE",
                headers: {
                  "Authorization": `Bearer ${airtapKey}`
                }
              });
            } catch (cleanupErr) {
              console.error("Failed to clean up Airtop session:", cleanupErr);
            }
          }
        } catch (airtopError: any) {
          console.error("Airtop flow failed, falling back to Gemini Search Grounding:", airtopError.message);
          // Fall back to Gemini search grounding below
        }
      }

      // FALLBACK: Gemini Search Grounding
      console.log("Executing Gemini Search Grounding fallback...");
      const apiKey = process.env.DEEPSEEK_API_KEY || process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "伺服器未設定 DEEPSEEK_API_KEY，請在 .env 中添加金鑰。" });
      }

      const ai = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      const response = await generateContentWithRetry(ai, {
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }]
        }
      });

      res.json({ text: response.text || "" });
    } catch (error: any) {
      console.error("AI prompt search error:", error);
      res.status(500).json({ error: error.message || "AI 搜尋分析失敗，請稍後再試。" });
    }
  });

  // Catch-all to prevent unmatched /api/* routes from falling through to Vite SPA index.html
  app.all('/api/*', (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(404).json({ error: `API route not found: ${req.method} ${req.originalUrl}` });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    // Prevent Edge/Chrome from caching HTML/entry points with stale prebundled chunk hashes
    app.use((req, res, next) => {
      const url = req.url || "";
      if (url === "/" || url.startsWith("/index.html") || url.startsWith("/src/main.tsx") || url.startsWith("/src/App.tsx")) {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
      }
      next();
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
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
