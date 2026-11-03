/**
 * 伺服器端 AI 轉接層：把 @google/genai 的介面導到 DeepSeek。
 *
 * 用法與原本完全相同：
 *   import { GoogleGenAI, Type } from "./src/lib/ai-server.ts";
 *   const ai = new GoogleGenAI({ apiKey: process.env.DEEPSEEK_API_KEY });
 *   const res = await ai.models.generateContent({ model, contents, config });
 *   res.text
 *
 * 轉換規則：
 *  - 純文字 / JSON schema → DeepSeek chat completions
 *  - application/pdf      → 先用 pdfjs-dist 抽文字，再交給 DeepSeek
 *  - image/*              → DeepSeek 沒有視覺能力，若設定了 GEMINI_API_KEY 會自動改用 Gemini，
 *                           否則回傳清楚的錯誤訊息（K 線圖分析需要視覺模型）
 *  - tools: [{googleSearch:{}}] → DeepSeek 無網路搜尋，會加入提示要求標註「未能即時查證」
 */

export const Type = {
  STRING: "string",
  NUMBER: "number",
  INTEGER: "integer",
  BOOLEAN: "boolean",
  ARRAY: "array",
  OBJECT: "object",
  NULL: "null",
} as const;

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL = "deepseek-chat";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";

type Part = { text?: string; inlineData?: { data: string; mimeType: string } };
type Content = { role?: string; parts?: Part[] };
type GenerateArgs = {
  model?: string;
  contents: string | Content[];
  config?: {
    responseMimeType?: string;
    responseSchema?: any;
    tools?: any[];
    temperature?: number;
    systemInstruction?: string;
  };
};

function schemaToInstructions(schema: any): string {
  if (!schema) return "";
  const describe = (node: any, depth = 0): string => {
    if (!node) return "";
    const pad = "  ".repeat(depth);
    const type =
      node.type === Type.ARRAY ? "array" : node.type === Type.OBJECT ? "object" : node.type;
    let out = `${pad}- type: ${type}`;
    if (node.description) out += `，說明: ${node.description}`;
    if (node.enum) out += `，只能是: ${JSON.stringify(node.enum)}`;
    out += "\n";
    if (node.properties) {
      out += `${pad}  欄位:\n`;
      for (const [k, v] of Object.entries<any>(node.properties)) {
        out += `${pad}  * ${k}\n${describe(v, depth + 2)}`;
      }
    }
    if (node.items) out += `${pad}  陣列元素:\n${describe(node.items, depth + 1)}`;
    if (node.required) out += `${pad}  必填: ${JSON.stringify(node.required)}\n`;
    return out;
  };
  return describe(schema);
}

async function extractPdfText(base64: string): Promise<string> {
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const bytes = new Uint8Array(Buffer.from(base64, "base64"));
  const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: true }).promise;
  const chunks: string[] = [];
  const maxPages = Math.min(doc.numPages, 30);
  for (let p = 1; p <= maxPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    chunks.push(
      `--- 第 ${p} 頁 ---\n` + content.items.map((it: any) => it.str ?? "").join(" ")
    );
  }
  return chunks.join("\n\n");
}

function baseSystemPrompt(wantsJson: boolean, schema: any, usesSearchTool: boolean): string {
  const parts = [
    "你是專業的量化交易、技術分析與選股顧問，回覆一律使用繁體中文。",
  ];
  if (usesSearchTool) {
    parts.push(
      "你沒有即時網路搜尋能力：若需要最新新聞、財報或行情而你無法確認，請明確寫出「未能即時查證」，不要編造即時數據。"
    );
  }
  if (wantsJson) {
    parts.push(
      "你必須只回傳一個合法的 JSON 物件，不要加上任何說明文字、不要使用 markdown 程式碼區塊。"
    );
    if (schema) parts.push("JSON 必須完全符合以下結構：\n" + schemaToInstructions(schema));
  }
  return parts.join("\n");
}

export class GoogleGenAI {
  private deepseekKey: string;
  private geminiKey: string;
  models: { generateContent: (args: GenerateArgs) => Promise<{ text: string }> };

