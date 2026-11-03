/**
 * DeepSeek adapter — 模擬 @google/genai 的最小介面，讓現有 AI 功能不需大改即可運作。
 *
 * 用法與原本完全相同：
 *   const { GoogleGenAI, Type } = await import("@/lib/ai");
 *   const ai = new GoogleGenAI({ apiKey: process.env.DEEPSEEK_API_KEY });
 *   const res = await ai.models.generateContent({ model, contents, config });
 *   res.text
 *
 * 差異說明：
 *  - tools: [{ googleSearch: {} }] 會被忽略（DeepSeek API 沒有內建網路搜尋）。
 *  - config.responseSchema 會轉成 JSON 說明 + response_format json_object（DeepSeek 不做強制 schema 驗證）。
 *  - inlineData 若是 application/pdf，會先用 pdfjs-dist 抽出文字再送給 DeepSeek。
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

const API_BASE = "https://api.deepseek.com";
const CHAT_MODEL = "deepseek-chat";

type InlineData = { data: string; mimeType: string };
type Part = { text?: string; inlineData?: InlineData };
type Content = { role?: string; parts?: Part[] };
type GenerateArgs = {
  model?: string;
  contents: string | Content[];
  config?: {
    responseMimeType?: string;
    responseSchema?: any;
    tools?: any[];
    systemInstruction?: string;
    temperature?: number;
  };
};

function schemaToInstructions(schema: any): string {
  if (!schema) return "";
  const describe = (node: any, depth = 0): string => {
    if (!node) return "";
    const pad = "  ".repeat(depth);
    const type = node.type === Type.ARRAY ? "array" : node.type === Type.OBJECT ? "object" : node.type;
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
  const pdfjs: any = await import("pdfjs-dist/build/pdf.mjs");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  const chunks: string[] = [];
  const maxPages = Math.min(doc.numPages, 30);
  for (let p = 1; p <= maxPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const line = content.items.map((it: any) => it.str ?? "").join(" ");
    chunks.push(`--- 第 ${p} 頁 ---\n${line}`);
  }
  return chunks.join("\n\n");
}

export class GoogleGenAI {
  private apiKey: string;
  models: { generateContent: (args: GenerateArgs) => Promise<{ text: string }> };

  constructor(opts: { apiKey?: string } = {}) {
    this.apiKey =
      opts?.apiKey || (process.env.DEEPSEEK_API_KEY as string) || "";
    if (!this.apiKey) {
      console.warn("DeepSeek API key 未設定（DEEPSEEK_API_KEY），AI 功能將無法使用");
    }
    this.models = { generateContent: (args) => this.generateContent(args) };
  }

  private async toMessages(contents: string | Content[]): Promise<any[]> {
    if (typeof contents === "string") {
      return [{ role: "user", content: contents }];
    }
    const messages: any[] = [];
    for (const c of contents || []) {
      const role = c.role === "model" ? "assistant" : "user";
      const texts: string[] = [];
      for (const p of c.parts || []) {
        if (p.text) texts.push(p.text);
        if (p.inlineData) {
          const { data, mimeType } = p.inlineData;
          if (mimeType === "application/pdf") {
            try {
              const text = await extractPdfText(data);
              texts.push(`[以下是使用者上傳 PDF 抽取出的文字內容]\n${text}`);
            } catch (e: any) {
              throw new Error(`PDF 解析失敗：${e?.message || e}`);
            }
          } else {
            texts.push(`（已忽略非文字附件：${mimeType}）`);
          }
        }
      }
      messages.push({ role, content: texts.join("\n\n") });
    }
    return messages;
  }

  private async generateContent(args: GenerateArgs): Promise<{ text: string }> {
    const { contents, config } = args;
    const messages = await this.toMessages(contents);

    const wantsJson = config?.responseMimeType === "application/json" || !!config?.responseSchema;
    const systemParts: string[] = [
      "你是專業的量化交易與選股顧問，回覆一律使用繁體中文。",
      "你沒有即時網路搜尋或查詢行情的能力；若某項資訊需要最新數據而你不知道，請明確寫出「未能即時查證」，不要編造即時新聞或價格。",
    ];
    if (config?.systemInstruction) systemParts.push(config.systemInstruction);
    if (wantsJson) {
      systemParts.push("你必須只回傳一個合法的 JSON 物件，不要加上任何說明文字、不要使用 markdown 程式碼區塊。");
      if (config?.responseSchema) {
        systemParts.push("JSON 必須符合以下結構：\n" + schemaToInstructions(config.responseSchema));
      }
    }

    const body: any = {
      model: CHAT_MODEL,
      messages: [{ role: "system", content: systemParts.join("\n") }, ...messages],
      temperature: config?.temperature ?? 0.7,
      stream: false,
    };
    if (wantsJson) body.response_format = { type: "json_object" };

    const res = await fetch(`${API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`DeepSeek API 錯誤 (${res.status})：${errText.slice(0, 300)}`);
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content ?? "";
    return { text };
  }
}
