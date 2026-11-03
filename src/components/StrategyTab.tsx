import React, { useState, useEffect } from "react";
import { useStrategy } from "../hooks/useStrategy";
import { usePlannedOrders } from "../hooks/usePlannedOrders";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  Trash2,
  Plus,
  Target,
  AlertCircle,
  FileText,
  Layers,
  ChevronDown,
  Upload,
  FileScan,
  Share,
  Sparkles,
} from "lucide-react";
import { StrategyConfig, StrategyEntry } from "../types";
import { motion, AnimatePresence } from "motion/react";
import { ScrollIn, InteractiveButton, Magnetic } from "./MotionWrappers";
import { toast } from "sonner";
import { useStockTabs } from "../hooks/useStockTabs";

export default function StrategyTab({
  tabId,
  readOnly,
}: {
  tabId: string;
  readOnly: boolean;
}) {
  const { tabs } = useStockTabs();
  const currentTab = tabs.find((t) => t.id === tabId);
  const { strategy, saveStrategy, loading } = useStrategy(tabId);
  const { addOrder } = usePlannedOrders(tabId);

  const [isGeneratingNote, setIsGeneratingNote] = useState(false);

  const [form, setForm] = useState<Partial<StrategyConfig>>({
    entries: [],
    tpTargets: [{ price: 0, quantity: 0 }],
    slTargets: [{ price: 0, quantity: 0 }],
    slConditions: "",
    strategyNotes: "",
    operationNote: "",
    resistanceZones: [],
    supportZones: [],
  });

  const [isScanning, setIsScanning] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    entries: true,
    tp: true,
    sl: true,
    keyPrices: true,
    notes: true,
    operation: true,
  });

  const handleGenerateOperationNote = async () => {
    if (!currentTab) return;

    setIsGeneratingNote(true);
    toast.loading("AI 正在依據當前數據分析執行操作建議...", {
      id: "ai-operation-note",
    });

    try {
      const { GoogleGenAI } = await import("@/lib/ai");
      // @ts-ignore
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

      const currentPriceStr = currentTab.currentPrice
        ? `$${currentTab.currentPrice}`
        : "未知";

      const prompt = `
        你是一個量化與風控並重的選股模型設計顧問，協助建立可實際交易的選股框架。
        請根據以下的股票資訊、個股評分指標及使用者的交易計畫，給出「執行操作備註」的建議。
        請善用你內建的 Google Search 能力尋找該股票 (${currentTab.symbol}) 最新的新聞、財報數據或技術分析，
        並結合以下三個面相來擬定內容：
        1. 當前情境分析：結合最新現價 (${currentPriceStr})、市況與「個股評分指標」來評估目前狀況。
        2. 進場操作建議：融合當前計畫（分批進出場規劃、止盈/止損、關鍵價格門檻），給予具體的執行細節。
        3. 綜合考量與注意事項：點出潛在風險（特別是崩盤相似度、波動性等），以及距離目標價的多寡。

        請保持專業簡潔，條理分明。按照上述三大點進行段落劃分，輸出格式為純文字。

        [當前狀態]
        股票代號: ${currentTab.symbol}
        目前現價: ${currentPriceStr}

        [個股評分指標]
        綜合評分: ${currentTab.rating || "未評分"} / 10
        企業體質 (Quality): ${currentTab.qualityScore || "未評分"} / 10
        估值 (Value): ${currentTab.valueScore || "未評分"} / 10
        崩盤相似度 (Crash Similarity): ${currentTab.crashSimilarity || "未評分"} / 10
        看多訊號 (Buy Rate): ${currentTab.buyRate || "未評分"} / 10
        看空訊號 (Sell Rate): ${currentTab.sellRate || "未評分"} / 10
        波動性: ${currentTab.volatility || "未知"}
        正向價值 (Pos Value): ${Math.max(0, Number(currentTab.rating||5) - 5) + Math.max(0, Number(currentTab.qualityScore||5) - 5) + Math.max(0, Number(currentTab.valueScore||5) - 5) + Number(currentTab.buyRate||5)}
        負向價值 (Neg Value): ${Math.max(0, 5 - Number(currentTab.rating||5)) + Math.max(0, 5 - Number(currentTab.qualityScore||5)) + Math.max(0, 5 - Number(currentTab.valueScore||5)) + Number(currentTab.sellRate||5)}
        
        [交易計畫與策略紀錄]
        分批進場規劃: ${JSON.stringify(form.entries)}
        止盈設定: ${JSON.stringify(form.tpTargets)}
        止損設定: ${JSON.stringify(form.slTargets)} (條件: ${form.slConditions || "無"})
        關鍵壓力區: ${JSON.stringify(form.resistanceZones)}
        關鍵支撐區: ${JSON.stringify(form.supportZones)}
        策略整體備註 / 催化劑: ${form.strategyNotes || "無"}
      `;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          tools: [{ googleSearch: {} }],
        },
      });

      const resultText = response.text || "";

      setForm((prev) => ({
        ...prev,
        operationNote: resultText,
      }));

      toast.success("AI 已產生執行操作備註", { id: "ai-operation-note" });
      // Automatically open the operation section
      setOpenSections((prev) => ({ ...prev, operation: true }));
    } catch (error) {
      console.error(error);
      toast.error("AI 產生失敗，請稍後再試", { id: "ai-operation-note" });
    } finally {
      setIsGeneratingNote(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        e.key.toLowerCase() === "i"
      ) {
        // Only trigger if not in an input/textarea
        const activeEl = document.activeElement;
        const isInput =
          activeEl?.tagName === "INPUT" || activeEl?.tagName === "TEXTAREA";

        if (!isInput) {
          e.preventDefault();
          if (!readOnly && !isGeneratingNote && currentTab?.currentPrice) {
            handleGenerateOperationNote();
          }
        }
      }

      if (
        e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        e.key.toLowerCase() === "s"
      ) {
        const activeEl = document.activeElement;
        const isInput =
          activeEl?.tagName === "INPUT" || activeEl?.tagName === "TEXTAREA";

        if (!isInput) {
          e.preventDefault();
          if (!readOnly) {
            saveStrategy(form);
          }
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    readOnly,
    isGeneratingNote,
    currentTab?.currentPrice,
    handleGenerateOperationNote,
    saveStrategy,
    form,
  ]);

  const toggleSection = (section: string) => {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  useEffect(() => {
    if (strategy) {
      // Migrate legacy tp1, tp2, tp3 if needed
      const migratedTPTargets = strategy.tpTargets || [];
      if (migratedTPTargets.length === 0) {
        if (strategy.tp1)
          migratedTPTargets.push({ price: strategy.tp1, quantity: 0 });
        if (strategy.tp2)
          migratedTPTargets.push({ price: strategy.tp2, quantity: 0 });
        if (strategy.tp3)
          migratedTPTargets.push({ price: strategy.tp3, quantity: 0 });
      }

      // Migrate legacy SL targets if needed
      const migratedSLTargets = strategy.slTargets || [];
      if (migratedSLTargets.length === 0) {
        if (strategy.sl || strategy.slPercentage) {
          migratedSLTargets.push({
            price: strategy.sl || 0,
            quantity: 0,
            percentage: strategy.slPercentage,
          });
        }
      }

      setForm({
        ...strategy,
        tpTargets:
          migratedTPTargets.length > 0
            ? migratedTPTargets
            : [{ price: 0, quantity: 0 }],
        slTargets:
          migratedSLTargets.length > 0
            ? migratedSLTargets
            : [{ price: 0, quantity: 0 }],
        resistanceZones: strategy.resistanceZones || [],
        supportZones: strategy.supportZones || [],
      });
    }
  }, [strategy]);

  if (loading)
    return (
      <div className="p-8 font-mono flex items-center justify-center">
        載入中...
      </div>
    );

  const entries = form.entries || [];
  const tpTargets = form.tpTargets || [];
  const slTargets = form.slTargets || [];

  const addTPTarget = () => {
    if (tpTargets.length < 5) {
      setForm({
        ...form,
        tpTargets: [...tpTargets, { price: 0, quantity: 0 }],
      });
    }
  };

  const removeTPTarget = (index: number) => {
    const newTargets = [...tpTargets];
    newTargets.splice(index, 1);
    setForm({
      ...form,
      tpTargets:
        newTargets.length > 0 ? newTargets : [{ price: 0, quantity: 0 }],
    });
  };

  const updateTPTarget = (
    index: number,
    field: "price" | "quantity",
    value: number,
  ) => {
    const newTargets = [...tpTargets];
    newTargets[index] = { ...newTargets[index], [field]: value };
    setForm({ ...form, tpTargets: newTargets });
  };

  const addSLTarget = () => {
    if (slTargets.length < 5) {
      setForm({
        ...form,
        slTargets: [...slTargets, { price: 0, quantity: 0 }],
      });
    }
  };

  const removeSLTarget = (index: number) => {
    const newTargets = [...slTargets];
    newTargets.splice(index, 1);
    setForm({
      ...form,
      slTargets:
        newTargets.length > 0 ? newTargets : [{ price: 0, quantity: 0 }],
    });
  };

  const updateSLTarget = (
    index: number,
    field: "price" | "quantity" | "percentage",
    value: number,
  ) => {
    const newTargets = [...slTargets];
    newTargets[index] = { ...newTargets[index], [field]: value };
    setForm({ ...form, slTargets: newTargets });
  };

  const addResistanceZone = () => {
    if ((form.resistanceZones || []).length < 5) {
      setForm({
        ...form,
        resistanceZones: [
          ...(form.resistanceZones || []),
          { price: 0, notes: "" },
        ],
      });
    }
  };

  const removeResistanceZone = (index: number) => {
    const newZones = [...(form.resistanceZones || [])];
    newZones.splice(index, 1);
    setForm({ ...form, resistanceZones: newZones });
  };

  const updateResistanceZone = (
    index: number,
    field: "price" | "notes",
    value: any,
  ) => {
    const newZones = [...(form.resistanceZones || [])];
    newZones[index] = { ...newZones[index], [field]: value };
    setForm({ ...form, resistanceZones: newZones });
  };

  const addSupportZone = () => {
    if ((form.supportZones || []).length < 5) {
      setForm({
        ...form,
        supportZones: [...(form.supportZones || []), { price: 0, notes: "" }],
      });
    }
  };

  const removeSupportZone = (index: number) => {
    const newZones = [...(form.supportZones || [])];
    newZones.splice(index, 1);
    setForm({ ...form, supportZones: newZones });
  };

  const updateSupportZone = (
    index: number,
    field: "price" | "notes",
    value: any,
  ) => {
    const newZones = [...(form.supportZones || [])];
    newZones[index] = { ...newZones[index], [field]: value };
    setForm({ ...form, supportZones: newZones });
  };

  let totalQuantity = 0;
  let totalValue = 0;

  entries.forEach((entry) => {
    const qty = parseFloat(entry.quantityStr) || 0;
    let price = 0;
    if (entry.priceStr.includes("-")) {
      const [p1, p2] = entry.priceStr
        .split("-")
        .map((p) => parseFloat(p.trim()));
      if (!isNaN(p1) && !isNaN(p2)) price = (p1 + p2) / 2;
      else if (!isNaN(p1)) price = p1;
    } else {
      price = parseFloat(entry.priceStr) || 0;
    }

    if (qty > 0 && price > 0) {
      totalQuantity += qty;
      totalValue += price * qty;
    }
  });

  const avgPrice = totalQuantity > 0 ? totalValue / totalQuantity : 0;

  // Calculate stats for TP targets
  let tpTotalQuantity = 0;
  let tpTotalValue = 0;
  tpTargets.forEach((target) => {
    const qty = target.quantity || 0;
    const price = target.price || 0;
    if (qty > 0 && price > 0) {
      tpTotalQuantity += qty;
      tpTotalValue += price * qty;
    }
  });
  const tpAvgPrice = tpTotalQuantity > 0 ? tpTotalValue / tpTotalQuantity : 0;

  const isShort = entries.length > 0 && entries[0].type === "SELL";

  // Calculate stats for SL targets
  let slTotalQuantity = 0;
  let slTotalValue = 0;

  slTargets.forEach((target) => {
    const qty = target.quantity || 0;
    const price = target.price || 0;
    const pct = target.percentage || 0;

    if (qty > 0) {
      slTotalQuantity += qty;
      if (price > 0) {
        slTotalValue += price * qty;
      } else if (pct > 0 && avgPrice > 0) {
        // Derive price from percentage if price is not set
        // If user enters 3%, we assume they mean -3% return
        const changePct = pct > 0 ? -pct : pct;
        const calculatedPrice = isShort
          ? avgPrice * (1 - changePct / 100)
          : avgPrice * (1 + changePct / 100);
        slTotalValue += calculatedPrice * qty;
      }
    }
  });

  const slAvgPrice = slTotalQuantity > 0 ? slTotalValue / slTotalQuantity : 0;
  let slAvgPercentage = 0;
  if (avgPrice > 0 && slAvgPrice > 0) {
    slAvgPercentage = isShort
      ? ((avgPrice - slAvgPrice) / avgPrice) * 100
      : ((slAvgPrice - avgPrice) / avgPrice) * 100;
  }

  const handleSave = () => {
    saveStrategy(form);
  };

  const addEntry = () => {
    const newEntries = [
      ...(form.entries || []),
      { priceStr: "", type: "BUY" as const, quantityStr: "", notes: "" },
    ];
    setForm({ ...form, entries: newEntries });
  };

  const updateEntry = (
    index: number,
    field: keyof StrategyEntry,
    value: string,
  ) => {
    const newEntries = [...(form.entries || [])];
    newEntries[index] = { ...newEntries[index], [field]: value };
    setForm({ ...form, entries: newEntries });
  };

  const removeEntry = (index: number) => {
    const newEntries = [...(form.entries || [])];
    newEntries.splice(index, 1);
    setForm({ ...form, entries: newEntries });
  };

  const handleFileScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      toast.error("目前僅支援 PDF 檔案格式");
      return;
    }

    setIsScanning(true);
    toast.loading("正在掃描並分析 PDF...", { id: "scan-pdf" });

    try {
      const { GoogleGenAI, Type } = await import("@/lib/ai");
      // @ts-ignore
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string;
          // Extract base64 part
          const base64 = result.split(",")[1];
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const pdfBase64 = await base64Promise;

      const response = await ai.models.generateContent({
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
                description:
                  "Stop loss dynamic/conditional description (動態/條件止損說明)",
              },
              resistanceZones: {
                type: Type.ARRAY,
                description: "List of resistance zones (關鍵心理門檻 壓力區)",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    price: {
                      type: Type.NUMBER,
                      description:
                        "Resistance price point. If a range is given, compute the average. Remove $ symbols.",
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
                      description:
                        "Support price point. If a range is given, compute the average. Remove $ symbols.",
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

      setForm((prev) => {
        const newForm = { ...prev };
        if (data.entries && data.entries.length > 0) {
          newForm.entries = data.entries;
        }
        if (data.tpTargets && data.tpTargets.length > 0) {
          newForm.tpTargets = data.tpTargets;
        }
        if (data.slTargets && data.slTargets.length > 0) {
          newForm.slTargets = data.slTargets;
        }
        if (data.slConditions) {
          newForm.slConditions = data.slConditions;
        }
        if (data.resistanceZones && data.resistanceZones.length > 0) {
          newForm.resistanceZones = data.resistanceZones.map((z: any) => ({
            price: Number(z.price) || 0,
            notes: z.notes || "",
          }));
        }
        if (data.supportZones && data.supportZones.length > 0) {
          newForm.supportZones = data.supportZones.map((z: any) => ({
            price: Number(z.price) || 0,
            notes: z.notes || "",
          }));
        }
        return newForm;
      });

      toast.success("成功匯入策略資訊！請記得儲存", { id: "scan-pdf" });

      // Auto open sections that have data
      setOpenSections((prev) => ({
        ...prev,
        entries: !!data.entries?.length,
        tp: !!data.tpTargets?.length,
        sl: !!data.slTargets?.length,
        keyPrices:
          !!data.resistanceZones?.length || !!data.supportZones?.length,
      }));
    } catch (error) {
      console.error("Scan PDF error:", error);
      toast.error("掃描失敗，請稍後再試", { id: "scan-pdf" });
    } finally {
      setIsScanning(false);
      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleExportToOrders = async () => {
    const validEntries = entries.filter((e) => parseFloat(e.quantityStr) > 0);
    const validTP = tpTargets.filter((t) => t.quantity > 0 && t.price > 0);
    const validSL = slTargets.filter((t) => t.quantity > 0);
    const validResistance = (form.resistanceZones || []).filter(
      (z) => (z.price || 0) > 0,
    );
    const validSupport = (form.supportZones || []).filter(
      (z) => (z.price || 0) > 0,
    );

    if (
      validEntries.length === 0 &&
      validTP.length === 0 &&
      validSL.length === 0 &&
      validResistance.length === 0 &&
      validSupport.length === 0
    ) {
      toast.error("沒有可匯出的有效資料，請確認價格與數量");
      return;
    }

    let exportCount = 0;

    // 匯出進場規劃
    for (const entry of validEntries) {
      let price = 0;
      if (entry.priceStr.includes("-")) {
        const [p1] = entry.priceStr.split("-").map((p) => parseFloat(p.trim()));
        if (!isNaN(p1)) price = p1;
      } else {
        price = parseFloat(entry.priceStr);
      }

      const qty = parseFloat(entry.quantityStr);
      if (!isNaN(price) && price > 0 && !isNaN(qty)) {
        await addOrder({
          direction: entry.type,
          price,
          quantity: qty,
          status: "PENDING",
          category: "分批進出場規劃",
          conditions: entry.notes ? `[分批進場] ${entry.notes}` : "[分批進場]",
        });
        exportCount++;
      }
    }

    // 匯出止盈
    const tpDirection = isShort ? "BUY" : "SELL";
    for (let i = 0; i < validTP.length; i++) {
      const tp = validTP[i];
      await addOrder({
        direction: tpDirection,
        purpose: "平倉",
        price: tp.price,
        quantity: tp.quantity,
        status: "PENDING",
        category: "止盈設定",
        conditions: `[止盈目標 ${i + 1}]`,
      });
      exportCount++;
    }

    // 匯出止損
    const slDirection = isShort ? "BUY" : "SELL";
    for (let i = 0; i < validSL.length; i++) {
      const sl = validSL[i];
      let price = sl.price;
      if (!price && sl.percentage && sl.percentage > 0 && avgPrice > 0) {
        const changePct = sl.percentage > 0 ? -sl.percentage : sl.percentage;
        price = isShort
          ? avgPrice * (1 - changePct / 100)
          : avgPrice * (1 + changePct / 100);

        // 四捨五入到小數點後兩位
        price = Math.round(price * 100) / 100;
      }

      if (price > 0) {
        await addOrder({
          direction: slDirection,
          purpose: "平倉",
          price: price,
          quantity: sl.quantity,
          status: "PENDING",
          category: "止損設定",
          conditions:
            `[止損目標 ${i + 1}] ${form.slConditions ? form.slConditions : ""}`.trim(),
        });
        exportCount++;
      }
    }

    // 匯出關鍵價格 (壓力區)
    for (let i = 0; i < validResistance.length; i++) {
      const zone = validResistance[i];
      await addOrder({
        direction: isShort ? "BUY" : "SELL",
        price: zone.price,
        quantity: 0, // Placeholder
        status: "PENDING",
        category: "壓力門檻",
        conditions: `[壓力區 ${i + 1}] ${zone.notes}`.trim(),
      });
      exportCount++;
    }

    // 匯出關鍵價格 (支撐區)
    for (let i = 0; i < validSupport.length; i++) {
      const zone = validSupport[i];
      await addOrder({
        direction: isShort ? "SELL" : "BUY",
        price: zone.price,
        quantity: 0, // Placeholder
        status: "PENDING",
        category: "支撐門檻",
        conditions: `[支撐區 ${i + 1}] ${zone.notes}`.trim(),
      });
      exportCount++;
    }

    if (exportCount > 0) {
      toast.success(`成功匯出 ${exportCount} 筆資料至預定訂單`);
    } else {
      toast.error("無法匯出，請確認資料格式正確");
    }
  };

  return (
    <div className="space-y-4 pb-20">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-2 mb-4">
        <div>
          <p className="text-[10px] font-bold tracking-widest text-white/30 uppercase">
            Trading Strategy
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-bold tracking-tight text-white/90">
              交易計畫與策略
            </h2>

            {!readOnly && (
              <div className="flex items-center gap-2">
                <input
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  ref={fileInputRef}
                  onChange={handleFileScan}
                />
                <button
                  type="button"
                  disabled={isScanning}
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 px-2 py-1 rounded-full bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border border-blue-500/20 transition-all text-[10px] font-bold disabled:opacity-50"
                >
                  {isScanning ? (
                    <div className="h-3 w-3 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
                  ) : (
                    <FileScan className="h-3 w-3" />
                  )}
                  掃描
                </button>
                <button
                  type="button"
                  onClick={handleExportToOrders}
                  className="flex items-center gap-2 px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20 transition-all text-[10px] font-bold"
                >
                  <Share className="w-3 h-3" />
                  匯出定單
                </button>
              </div>
            )}
          </div>
        </div>
        {!readOnly && (
          <button
            onClick={handleSave}
            className="h-8 bg-white/10 hover:bg-white/20 text-white px-4 rounded-lg transition-all border border-white/10 font-bold text-xs"
          >
            儲存策略
          </button>
        )}
      </div>

      <div className="space-y-3">
        {/* Card 1: 分批進出場規劃 */}
        <ScrollIn delay={0.1}>
          <div className="flex flex-col border border-white/10 rounded-2xl bg-white/5 backdrop-blur-xl relative transition-all duration-300 z-10 overflow-hidden shadow-lg shadow-black/20">
            <div
              onClick={() => toggleSection("entries")}
              className="p-2 sm:p-3 flex flex-row items-center justify-between border-b border-transparent hover:border-white/10 transition-colors cursor-pointer shrink-0"
            >
              <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
                <Magnetic>
                  <h3 className="font-bold text-base leading-tight text-blue-400">
                    分批進出場規劃
                  </h3>
                </Magnetic>
                <div className="flex flex-wrap gap-2 items-center">
                  <p className="text-xs font-medium text-white/40 mr-2">
                    已設定 {(form.entries || []).length} 批{" "}
                    <span className="hidden md:inline">(最多 7 批)</span>
                  </p>

                  <div className="hidden sm:flex flex-wrap gap-1.5 mr-2">
                    {(form.entries || []).slice(0, 4).map(
                      (entry, i) =>
                        entry.priceStr && (
                          <motion.div
                            layout
                            key={i}
                            className="bg-white/10 border border-white/10 rounded px-1.5 py-0.5 text-[10px] font-medium flex items-center gap-1"
                          >
                            <span className="text-white/40">P{i + 1}:</span>
                            <span className="text-white/80">
                              {entry.priceStr}
                            </span>
                          </motion.div>
                        ),
                    )}
                    {(form.entries || []).length > 4 && (
                      <span className="text-[10px] font-medium text-white/40 self-center">
                        ...
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 border border-white/10 bg-white/5 rounded px-2 py-0.5">
                    <span className="text-[10px] font-medium text-white/40">
                      預計成本
                    </span>
                    <span className="text-xs font-semibold text-blue-400">
                      ${avgPrice.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 border border-white/10 bg-white/5 rounded px-2 py-0.5">
                    <span className="text-[10px] font-medium text-white/40">
                      總股數
                    </span>
                    <span className="text-xs font-semibold text-white/90">
                      {totalQuantity} 股
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-white/40 whitespace-nowrap">
                  {openSections.entries ? "收合明細 ↑" : "展開明細 ↓"}
                </span>
                <motion.div
                  animate={{ rotate: openSections.entries ? 180 : 0 }}
                >
                  <ChevronDown className="h-4 w-4 text-white/40" />
                </motion.div>
              </div>
            </div>

            <AnimatePresence>
              {openSections.entries && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  className="overflow-hidden"
                >
                  <div className="p-4 space-y-4 w-full">
                    <motion.div layout className="space-y-4">
                      {(form.entries || []).map((entry, idx) => (
                        <motion.div
                          key={idx}
                          layout
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: 20 }}
                          className="p-3 border border-white/10 rounded-xl space-y-3 bg-white/5 relative group/item hover:bg-white/10 transition-colors"
                        >
                          <div className="flex flex-col sm:flex-row sm:justify-between gap-3 sm:gap-0 sm:items-center">
                            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 flex-1">
                              <div className="flex justify-between w-full sm:w-auto items-center">
                                <h3 className="text-sm sm:text-xs font-semibold text-white/90 bg-white/10 border border-white/10 rounded px-3 sm:px-2 py-1 sm:py-0.5">
                                  第 {idx + 1} 批
                                </h3>
                                {!readOnly && (
                                  <div className="flex sm:hidden items-center gap-2">
                                    <button
                                      onClick={() => {
                                        let price = 0;
                                        if (entry.priceStr.includes("-")) {
                                          const [p1, p2] = entry.priceStr
                                            .split("-")
                                            .map((p) => parseFloat(p.trim()));
                                          if (!isNaN(p1) && !isNaN(p2))
                                            price = (p1 + p2) / 2;
                                          else if (!isNaN(p1)) price = p1;
                                        } else {
                                          price =
                                            parseFloat(entry.priceStr) || 0;
                                        }
                                        const quantity =
                                          parseFloat(entry.quantityStr) || 0;
                                        if (price > 0 && quantity > 0) {
                                          addOrder({
                                            direction: entry.type,
                                            price,
                                            quantity,
                                            category: "分批進出場規劃",
                                            conditions: `[分批進出場規劃] 第 ${idx + 1} 批`,
                                          });
                                        } else {
                                          toast.error(
                                            "請先輸入有效的價格與數量",
                                          );
                                        }
                                      }}
                                      className="text-[13px] font-bold bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border border-blue-500/30 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
                                    >
                                      預定訂單
                                    </button>
                                    <button
                                      onClick={() => removeEntry(idx)}
                                      className="text-white/30 hover:text-red-400 p-1.5"
                                    >
                                      <Trash2 className="h-5 w-5" />
                                    </button>
                                  </div>
                                )}
                              </div>

                              <div className="flex items-center w-full gap-2 flex-1 sm:max-w-2xl">
                                <div className="w-[85px] shrink-0">
                                  <Select
                                    disabled={readOnly}
                                    value={entry.type}
                                    onValueChange={(val) =>
                                      updateEntry(idx, "type", val)
                                    }
                                  >
                                    <SelectTrigger className="h-[44px] sm:h-8 border border-white/10 bg-white/5 rounded-lg sm:rounded-md focus:ring-0 focus:border-white/30 font-medium text-base sm:text-xs text-white/90">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="border border-white/10 bg-[#121212]/90 backdrop-blur-md rounded-md">
                                      <SelectItem
                                        value="BUY"
                                        className="font-medium text-base sm:text-xs text-white/90 py-2 sm:py-1"
                                      >
                                        BUY
                                      </SelectItem>
                                      <SelectItem
                                        value="SELL"
                                        className="font-medium text-base sm:text-xs text-white/90 py-2 sm:py-1"
                                      >
                                        SELL
                                      </SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>

                                <div className="flex-1 min-w-0">
                                  <Input
                                    disabled={readOnly}
                                    className="h-[44px] sm:h-8 border border-white/10 bg-white/5 rounded-lg sm:rounded-md focus-visible:ring-0 focus-visible:border-white/30 font-medium text-base sm:text-xs text-white/90"
                                    placeholder="價格/區間 (e.g. 397-400)"
                                    value={entry.priceStr}
                                    onChange={(e) =>
                                      updateEntry(
                                        idx,
                                        "priceStr",
                                        e.target.value,
                                      )
                                    }
                                  />
                                </div>

                                <div className="w-[80px] sm:w-[100px] shrink-0">
                                  <Input
                                    disabled={readOnly}
                                    className="h-[44px] sm:h-8 border border-white/10 bg-white/5 rounded-lg sm:rounded-md focus-visible:ring-0 focus-visible:border-white/30 font-medium text-base sm:text-xs text-white/90"
                                    placeholder="預定數量"
                                    value={entry.quantityStr}
                                    onChange={(e) =>
                                      updateEntry(
                                        idx,
                                        "quantityStr",
                                        e.target.value,
                                      )
                                    }
                                  />
                                </div>
                              </div>
                            </div>

                            {!readOnly && (
                              <div className="hidden sm:flex items-center gap-2 ml-2">
                                <button
                                  onClick={() => {
                                    let price = 0;
                                    if (entry.priceStr.includes("-")) {
                                      const [p1, p2] = entry.priceStr
                                        .split("-")
                                        .map((p) => parseFloat(p.trim()));
                                      if (!isNaN(p1) && !isNaN(p2))
                                        price = (p1 + p2) / 2;
                                      else if (!isNaN(p1)) price = p1;
                                    } else {
                                      price = parseFloat(entry.priceStr) || 0;
                                    }
                                    const quantity =
                                      parseFloat(entry.quantityStr) || 0;
                                    if (price > 0 && quantity > 0) {
                                      addOrder({
                                        direction: entry.type,
                                        price,
                                        quantity,
                                        category: "分批進出場規劃",
                                        conditions: `[分批進出場規劃] 第 ${idx + 1} 批`,
                                      });
                                    } else {
                                      toast.error("請先輸入有效的價格與數量");
                                    }
                                  }}
                                  className="text-[10px] font-medium bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border border-blue-500/30 px-2 py-1 rounded transition-colors whitespace-nowrap"
                                  title="新增為預定訂單"
                                >
                                  預定訂單
                                </button>
                                <button
                                  onClick={() => removeEntry(idx)}
                                  className="text-white/30 hover:text-red-400 transition-colors"
                                  title="移除此批次"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            )}
                          </div>

                          <Input
                            disabled={readOnly}
                            className="h-[44px] sm:h-8 border border-white/10 bg-white/5 rounded-lg sm:rounded-md focus-visible:ring-0 focus-visible:border-white/30 text-sm sm:text-[10px] text-white/80"
                            placeholder="點擊輸入此批次備註 (例如：反彈過壓, 突破前高)"
                            value={entry.notes}
                            onChange={(e) =>
                              updateEntry(idx, "notes", e.target.value)
                            }
                          />
                        </motion.div>
                      ))}
                    </motion.div>
                    {!readOnly && (form.entries || []).length < 7 && (
                      <button
                        className="w-full flex items-center justify-center gap-2 bg-white/5 text-white/70 py-3 sm:py-2 px-4 border border-white/10 hover:border-white/30 hover:bg-white/10 rounded-xl transition-all font-medium text-base sm:text-sm"
                        onClick={addEntry}
                      >
                        <Plus className="h-5 w-5 sm:h-4 sm:w-4" /> 新增批次
                      </button>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </ScrollIn>

        {/* Card 2: 止盈設定 */}
        <ScrollIn delay={0.2}>
          <div className="flex flex-col border border-white/10 rounded-2xl bg-white/5 backdrop-blur-xl relative transition-all duration-300 z-10 overflow-hidden shadow-lg shadow-black/20">
            <div
              onClick={() => toggleSection("tp")}
              className="p-2 sm:p-3 flex flex-row items-center justify-between border-b border-transparent hover:border-white/10 transition-colors cursor-pointer shrink-0"
            >
              <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
                <Magnetic>
                  <h3 className="font-bold text-base leading-tight text-emerald-400">
                    止盈設定{" "}
                    <span className="hidden lg:inline text-white/40 text-[10px]">
                      (Take Profit)
                    </span>
                  </h3>
                </Magnetic>
                <div className="flex flex-wrap gap-2 items-center">
                  <div className="hidden sm:flex flex-wrap gap-1.5 mr-2">
                    {tpTargets.map(
                      (target, i) =>
                        target.price > 0 && (
                          <motion.div
                            layout
                            key={i}
                            className="bg-white/10 border border-white/10 rounded px-1.5 py-0.5 text-[10px] font-medium text-white/90"
                          >
                            <span className="text-white/40 mr-1">
                              TP{i + 1}:
                            </span>
                            <span>{target.price}</span>
                          </motion.div>
                        ),
                    )}
                  </div>

                  <div className="flex items-center gap-2 border border-white/10 bg-white/5 rounded px-2 py-0.5">
                    <span className="text-[10px] font-medium text-white/40">
                      預計售價
                    </span>
                    <span className="text-xs font-semibold text-emerald-400">
                      ${tpAvgPrice.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 border border-white/10 bg-white/5 rounded px-2 py-0.5">
                    <span className="text-[10px] font-medium text-white/40">
                      總股數
                    </span>
                    <span className="text-xs font-semibold text-white/90">
                      {tpTotalQuantity} 股
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-white/40 whitespace-nowrap">
                  {openSections.tp ? "收合明細 ↑" : "展開明細 ↓"}
                </span>
                <motion.div animate={{ rotate: openSections.tp ? 180 : 0 }}>
                  <ChevronDown className="h-4 w-4 text-white/40" />
                </motion.div>
              </div>
            </div>

            <AnimatePresence>
              {openSections.tp && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  className="overflow-hidden"
                >
                  <div className="p-4 space-y-4 w-full">
                    <motion.div layout className="space-y-4">
                      {tpTargets.map((target, idx) => (
                        <motion.div
                          key={idx}
                          layout
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: 20 }}
                          className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-3 sm:p-0 border border-white/10 sm:border-transparent rounded-xl sm:rounded-none bg-white/5 sm:bg-transparent"
                        >
                          <div className="flex justify-between items-center sm:hidden w-full">
                            <Label className="font-semibold text-white/70">
                              目標 {idx + 1}
                            </Label>
                            {!readOnly && (
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => {
                                    if (
                                      target.price > 0 &&
                                      target.quantity > 0
                                    ) {
                                      addOrder({
                                        direction: isShort ? "BUY" : "SELL",
                                        purpose: "平倉",
                                        price: target.price,
                                        quantity: target.quantity,
                                        category: "止盈設定",
                                        conditions: `[止盈設定] 目標 ${idx + 1}`,
                                      });
                                    } else {
                                      toast.error("請先輸入有效的價格與數量");
                                    }
                                  }}
                                  className="text-xs font-bold bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
                                >
                                  預定訂單
                                </button>
                                {tpTargets.length > 1 && (
                                  <button
                                    onClick={() => removeTPTarget(idx)}
                                    className="text-white/30 hover:text-red-400 p-1.5"
                                  >
                                    <Trash2 className="h-5 w-5" />
                                  </button>
                                )}
                              </div>
                            )}
                          </div>

                          <Label className="hidden sm:block w-20 text-right font-semibold text-white/70 shrink-0">
                            目標 {idx + 1}
                          </Label>
                          <div className="flex-1 grid grid-cols-2 gap-3 w-full">
                            <div className="space-y-1">
                              <Label className="text-[12px] sm:text-[10px] font-medium text-white/40 ml-1">
                                止盈價格 $
                              </Label>
                              <Input
                                disabled={readOnly}
                                type="number"
                                step="0.01"
                                className="border border-white/10 bg-white/5 rounded-lg sm:rounded-md focus-visible:ring-0 focus-visible:border-white/30 font-medium h-[44px] sm:h-9 text-base text-white/90"
                                value={target.price || ""}
                                onChange={(e) =>
                                  updateTPTarget(
                                    idx,
                                    "price",
                                    Number(e.target.value),
                                  )
                                }
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[12px] sm:text-[10px] font-medium text-white/40 ml-1">
                                預定量 (股)
                              </Label>
                              <Input
                                disabled={readOnly}
                                type="number"
                                step="0.01"
                                className="border border-white/10 bg-white/5 rounded-lg sm:rounded-md focus-visible:ring-0 focus-visible:border-white/30 font-medium h-[44px] sm:h-9 text-base text-white/90"
                                value={target.quantity || ""}
                                onChange={(e) =>
                                  updateTPTarget(
                                    idx,
                                    "quantity",
                                    Number(e.target.value),
                                  )
                                }
                              />
                            </div>
                          </div>
                          {!readOnly && (
                            <div className="hidden sm:flex items-center gap-2 shrink-0">
                              <button
                                onClick={() => {
                                  if (target.price > 0 && target.quantity > 0) {
                                    addOrder({
                                      direction: isShort ? "BUY" : "SELL",
                                      purpose: "平倉",
                                      price: target.price,
                                      quantity: target.quantity,
                                      category: "止盈設定",
                                      conditions: `[止盈設定] 目標 ${idx + 1}`,
                                    });
                                  } else {
                                    toast.error("請先輸入有效的價格與數量");
                                  }
                                }}
                                className="text-[10px] font-medium bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 px-2 py-1 rounded transition-colors whitespace-nowrap"
                              >
                                預定訂單
                              </button>
                              {tpTargets.length > 1 && (
                                <button
                                  onClick={() => removeTPTarget(idx)}
                                  className="text-white/30 hover:text-red-400 p-1"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                          )}
                        </motion.div>
                      ))}
                    </motion.div>
                    {!readOnly && tpTargets.length < 5 && (
                      <div className="flex justify-center sm:justify-start sm:ml-24 mt-4">
                        <button
                          onClick={addTPTarget}
                          className="flex items-center gap-2 text-sm sm:text-xs font-semibold text-emerald-400 border border-emerald-500/30 sm:border-transparent px-4 py-3 sm:p-0 rounded-lg hover:text-emerald-300 transition-colors w-full sm:w-auto justify-center bg-emerald-500/10 sm:bg-transparent"
                        >
                          <Plus className="h-4 w-4 sm:h-3 sm:w-3" />{" "}
                          新增止盈目標
                        </button>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </ScrollIn>

        {/* Card 3: 止損設定 */}
        <ScrollIn delay={0.3}>
          <div className="flex flex-col border border-white/10 rounded-2xl bg-white/5 backdrop-blur-xl relative transition-all duration-300 z-10 overflow-hidden shadow-lg shadow-black/20">
            <div
              onClick={() => toggleSection("sl")}
              className="p-2 sm:p-3 flex flex-row items-center justify-between border-b border-transparent hover:border-white/10 transition-colors cursor-pointer shrink-0"
            >
              <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
                <Magnetic>
                  <h3 className="font-bold text-base leading-tight text-red-500">
                    止損設定{" "}
                    <span className="hidden lg:inline text-white/40 text-[10px]">
                      (Stop Loss)
                    </span>
                  </h3>
                </Magnetic>
                <div className="flex flex-wrap gap-2 items-center">
                  <div className="hidden sm:flex flex-wrap gap-1.5 mr-2">
                    {slTargets.map(
                      (target, i) =>
                        (target.price > 0 || target.percentage) && (
                          <motion.div
                            layout
                            key={i}
                            className="bg-white/10 border border-white/10 rounded px-1.5 py-0.5 text-[10px] font-medium text-white/90"
                          >
                            <span className="text-white/40 mr-1">
                              SL{i + 1}:
                            </span>
                            <span className="text-red-400">
                              {target.price > 0
                                ? `$${target.price}`
                                : `-${target.percentage}%`}
                            </span>
                          </motion.div>
                        ),
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-white/40 whitespace-nowrap">
                  {openSections.sl ? "收合明細 ↑" : "展開明細 ↓"}
                </span>
                <motion.div animate={{ rotate: openSections.sl ? 180 : 0 }}>
                  <ChevronDown className="h-4 w-4 text-white/40" />
                </motion.div>
              </div>
            </div>

            <AnimatePresence>
              {openSections.sl && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  className="overflow-hidden"
                >
                  <div className="p-4 space-y-4 w-full">
                    <motion.div layout className="space-y-4">
                      {slTargets.map((target, idx) => (
                        <motion.div
                          key={idx}
                          layout
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: 20 }}
                          className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-3 sm:p-0 border border-white/10 sm:border-transparent rounded-xl sm:rounded-none bg-white/5 sm:bg-transparent"
                        >
                          <div className="flex justify-between items-center sm:hidden w-full">
                            <Label className="font-semibold text-white/70">
                              目標 {idx + 1}
                            </Label>
                            {!readOnly && (
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => {
                                    let price = target.price || 0;
                                    if (
                                      price === 0 &&
                                      target.percentage &&
                                      avgPrice > 0
                                    ) {
                                      const changePct =
                                        target.percentage > 0
                                          ? -target.percentage
                                          : target.percentage;
                                      price = isShort
                                        ? avgPrice * (1 - changePct / 100)
                                        : avgPrice * (1 + changePct / 100);
                                    }
                                    if (price > 0 && target.quantity > 0) {
                                      addOrder({
                                        direction: isShort ? "BUY" : "SELL",
                                        purpose: "平倉",
                                        price,
                                        quantity: target.quantity,
                                        category: "止損設定",
                                        conditions: `[止損設定] 目標 ${idx + 1}`,
                                      });
                                    } else {
                                      toast.error(
                                        "請先輸入有效的價格/百分比與數量 (需有預計成本)",
                                      );
                                    }
                                  }}
                                  className="text-xs font-bold bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
                                >
                                  預定訂單
                                </button>
                                {slTargets.length > 1 && (
                                  <button
                                    onClick={() => removeSLTarget(idx)}
                                    className="text-white/30 hover:text-red-400 p-1.5"
                                  >
                                    <Trash2 className="h-5 w-5" />
                                  </button>
                                )}
                              </div>
                            )}
                          </div>

                          <Label className="hidden sm:block w-20 text-right font-semibold text-white/70 shrink-0">
                            目標 {idx + 1}
                          </Label>
                          <div className="flex-1 grid grid-cols-3 gap-3 w-full">
                            <div className="space-y-1">
                              <Label className="text-[12px] sm:text-[10px] font-medium text-white/40 ml-1">
                                價格止損 $
                              </Label>
                              <Input
                                disabled={readOnly}
                                type="number"
                                step="0.01"
                                className="border border-white/10 bg-white/5 rounded-lg sm:rounded-md focus-visible:ring-0 focus-visible:border-white/30 font-medium h-[44px] sm:h-9 text-base text-red-400"
                                value={target.price || ""}
                                onChange={(e) =>
                                  updateSLTarget(
                                    idx,
                                    "price",
                                    Number(e.target.value),
                                  )
                                }
                              />
                              {avgPrice > 0 && target.price > 0 && (
                                <div className="text-[12px] sm:text-[10px] font-semibold text-red-500/80 ml-1">
                                  計算:{" "}
                                  {(isShort
                                    ? ((avgPrice - target.price) / avgPrice) *
                                      100
                                    : ((target.price - avgPrice) / avgPrice) *
                                      100
                                  ).toFixed(2)}
                                  %
                                </div>
                              )}
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[12px] sm:text-[10px] font-medium text-white/40 ml-1">
                                百分比 %
                              </Label>
                              <Input
                                disabled={readOnly}
                                type="number"
                                step="0.1"
                                className="border border-white/10 bg-white/5 rounded-lg sm:rounded-md focus-visible:ring-0 focus-visible:border-white/30 font-medium h-[44px] sm:h-9 text-base text-red-400"
                                value={target.percentage || ""}
                                onChange={(e) =>
                                  updateSLTarget(
                                    idx,
                                    "percentage",
                                    Number(e.target.value),
                                  )
                                }
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[12px] sm:text-[10px] font-medium text-white/40 ml-1">
                                股數
                              </Label>
                              <Input
                                disabled={readOnly}
                                type="number"
                                step="0.01"
                                className="border border-white/10 bg-white/5 rounded-lg sm:rounded-md focus-visible:ring-0 focus-visible:border-white/30 font-medium h-[44px] sm:h-9 text-base text-white/90"
                                value={target.quantity || ""}
                                onChange={(e) =>
                                  updateSLTarget(
                                    idx,
                                    "quantity",
                                    Number(e.target.value),
                                  )
                                }
                              />
                            </div>
                          </div>
                          {!readOnly && (
                            <div className="hidden sm:flex items-center gap-2 shrink-0">
                              <button
                                onClick={() => {
                                  let price = target.price || 0;
                                  if (
                                    price === 0 &&
                                    target.percentage &&
                                    avgPrice > 0
                                  ) {
                                    const changePct =
                                      target.percentage > 0
                                        ? -target.percentage
                                        : target.percentage;
                                    price = isShort
                                      ? avgPrice * (1 - changePct / 100)
                                      : avgPrice * (1 + changePct / 100);
                                  }
                                  if (price > 0 && target.quantity > 0) {
                                    addOrder({
                                      direction: isShort ? "BUY" : "SELL",
                                      purpose: "平倉",
                                      price,
                                      quantity: target.quantity,
                                      category: "止損設定",
                                      conditions: `[止損設定] 目標 ${idx + 1}`,
                                    });
                                  } else {
                                    toast.error(
                                      "請先輸入有效的價格/百分比與數量 (需有預計成本)",
                                    );
                                  }
                                }}
                                className="text-[10px] font-medium bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 px-2 py-1 rounded transition-colors whitespace-nowrap"
                              >
                                預定訂單
                              </button>
                              {slTargets.length > 1 && (
                                <button
                                  onClick={() => removeSLTarget(idx)}
                                  className="text-white/30 hover:text-red-400 p-1"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                          )}
                        </motion.div>
                      ))}
                    </motion.div>
                    {!readOnly && slTargets.length < 5 && (
                      <div className="flex justify-center sm:justify-start sm:ml-24 mt-4">
                        <button
                          onClick={addSLTarget}
                          className="flex items-center gap-2 text-sm sm:text-xs font-semibold text-red-400 border border-red-500/30 sm:border-transparent px-4 py-3 sm:p-0 rounded-lg hover:text-red-300 transition-colors w-full sm:w-auto justify-center bg-red-500/10 sm:bg-transparent"
                        >
                          <Plus className="h-4 w-4 sm:h-3 sm:w-3" />{" "}
                          新增止損目標
                        </button>
                      </div>
                    )}
                    <div className="space-y-2 pt-4 border-t border-white/10">
                      <Label className="font-semibold text-white/90 text-sm">
                        動態/條件止損說明
                      </Label>
                      <Textarea
                        disabled={readOnly}
                        rows={3}
                        className="border border-white/10 bg-white/5 rounded-xl focus-visible:ring-0 focus-visible:border-white/30 p-3 sm:p-4 resize-none text-base sm:text-sm text-white/90"
                        placeholder="例如：跌破季線三天不站回、財報不如預期..."
                        value={form.slConditions}
                        onChange={(e) =>
                          setForm({ ...form, slConditions: e.target.value })
                        }
                      />
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </ScrollIn>

        {/* Card 4: 關鍵價格門檻 */}
        <ScrollIn delay={0.35}>
          <div className="flex flex-col border border-white/10 rounded-2xl bg-white/5 backdrop-blur-xl relative transition-all duration-300 z-10 overflow-hidden shadow-lg shadow-black/20">
            <div
              onClick={() => toggleSection("keyPrices")}
              className="p-2 sm:p-3 flex flex-row items-center justify-between border-b border-transparent hover:border-white/10 transition-colors cursor-pointer shrink-0"
            >
              <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
                <Magnetic>
                  <h3 className="font-bold text-base leading-tight text-yellow-400">
                    關鍵價格門檻 (支撐與壓力)
                  </h3>
                </Magnetic>
                <div className="flex flex-wrap gap-2 items-center">
                  <div className="hidden sm:flex flex-wrap gap-1.5 mr-2">
                    {(form.resistanceZones || []).slice(0, 3).map(
                      (zone, i) =>
                        zone.price > 0 && (
                          <motion.div
                            layout
                            key={`res-head-${i}`}
                            className="bg-yellow-500/10 border border-yellow-500/20 rounded px-1.5 py-0.5 text-[10px] font-medium text-yellow-400/90 flex items-center gap-1"
                          >
                            <span className="text-yellow-500/40">
                              R{i + 1}:
                            </span>
                            <span>{zone.price}</span>
                          </motion.div>
                        ),
                    )}
                    {(form.resistanceZones || []).length > 3 && (
                      <span className="text-[10px] font-medium text-white/40 self-center">
                        ...
                      </span>
                    )}

                    <span className="text-[10px] font-medium text-white/10 mx-0.5">
                      |
                    </span>

                    {(form.supportZones || []).slice(0, 3).map(
                      (zone, i) =>
                        zone.price > 0 && (
                          <motion.div
                            layout
                            key={`sup-head-${i}`}
                            className="bg-blue-500/10 border border-blue-500/20 rounded px-1.5 py-0.5 text-[10px] font-medium text-blue-400/90 flex items-center gap-1"
                          >
                            <span className="text-blue-500/40">S{i + 1}:</span>
                            <span>{zone.price}</span>
                          </motion.div>
                        ),
                    )}
                    {(form.supportZones || []).length > 3 && (
                      <span className="text-[10px] font-medium text-white/40 self-center">
                        ...
                      </span>
                    )}
                  </div>
                  <div className="flex sm:hidden flex-wrap gap-1.5 mr-2">
                    <span className="text-[10px] font-medium text-white/40">
                      壓力 {(form.resistanceZones || []).length} 筆
                    </span>
                    <span className="text-[10px] font-medium text-white/40">
                      |
                    </span>
                    <span className="text-[10px] font-medium text-white/40">
                      支撐 {(form.supportZones || []).length} 筆
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-white/40 whitespace-nowrap">
                  {openSections.keyPrices ? "收合明細 ↑" : "展開明細 ↓"}
                </span>
                <motion.div
                  animate={{ rotate: openSections.keyPrices ? 180 : 0 }}
                >
                  <ChevronDown className="h-4 w-4 text-white/40" />
                </motion.div>
              </div>
            </div>

            <AnimatePresence>
              {openSections.keyPrices && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  className="overflow-hidden"
                >
                  <div className="p-4 space-y-6 w-full">
                    {/* 壓力區 */}
                    <div className="space-y-4">
                      <h4 className="text-sm font-semibold text-yellow-500/80 border-b border-white/10 pb-2">
                        關鍵心理點位 (壓力區)
                      </h4>
                      <motion.div layout className="space-y-3">
                        {(form.resistanceZones || []).map((zone, idx) => (
                          <motion.div
                            key={`res-${idx}`}
                            layout
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 20 }}
                            className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-3 sm:p-0 border border-white/10 sm:border-transparent rounded-xl sm:rounded-none bg-white/5 sm:bg-transparent"
                          >
                            <Label className="w-16 text-right font-semibold text-white/70 shrink-0">
                              壓力 {idx + 1}
                            </Label>
                            <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3 w-full">
                              <div className="space-y-1">
                                <Label className="text-[12px] sm:text-[10px] font-medium text-white/40 ml-1">
                                  目標價格 $
                                </Label>
                                <Input
                                  disabled={readOnly}
                                  type="number"
                                  step="0.01"
                                  className="border border-white/10 bg-white/5 rounded-lg sm:rounded-md focus-visible:ring-0 focus-visible:border-white/30 font-medium h-[44px] sm:h-9 text-base text-yellow-400"
                                  value={zone.price || ""}
                                  onChange={(e) =>
                                    updateResistanceZone(
                                      idx,
                                      "price",
                                      Number(e.target.value),
                                    )
                                  }
                                />
                              </div>
                              <div className="space-y-1 sm:col-span-2">
                                <Label className="text-[12px] sm:text-[10px] font-medium text-white/40 ml-1">
                                  備註說明
                                </Label>
                                <Input
                                  disabled={readOnly}
                                  className="border border-white/10 bg-white/5 rounded-lg sm:rounded-md focus-visible:ring-0 focus-visible:border-white/30 font-medium h-[44px] sm:h-9 text-base sm:text-sm text-white/90"
                                  value={zone.notes || ""}
                                  placeholder="例：前高阻力、整數關卡..."
                                  onChange={(e) =>
                                    updateResistanceZone(
                                      idx,
                                      "notes",
                                      e.target.value,
                                    )
                                  }
                                />
                              </div>
                            </div>
                            {!readOnly && (
                              <div className="flex items-center justify-end sm:justify-start gap-2 shrink-0">
                                <button
                                  onClick={() => {
                                    if (zone.price > 0) {
                                      addOrder({
                                        direction: isShort ? "BUY" : "SELL",
                                        price: zone.price,
                                        quantity: 0,
                                        category: "壓力門檻",
                                        conditions:
                                          `[壓力門檻] ${zone.notes}`.trim(),
                                      });
                                      toast.success("已匯出壓力門檻至預定訂單");
                                    } else {
                                      toast.error("請先輸入有效的價格");
                                    }
                                  }}
                                  className="text-[10px] font-medium bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-300 border border-yellow-500/30 px-2 py-1 rounded transition-colors whitespace-nowrap"
                                  title="新增為預定訂單"
                                >
                                  預定訂單
                                </button>
                                <button
                                  onClick={() => removeResistanceZone(idx)}
                                  className="text-white/30 hover:text-red-400 p-1 sm:p-1.5 bg-white/5 sm:bg-transparent rounded-lg sm:rounded-none"
                                >
                                  <Trash2 className="h-4 w-4 sm:h-5 sm:w-5" />
                                </button>
                              </div>
                            )}
                          </motion.div>
                        ))}
                      </motion.div>
                      {!readOnly && (form.resistanceZones || []).length < 5 && (
                        <div className="flex justify-center sm:justify-start sm:ml-20 mt-2">
                          <button
                            onClick={addResistanceZone}
                            className="flex items-center gap-2 text-sm sm:text-xs font-semibold text-yellow-500/80 border border-yellow-500/30 sm:border-transparent px-4 py-2 sm:p-0 rounded-lg hover:text-yellow-400 transition-colors w-full sm:w-auto justify-center bg-yellow-500/10 sm:bg-transparent"
                          >
                            <Plus className="h-4 w-4 sm:h-3 sm:w-3" />{" "}
                            新增壓力區
                          </button>
                        </div>
                      )}
                    </div>

                    {/* 支撐區 */}
                    <div className="space-y-4 pt-4 border-t border-white/10">
                      <h4 className="text-sm font-semibold text-blue-400/80 border-b border-white/10 pb-2">
                        支撐區
                      </h4>
                      <motion.div layout className="space-y-3">
                        {(form.supportZones || []).map((zone, idx) => (
                          <motion.div
                            key={`sup-${idx}`}
                            layout
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 20 }}
                            className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-3 sm:p-0 border border-white/10 sm:border-transparent rounded-xl sm:rounded-none bg-white/5 sm:bg-transparent"
                          >
                            <Label className="w-16 text-right font-semibold text-white/70 shrink-0">
                              支撐 {idx + 1}
                            </Label>
                            <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3 w-full">
                              <div className="space-y-1">
                                <Label className="text-[12px] sm:text-[10px] font-medium text-white/40 ml-1">
                                  目標價格 $
                                </Label>
                                <Input
                                  disabled={readOnly}
                                  type="number"
                                  step="0.01"
                                  className="border border-white/10 bg-white/5 rounded-lg sm:rounded-md focus-visible:ring-0 focus-visible:border-white/30 font-medium h-[44px] sm:h-9 text-base text-blue-400"
                                  value={zone.price || ""}
                                  onChange={(e) =>
                                    updateSupportZone(
                                      idx,
                                      "price",
                                      Number(e.target.value),
                                    )
                                  }
                                />
                              </div>
                              <div className="space-y-1 sm:col-span-2">
                                <Label className="text-[12px] sm:text-[10px] font-medium text-white/40 ml-1">
                                  備註說明
                                </Label>
                                <Input
                                  disabled={readOnly}
                                  className="border border-white/10 bg-white/5 rounded-lg sm:rounded-md focus-visible:ring-0 focus-visible:border-white/30 font-medium h-[44px] sm:h-9 text-base sm:text-sm text-white/90"
                                  value={zone.notes || ""}
                                  placeholder="例：月線支撐、跳空缺口..."
                                  onChange={(e) =>
                                    updateSupportZone(
                                      idx,
                                      "notes",
                                      e.target.value,
                                    )
                                  }
                                />
                              </div>
                            </div>
                            {!readOnly && (
                              <div className="flex items-center justify-end sm:justify-start gap-2 shrink-0">
                                <button
                                  onClick={() => {
                                    if (zone.price > 0) {
                                      addOrder({
                                        direction: isShort ? "SELL" : "BUY",
                                        price: zone.price,
                                        quantity: 0,
                                        category: "支撐門檻",
                                        conditions:
                                          `[支撐門檻] ${zone.notes}`.trim(),
                                      });
                                      toast.success("已匯出支撐門檻至預定訂單");
                                    } else {
                                      toast.error("請先輸入有效的價格");
                                    }
                                  }}
                                  className="text-[10px] font-medium bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border border-blue-500/30 px-2 py-1 rounded transition-colors whitespace-nowrap"
                                  title="新增為預定訂單"
                                >
                                  預定訂單
                                </button>
                                <button
                                  onClick={() => removeSupportZone(idx)}
                                  className="text-white/30 hover:text-red-400 p-1 sm:p-1.5 bg-white/5 sm:bg-transparent rounded-lg sm:rounded-none"
                                >
                                  <Trash2 className="h-4 w-4 sm:h-5 sm:w-5" />
                                </button>
                              </div>
                            )}
                          </motion.div>
                        ))}
                      </motion.div>
                      {!readOnly && (form.supportZones || []).length < 5 && (
                        <div className="flex justify-center sm:justify-start sm:ml-20 mt-2">
                          <button
                            onClick={addSupportZone}
                            className="flex items-center gap-2 text-sm sm:text-xs font-semibold text-blue-400/80 border border-blue-500/30 sm:border-transparent px-4 py-2 sm:p-0 rounded-lg hover:text-blue-400 transition-colors w-full sm:w-auto justify-center bg-blue-500/10 sm:bg-transparent"
                          >
                            <Plus className="h-4 w-4 sm:h-3 sm:w-3" />{" "}
                            新增支撐區
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </ScrollIn>

        {/* Card 5: 整體策略備註 */}
        <ScrollIn delay={0.4}>
          <div className="flex flex-col border border-white/10 rounded-2xl bg-white/5 backdrop-blur-xl relative transition-all duration-300 z-10 overflow-hidden shadow-lg shadow-black/20">
            <div
              onClick={() => toggleSection("notes")}
              className="p-2 sm:p-3 flex flex-row items-center justify-between border-b border-transparent hover:border-white/10 transition-colors cursor-pointer shrink-0"
            >
              <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
                <Magnetic>
                  <h3 className="font-bold text-base leading-tight text-white/90">
                    整體策略備註
                  </h3>
                </Magnetic>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-white/40 whitespace-nowrap">
                  {openSections.notes ? "收合明細 ↑" : "展開明細 ↓"}
                </span>
                <motion.div animate={{ rotate: openSections.notes ? 180 : 0 }}>
                  <ChevronDown className="h-4 w-4 text-white/40" />
                </motion.div>
              </div>
            </div>

            <AnimatePresence>
              {openSections.notes && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  className="overflow-hidden"
                >
                  <div className="p-4 space-y-4 w-full">
                    <div className="space-y-3">
                      <Label className="font-semibold text-white/90">
                        策略備註內容
                      </Label>
                      <Textarea
                        disabled={readOnly}
                        rows={6}
                        className="border border-white/10 bg-white/5 rounded-xl focus-visible:ring-0 focus-visible:border-white/30 p-4 resize-none text-white/90 leading-relaxed"
                        placeholder="寫下您對這檔股票的長短期看法、基本面分析 or 總經因素..."
                        value={form.strategyNotes}
                        onChange={(e) =>
                          setForm({ ...form, strategyNotes: e.target.value })
                        }
                      />
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </ScrollIn>

        {/* Card 6: 執行操作備註 */}
        <ScrollIn delay={0.45}>
          <div className="flex flex-col border border-white/10 rounded-2xl bg-white/5 backdrop-blur-xl relative transition-all duration-300 z-10 overflow-hidden shadow-lg shadow-black/20">
            <div
              onClick={() => toggleSection("operation")}
              className="p-2 sm:p-3 flex flex-row items-center justify-between border-b border-transparent hover:border-white/10 transition-colors cursor-pointer shrink-0"
            >
              <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
                <Magnetic>
                  <h3 className="font-bold text-base leading-tight text-emerald-400">
                    執行操作備註
                  </h3>
                </Magnetic>
                <div className="flex gap-2 text-xs font-medium">
                  {form.operationNote ? (
                    <span className="text-emerald-400 bg-emerald-500/20 px-2 py-0.5 rounded border border-emerald-500/30">
                      已輸入內容
                    </span>
                  ) : (
                    <span className="text-white/40">目前無內容</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-white/40 whitespace-nowrap">
                  {openSections.operation ? "收合明細 ↑" : "展開明細 ↓"}
                </span>
                <motion.div
                  animate={{ rotate: openSections.operation ? 180 : 0 }}
                >
                  <ChevronDown className="h-4 w-4 text-white/40" />
                </motion.div>
              </div>
            </div>

            <AnimatePresence>
              {openSections.operation && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  className="overflow-hidden"
                >
                  <div className="p-4 space-y-4 w-full">
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <Label className="font-semibold text-white/90">
                          執行細節備註
                        </Label>
                        {!readOnly && (
                          <InteractiveButton
                            as="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleGenerateOperationNote();
                            }}
                            disabled={
                              isGeneratingNote || !currentTab?.currentPrice
                            }
                            className="text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                            {isGeneratingNote ? "分析中..." : "AI 智能建議"}
                          </InteractiveButton>
                        )}
                      </div>
                      <Textarea
                        disabled={readOnly}
                        rows={4}
                        className="border border-white/10 bg-white/5 rounded-xl focus-visible:ring-0 focus-visible:border-white/30 p-4 resize-none text-white/90 leading-relaxed"
                        placeholder="例如：本次進場預計回測 10 日線支撐時分批佈局、確認站上壓力後追進..."
                        value={form.operationNote || ""}
                        onChange={(e) =>
                          setForm({ ...form, operationNote: e.target.value })
                        }
                      />
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </ScrollIn>
      </div>
    </div>
  );
}