  constructor(opts: { apiKey?: string; httpOptions?: any } = {}) {
    this.deepseekKey =
      process.env.DEEPSEEK_API_KEY || opts?.apiKey || "";
    this.geminiKey = process.env.GEMINI_API_KEY || "";
    this.models = { generateContent: (args) => this.generateContent(args) };
  }

  private async generateContent(args: GenerateArgs): Promise<{ text: string }> {
    const { contents, config } = args;
    const wantsJson =
      config?.responseMimeType === "application/json" || !!config?.responseSchema;
    const usesSearchTool = !!config?.tools?.some((t: any) => t?.googleSearch);
    const system = baseSystemPrompt(wantsJson, config?.responseSchema, usesSearchTool);

    // 拆解 contents（兼容三種寫法：純字串 / Content[] / 直接把 Part[] 當 contents 傳）
    const rawList: any[] = typeof contents === "string" ? [{ role: "user", parts: [{ text: contents }] }] : (contents as any[]);
    const list: Content[] = rawList.map((item: any) => {
      if (item && Array.isArray(item.parts)) return item as Content;        // { role, parts: [...] }
      if (item && (item.text !== undefined || item.inlineData)) {
        return { role: "user", parts: [item as Part] };                      // 直接把 Part 當元素
      }
      return { role: "user", parts: [] };
    });
    const messages: any[] = [];
    const images: { data: string; mimeType: string }[] = [];

    for (const c of list) {
      const role = c.role === "model" ? "assistant" : "user";
      const texts: string[] = [];
      for (const p of c.parts || []) {
        if (p.text) texts.push(p.text);
        if (p.inlineData) {
          const { data, mimeType } = p.inlineData;
          if (mimeType === "application/pdf") {
            texts.push(`[以下是 PDF 抽取出的文字內容]\n${await extractPdfText(data)}`);
          } else if (mimeType.startsWith("image/")) {
            images.push({ data, mimeType });
          } else {
            texts.push(`（已忽略不支援的附件：${mimeType}）`);
          }
        }
      }
      messages.push({ role, content: texts.join("\n\n") });
    }

    // 有圖片 → 需要視覺模型（DeepSeek 無此能力）
    if (images.length > 0) {
      return this.callGemini(messages, images, system, wantsJson, args.model);
    }

    // 純文字 → DeepSeek
    if (!this.deepseekKey) {
      throw new Error("DEEPSEEK_API_KEY 未設定，AI 功能無法使用");
    }
    const body: any = {
      model: DEEPSEEK_MODEL,
      messages: [{ role: "system", content: system }, ...messages],
      temperature: config?.temperature ?? 0.7,
      stream: false,
    };
    if (wantsJson) body.response_format = { type: "json_object" };

    const res = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.deepseekKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`DeepSeek API 錯誤 (${res.status})：${errText.slice(0, 400)}`);
    }
    const data: any = await res.json();
    return { text: data?.choices?.[0]?.message?.content ?? "" };
  }

  /** 圖片（K 線圖等）需要視覺模型；DeepSeek 不支援，改用 Gemini */
  private async callGemini(
    messages: any[],
    images: { data: string; mimeType: string }[],
    system: string,
    wantsJson: boolean,
    model?: string
  ): Promise<{ text: string }> {
    if (!this.geminiKey) {
      throw new Error(
        "這個功能需要「看圖」分析（K 線圖／截圖），DeepSeek 沒有視覺能力。" +
          "請在 .env 設定 GEMINI_API_KEY 後重試（只有此功能會用到 Gemini）。"
      );
    }
    const geminiModel = !model || model.startsWith("gemini") ? "gemini-2.5-flash" : model;
    const parts: any[] = (messages
      .map((m) => ({ text: m.content }))
      .filter((p) => p.text) as any[]).concat(
      images.map((img) => ({ inline_data: { mime_type: img.mimeType, data: img.data } }))
    );

    const body: any = {
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts }],
      generationConfig: wantsJson ? { responseMimeType: "application/json" } : {},
    };

    const res = await fetch(
      `${GEMINI_URL}/${geminiModel}:generateContent?key=${encodeURIComponent(this.geminiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Gemini API 錯誤 (${res.status})：${errText.slice(0, 400)}`);
    }
    const data: any = await res.json();
    const text =
      data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join("") ?? "";
    return { text };
  }
}
