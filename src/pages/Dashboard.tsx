import React, {
  useState,
  useEffect,
  useRef,
  useLayoutEffect,
  useCallback,
  useMemo,
} from "react";
import { useStockTabs } from "../hooks/useStockTabs";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  deleteDoc,
  doc,
  setDoc,
  updateDoc,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { fetchQuote } from "../lib/quotes";
import { useAuth } from "../lib/AuthContext";
import { toast } from "sonner";
import {
  ScrollIn,
  InteractiveButton,
  Magnetic,
} from "../components/MotionWrappers";
import { AnimatedNumber } from "../components/AnimatedNumber";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from "../components/ui/dialog";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Badge } from "../components/ui/badge";
import {
  Plus,
  TrendingUp,
  Target,
  Clock,
  Activity,
  TrendingDown,
  DownloadCloud,
  Trash2,
  RotateCcw,
  Gamepad2,
  ShieldCheck,
  EyeOff,
  Eye,
  Search,
  Settings2,
  ArrowUp,
  ArrowDown,
  Calendar,
  FileJson,
  Upload,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  AlertCircle,
  HelpCircle,
  ExternalLink,
  Star,
  CheckCircle2,
  SlidersHorizontal,
  Sparkles,
  Link,
} from "lucide-react";
import { calculateStats } from "../lib/calculations";
import { format } from "date-fns";
import { StockCardVisualizer } from "../components/StockCardVisualizer";

enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
  };
}

function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
  user: any,
) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: user?.uid,
      email: user?.email,
      emailVerified: user?.emailVerified,
    },
    operationType,
    path,
  };
  console.error("Firestore Error: ", JSON.stringify(errInfo));
  return errInfo;
}

const getDisplayHoldingStatus = (
  status: string | undefined,
): "觀察中" | "候選名單" | "買進操作" | "賣出操作" | "平倉操作" | "乖離名單" => {
  if (
    status === "觀察中" ||
    status === "買進操作" ||
    status === "賣出操作" ||
    status === "平倉操作" ||
    status === "乖離名單"
  )
    return status;
  return "候選名單";
};

const calculatePositiveValue = (
  rating: number = 5,
  qualityScore: number = 5,
  valueScore: number = 5,
  buyRate: number = 5
) => {
  return (
    Math.max(0, rating - 5) +
    Math.max(0, qualityScore - 5) +
    Math.max(0, valueScore - 5) +
    buyRate
  );
};

const calculateNegativeValue = (
  rating: number = 5,
  qualityScore: number = 5,
  valueScore: number = 5,
  sellRate: number = 5
) => {
  return (
    Math.max(0, 5 - rating) +
    Math.max(0, 5 - qualityScore) +
    Math.max(0, 5 - valueScore) +
    sellRate
  );
};

export default function Dashboard() {
  const {
    tabs,
    loading,
    addTab,
    updateTabStatus,
    updateTabHidden,
    updateTabOrder,
    updateTab,
    deleteTab,
  } = useStockTabs();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [activeTabOrders, setActiveTabOrders] = useState<Record<string, any[]>>(
    {},
  );
  const [activeTabTrades, setActiveTabTrades] = useState<Record<string, any[]>>(
    {},
  );
  const [isGeneratingSuggestion, setIsGeneratingSuggestion] = useState(false);
  const [activeViewTab, setActiveViewTab] = useState<
    "active" | "completed" | "socrates" | "alerts"
  >("active");
  const [activeHoldingSubTab, setActiveHoldingSubTab] = useState<
    "觀察中" | "候選名單" | "買進操作" | "賣出操作" | "平倉操作" | "乖離名單"
  >((sessionStorage.getItem('preferredHoldingSubTab') as any) || "候選名單");

  useEffect(() => {
    sessionStorage.setItem('preferredHoldingSubTab', activeHoldingSubTab);
  }, [activeHoldingSubTab]);
  const [activeManageTab, setActiveManageTab] = useState<
    "觀察中" | "候選名單" | "買進操作" | "賣出操作" | "平倉操作" | "乖離名單"
  >("觀察中");
  const [groupingTabId, setGroupingTabId] = useState<string | null>(null);
  const [activeTabStrategies, setActiveTabStrategies] = useState<

    Record<string, any>
  >({});
  const [flippedCards, setFlippedCards] = useState<Record<string, boolean>>({});
  const [alerts, setAlerts] = useState<any[]>([]);
  const [socratesData, setSocratesData] = useState<
    Record<string, { strong?: any[]; weak?: any[] }>
  >({});
  const [socratesCurrentDate, setSocratesCurrentDate] = useState(new Date());
  const [selectedSocratesDate, setSelectedSocratesDate] = useState<Date | null>(
    null,
  );
  const [socratesSubTab, setSocratesSubTab] = useState<"strong" | "weak">(
    "strong",
  );
  const [socratesSortConfig, setSocratesSortConfig] = useState<{
    key: string;
    direction: "asc" | "desc";
  } | null>(null);
  const [isSocratesCalendarOpen, setIsSocratesCalendarOpen] = useState(false);
  const [socratesSortWeights, setSocratesSortWeights] = useState({
    crashSimilarity: 5,
    buyScore: 7,
    sellScore: 2,
    qualityScore: 7,
    valueScore: 7,
  });
  const [isSocratesSortWeightsOpen, setIsSocratesSortWeightsOpen] =
    useState(false);

  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isImportingPrices, setIsImportingPrices] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Carousel State & Refs
  const carouselRef = useRef<HTMLDivElement>(null);

  const dragRef = useRef({
    isDragging: false,
    startX: 0,
    scrollLeft: 0,
    hasDraggedBeyondThreshold: false,
    lastX: 0,
    vx: 0,
  });

  const animFrameId = useRef<number | null>(null);
  const visibleTabsRef = useRef<any[]>([]);

  const DRAG_THRESHOLD = 5;

  const onDragStart = (e: React.MouseEvent) => {
    const ele = carouselRef.current;
    if (!ele) return;

    if (animFrameId.current) {
      cancelAnimationFrame(animFrameId.current);
      animFrameId.current = null;
    }

    dragRef.current.isDragging = true;
    dragRef.current.hasDraggedBeyondThreshold = false;
    dragRef.current.startX = e.pageX - ele.offsetLeft;
    dragRef.current.scrollLeft = ele.scrollLeft;
    dragRef.current.lastX = e.pageX;
    dragRef.current.vx = 0;

    // Disable snap behavior during drag for smooth swiping
    ele.style.scrollSnapType = "none";
    ele.style.cursor = "grabbing";
    document.body.style.userSelect = "none"; // Prevent text selection
  };

  const onDragMove = useCallback((e: MouseEvent) => {
    if (!dragRef.current.isDragging) return;

    const ele = carouselRef.current;
    if (!ele) return;

    const x = e.pageX - ele.offsetLeft;
    const dx = x - dragRef.current.startX;

    dragRef.current.vx = e.pageX - dragRef.current.lastX;
    dragRef.current.lastX = e.pageX;

    if (Math.abs(dx) > DRAG_THRESHOLD) {
      dragRef.current.hasDraggedBeyondThreshold = true;
      if (e.cancelable) {
        e.preventDefault(); // Prevent scrolling the page while dragging horizontally
      }
    }

    ele.scrollLeft = dragRef.current.scrollLeft - dx;
  }, []);

  const onDragEnd = useCallback(() => {
    if (!dragRef.current.isDragging) return;
    dragRef.current.isDragging = false;

    const ele = carouselRef.current;
    if (ele) {
      ele.style.cursor = "grab";

      const loop = () => {
        if (Math.abs(dragRef.current.vx) < 0.5) {
          ele.style.scrollSnapType = "x mandatory"; // Re-enable snap to auto-align
          animFrameId.current = null;
          return;
        }
        dragRef.current.vx *= 0.95; // decay
        ele.scrollLeft -= dragRef.current.vx;
        animFrameId.current = requestAnimationFrame(loop);
      };

      if (Math.abs(dragRef.current.vx) > 1) {
        animFrameId.current = requestAnimationFrame(loop);
      } else {
        ele.style.scrollSnapType = "x mandatory";
      }

      if (dragRef.current.hasDraggedBeyondThreshold) {
        setTimeout(() => {
          dragRef.current.hasDraggedBeyondThreshold = false;
        }, 50);
      }
    }
    document.body.style.userSelect = "";
  }, []);

  useEffect(() => {
    window.addEventListener("mousemove", onDragMove);
    window.addEventListener("mouseup", onDragEnd);
    return () => {
      window.removeEventListener("mousemove", onDragMove);
      window.removeEventListener("mouseup", onDragEnd);
      if (animFrameId.current) cancelAnimationFrame(animFrameId.current);
    };
  }, [onDragMove, onDragEnd]);

  // New stock state
  const [newSymbol, setNewSymbol] = useState("");
  const [newCompany, setNewCompany] = useState("");
  const [newTradeType, setNewTradeType] = useState<"simulated" | "real">(
    "simulated",
  );
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isManageHiddenOpen, setIsManageHiddenOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newSymbol.trim()) {
      addTab(newSymbol.trim(), newCompany.trim(), newTradeType);
      setNewSymbol("");
      setNewCompany("");
      setNewTradeType("simulated");
      setIsAddOpen(false);
    }
  };

  useEffect(() => {
    if (!user) {
      setSocratesData({});
      return;
    }

    const fetchSocratesData = async () => {
      const path = `users/${user.uid}/socratesData`;
      try {
        const socratesDoc = await getDocs(query(collection(db, path)));
        const data: Record<string, any> = {};
        socratesDoc.forEach((doc) => {
          data[doc.id] = doc.data();
        });

        // Handle migration from localStorage if Firestore is empty but local has data
        const saved = localStorage.getItem("socrates-data");
        if (Object.keys(data).length === 0 && saved) {
          try {
            const parsed = JSON.parse(saved);
            Object.keys(parsed).forEach(async (dateKey) => {
              if (Array.isArray(parsed[dateKey])) {
                parsed[dateKey] = { strong: parsed[dateKey] };
              }
              const itemPath = `${path}/${dateKey}`;
              try {
                await setDoc(doc(db, itemPath), parsed[dateKey]);
              } catch (e) {
                handleFirestoreError(e, OperationType.WRITE, itemPath, user);
              }
            });
            setSocratesData(parsed);
            localStorage.removeItem("socrates-data");
            return;
          } catch (e) {
            console.error("Migration failed", e);
          }
        }

        setSocratesData(data);
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, path, user);
      }
    };

    fetchSocratesData();
  }, [user]);

  const handleSocratesUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    dateKey: string,
    type: "strong" | "weak",
  ) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        const json = JSON.parse(text);
        if (!Array.isArray(json)) {
          throw new Error("Socrates data should be a JSON array");
        }

        const processedJson = json.map((item) => {
          const newItem = { ...item };

          // Flexible key matching to handle spaces, underscores, and various names
          Object.entries(item).forEach(([key, value]) => {
            const normalizedKey = key.toUpperCase().replace(/[\s_\.\-]+/g, "");
            if (
              normalizedKey.includes("QUALITY") &&
              newItem.qualityScore === undefined
            ) {
              newItem.qualityScore = value;
            }
            if (
              normalizedKey.includes("VALUE") &&
              newItem.valueScore === undefined
            ) {
              newItem.valueScore = value;
            }
            if (
              (normalizedKey.includes("CRASH") ||
                normalizedKey.includes("崩盤")) &&
              newItem.crashSimilarity === undefined
            ) {
              newItem.crashSimilarity = value;
            }
            if (
              (normalizedKey === "BUY" ||
                normalizedKey === "BUYSCORE" ||
                normalizedKey === "BUYRATE") &&
              newItem.buyScore === undefined
            ) {
              newItem.buyScore = value;
            }
            if (
              (normalizedKey === "SELL" ||
                normalizedKey === "SELLSCORE" ||
                normalizedKey === "SELLRATE") &&
              newItem.sellScore === undefined
            ) {
              newItem.sellScore = value;
            }
            if (
              (normalizedKey === "SYM" ||
                normalizedKey === "SYMBOL" ||
                normalizedKey === "TICKER" ||
                normalizedKey === "代碼") &&
              newItem.symbol === undefined
            ) {
              newItem.symbol = value;
            }
            if (
              (normalizedKey === "NAME" ||
                normalizedKey === "COMPANYNAME" ||
                normalizedKey === "名稱") &&
              newItem.name === undefined
            ) {
              newItem.name = value;
            }
            if (
              (normalizedKey.includes("AISCORE") ||
                normalizedKey.includes("AI分數") ||
                normalizedKey.includes("AI評分") ||
                normalizedKey === "RATING") &&
              newItem.rating === undefined
            ) {
              newItem.rating = value;
            }
            if (
              (normalizedKey.includes("CURRENTPRICE") ||
                normalizedKey === "PRICE" ||
                normalizedKey === "現價") &&
              newItem.price === undefined
            ) {
              newItem.price = value;
            }
            if (
              (normalizedKey.includes("ECM") ||
                normalizedKey.includes("訊號") ||
                normalizedKey.includes("週期狀態") ||
                normalizedKey.includes("週期") ||
                normalizedKey.includes("簡評")) &&
              newItem.ecmStatus === undefined
            ) {
              newItem.ecmStatus = value;
            }
            if (
              (normalizedKey.includes("POSITIVE") ||
                normalizedKey.includes("P+")) &&
              newItem.positiveValue === undefined
            ) {
              newItem.positiveValue = value;
            }
            if (
              (normalizedKey.includes("NEGATIVE") ||
                normalizedKey.includes("N-")) &&
              newItem.negativeValue === undefined
            ) {
              newItem.negativeValue = value;
            }
          });
          
          if (newItem.positiveValue === undefined) {
            newItem.positiveValue = calculatePositiveValue(
              Number(newItem.rating ?? 5), 
              Number(newItem.qualityScore || 5), 
              Number(newItem.valueScore || 5), 
              Number(newItem.buyScore || 5)
            );
          }
          if (newItem.negativeValue === undefined) {
            newItem.negativeValue = calculateNegativeValue(
              Number(newItem.rating ?? 5), 
              Number(newItem.qualityScore || 5), 
              Number(newItem.valueScore || 5), 
              Number(newItem.sellScore || 5)
            );
          }

          return newItem;
        });

        const currentDayData = socratesData[dateKey] || {};
        const updatedDayData = {
          ...currentDayData,
          [type]: processedJson,
        };

        const path = `users/${user.uid}/socratesData/${dateKey}`;
        try {
          // Update Firestore
          await setDoc(doc(db, path), updatedDayData);

          // Update local state
          setSocratesData((prev) => ({
            ...prev,
            [dateKey]: updatedDayData,
          }));

          toast.success(
            `成功匯入 ${dateKey} ${type === "strong" ? "最強" : "最弱"} 前 10 名（共 ${json.length} 筆）`,
          );
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, path, user);
          toast.error("匯入失敗，請檢查權限或網路連接");
        }
      } catch (error: any) {
        toast.error(`匯入失敗: ${error.message}`);
      }
      // Reset input
      e.target.value = "";
    };
    reader.readAsText(file);
  };

  const deleteSocratesData = async (
    dateKey: string,
    type: "strong" | "weak",
  ) => {
    if (!user) return;

    const currentDayData = socratesData[dateKey] || {};
    const updatedDayData = { ...currentDayData };
    delete updatedDayData[type];

    const path = `users/${user.uid}/socratesData/${dateKey}`;
    try {
      if (Object.keys(updatedDayData).length === 0) {
        // Remove document if no data left for this date
        await deleteDoc(doc(db, path));
        setSocratesData((prev) => {
          const newData = { ...prev };
          delete newData[dateKey];
          return newData;
        });
      } else {
        // Update document
        await setDoc(doc(db, path), updatedDayData);
        setSocratesData((prev) => ({
          ...prev,
          [dateKey]: updatedDayData,
        }));
      }

      toast.success(
        `已刪除 ${dateKey} ${type === "strong" ? "最強" : "最弱"} 前 10 名資料`,
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path, user);
      toast.error("刪除失敗，請檢查權限或網路連接");
    }
  };

  const handleSocratesSort = (key: string) => {
    setSocratesSortConfig((prev) => {
      if (prev && prev.key === key && prev.direction === "desc") {
        return { key, direction: "asc" };
      }
      return { key, direction: "desc" };
    });
  };

  const getSortedSocratesData = (data: any[]) => {
    if (socratesSortConfig?.key === "customScore") {
      return [...data].sort((a, b) => {
        const getCrashScore = (val: any) => {
          if (val === "高") return 3;
          if (val === "中") return 2;
          if (val === "低") return 1;
          return Number(val) || 0;
        };
        const scoreA =
          Number(a.buyScore || 0) * socratesSortWeights.buyScore +
          Number(a.sellScore || 0) * socratesSortWeights.sellScore +
          Number(a.qualityScore || 0) * socratesSortWeights.qualityScore +
          Number(a.valueScore || 0) * socratesSortWeights.valueScore +
          getCrashScore(a.crashSimilarity) *
            socratesSortWeights.crashSimilarity;

        const scoreB =
          Number(b.buyScore || 0) * socratesSortWeights.buyScore +
          Number(b.sellScore || 0) * socratesSortWeights.sellScore +
          Number(b.qualityScore || 0) * socratesSortWeights.qualityScore +
          Number(b.valueScore || 0) * socratesSortWeights.valueScore +
          getCrashScore(b.crashSimilarity) *
            socratesSortWeights.crashSimilarity;

        return socratesSortConfig.direction === "asc"
          ? scoreA - scoreB
          : scoreB - scoreA;
      });
    }

    if (!socratesSortConfig) return data;
    return [...data].sort((a, b) => {
      if (a[socratesSortConfig.key] === undefined) return 1;
      if (b[socratesSortConfig.key] === undefined) return -1;

      let valA = a[socratesSortConfig.key];
      let valB = b[socratesSortConfig.key];

      // Attempt numerical comparison if both values are valid numbers or numeric strings
      if (
        valA !== null &&
        valB !== null &&
        valA !== "" &&
        valB !== "" &&
        !isNaN(Number(valA)) &&
        !isNaN(Number(valB))
      ) {
        valA = Number(valA);
        valB = Number(valB);
      } else {
        // String comparison fallback
        valA = String(valA);
        valB = String(valB);
      }

      if (valA < valB) return socratesSortConfig.direction === "asc" ? -1 : 1;
      if (valA > valB) return socratesSortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
  };

  useEffect(() => {
    // Quick count of pending orders and fetch recent trades across all active tabs
    const fetchTabData = async () => {
      if (!user) return;
      let count = 0;
      const ordersMap: Record<string, any[]> = {};
      const tradesMap: Record<string, any[]> = {};
      const strategiesMap: Record<string, any> = {};

      const activeTabs = tabs.filter((t) => t.status === "ACTIVE");

      for (const tab of activeTabs) {
        // Fetch pending orders
        const qOrders = query(
          collection(db, `stockTabs/${tab.id}/plannedOrders`),
          where("status", "==", "PENDING"),
        );
        const snapshotOrders = await getDocs(qOrders);
        count += snapshotOrders.size;
        ordersMap[tab.id] = snapshotOrders.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));

        // Fetch trades
        const qTrades = query(collection(db, `stockTabs/${tab.id}/trades`));
        const snapshotTrades = await getDocs(qTrades);
        tradesMap[tab.id] = snapshotTrades.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));

        // Fetch strategy
        const qStrategy = query(collection(db, `stockTabs/${tab.id}/strategy`));
        const snapshotStrategy = await getDocs(qStrategy);
        const mainStrategy = snapshotStrategy.docs.find((d) => d.id === "main");
        if (mainStrategy) {
          strategiesMap[tab.id] = mainStrategy.data();
        }
      }
      setActiveTabOrders(ordersMap);
      setActiveTabTrades(tradesMap);
      setActiveTabStrategies(strategiesMap);
    };
    if (tabs.length > 0) {
      fetchTabData();
    }
  }, [tabs, user]);

  // Alert detection logic
  useEffect(() => {
    const activeTabs = tabs.filter((t) => t.status === "ACTIVE");
    const detectedAlerts: any[] = [];

    activeTabs.forEach((tab) => {
      const currentPrice = tab.currentPrice;
      if (!currentPrice || !activeTabStrategies[tab.id]) return;

      const strategy = activeTabStrategies[tab.id];
      const stockAlerts: { category: string; price: number; label: string }[] =
        [];
      const threshold = 0.02; // 2% 提醒區間

      const checkAlert = (price: number, category: string, label: string) => {
        if (!price || price <= 0) return;
        const diff = Math.abs(currentPrice - price) / price;
        if (diff <= threshold) {
          stockAlerts.push({ category, price, label });
        }
      };

      // 止盈設定
      (strategy.tpTargets || []).forEach((tp: any, i: number) =>
        checkAlert(tp.price, "止盈設定", `止盈目標 ${i + 1}`),
      );

      // 止損設定
      (strategy.slTargets || []).forEach((sl: any, i: number) => {
        if (sl.price) {
          checkAlert(sl.price, "止損設定", `止損目標 ${i + 1}`);
        } else if (sl.percentage) {
          const stats = activeTabTrades[tab.id]
            ? calculateStats(activeTabTrades[tab.id])
            : { averagePrice: 0 };
          const avgPrice = stats.averagePrice || 0;
          if (avgPrice > 0) {
            const isShort = strategy.entries?.[0]?.type === "SELL";
            const changePct =
              sl.percentage > 0 ? -sl.percentage : sl.percentage;
            const calculatedPrice = isShort
              ? avgPrice * (1 - changePct / 100)
              : avgPrice * (1 + changePct / 100);
            checkAlert(
              calculatedPrice,
              "止損設定",
              `止損 % (${sl.percentage}%)`,
            );
          }
        }
      });

      // 分批進出場規劃
      (strategy.entries || []).forEach((entry: any, i: number) => {
        if (entry.priceStr) {
          if (entry.priceStr.includes("-")) {
            const [p1, p2] = entry.priceStr
              .split("-")
              .map((p: string) => parseFloat(p.trim()));
            if (!isNaN(p1))
              checkAlert(p1, "分批進出場", `規劃 P${i + 1} (區間低)`);
            if (!isNaN(p2))
              checkAlert(p2, "分批進出場", `規劃 P${i + 1} (區間高)`);
          } else {
            const p = parseFloat(entry.priceStr);
            if (!isNaN(p)) checkAlert(p, "分批進出場", `規劃價格 P${i + 1}`);
          }
        }
      });

      // 關鍵價格門檻
      (strategy.resistanceZones || []).forEach((zone: any, i: number) =>
        checkAlert(zone.price, "關鍵價格", `壓力區 ${i + 1}`),
      );
      (strategy.supportZones || []).forEach((zone: any, i: number) =>
        checkAlert(zone.price, "關鍵價格", `支撐區 ${i + 1}`),
      );

      if (stockAlerts.length > 0) {
        detectedAlerts.push({
          tab,
          stockAlerts,
        });
      }
    });

    setAlerts(detectedAlerts);
  }, [tabs, activeTabStrategies, activeTabTrades]);

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isActionDialogOpen, setIsActionDialogOpen] = useState(false);
  const [selectedActionTab, setSelectedActionTab] = useState<any>(null);

  const handleSearchSelect = useCallback(
    (tabId: string) => {
      setIsSearchOpen(false);
      setActiveViewTab("active");

      const selectedTab = tabs.find((t) => t.id === tabId);
      if (selectedTab) {
        setActiveHoldingSubTab(
          getDisplayHoldingStatus(selectedTab.holdingStatus),
        );
      }

      // Slight delay to ensure tab is switched
      setTimeout(() => {
        const element = document.getElementById(`stock-card-${tabId}`);
        if (element && carouselRef.current) {
          element.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
            inline: "center",
          });
          // Flash effect or scale up feedback
          element.style.transform = "scale(1.05)";
          setTimeout(() => {
            element.style.transform = "";
          }, 1000);
        }
      }, 100);
    },
    [tabs],
  );

  const handleToggleTabHighlight = useCallback(
    async (tabId: string, currentStatus: boolean | undefined) => {
      if (!user) return;
      try {
        await updateDoc(doc(db, "stockTabs", tabId), {
          isFavoriteHighlight: !currentStatus,
          updatedAt: serverTimestamp(),
        });
        setIsActionDialogOpen(false);
        toast.success(!currentStatus ? "已加入重點關注" : "已取消重點關注");
      } catch (err) {
        console.error("Error updating tab highlight", err);
        toast.error("更新失敗");
      }
    },
    [user],
  );

  const handleImportLatestPrices = useCallback(async () => {
    if (!user) {
      toast.error("請先登入");
      return;
    }

    const currentActiveTabs = tabs.filter((t) => t.status === "ACTIVE");
    if (currentActiveTabs.length === 0) {
      toast.info("尚無持有中的股票");
      return;
    }

    setIsImportingPrices(true);
    toast.loading("正在抓取最新現價...", { id: "importPrices" });

    let updatedCount = 0;
    try {
      for (const tab of currentActiveTabs) {
        if (!tab.symbol) continue;

        try {
          const price = await fetchQuote(tab.symbol);

          if (price && typeof price === "number") {
            await updateDoc(doc(db, "stockTabs", tab.id), {
              currentPrice: price,
            });
            updatedCount++;
          }
        } catch (err) {
          console.error(`Failed to handle fetch for ${tab.symbol}`, err);
        }
      }

      if (updatedCount > 0) {
        toast.success(`成功更新 ${updatedCount} 筆股票現價！`, {
          id: "importPrices",
        });
      } else {
        toast.error("無法取得任何最新股票報價", { id: "importPrices" });
      }
    } catch (error) {
      console.error(error);
      toast.error("抓取現價時發生錯誤", { id: "importPrices" });
    } finally {
      setIsImportingPrices(false);
    }
  }, [user, tabs]);

  const handleToggleOrderHighlight = useCallback(
    async (
      tabId: string,
      orderId: string,
      currentStatus: boolean | undefined,
    ) => {
      if (!user) return;
      const path = `stockTabs/${tabId}/plannedOrders/${orderId}`;
      try {
        await updateDoc(doc(db, path), {
          isManualHighlight: !currentStatus,
        });
        // Local state update
        setActiveTabOrders((prev) => {
          const orders = prev[tabId] || [];
          const updatedOrders = orders.map((o) =>
            o.id === orderId ? { ...o, isManualHighlight: !currentStatus } : o,
          );
          return { ...prev, [tabId]: updatedOrders };
        });
      } catch (err) {
        console.error("Error updating highlight", err);
        toast.error("更新失敗");
      }
    },
    [user],
  );

  // Keyboard shortcuts handling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInput =
        activeEl?.tagName === "INPUT" || activeEl?.tagName === "TEXTAREA";
        
      if (isInput) return;

      // Shift + H for Fullscreen
      if (
        e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        (e.key === "H" || e.key === "h")
      ) {
        e.preventDefault();
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch((err) => {
            console.error(
              `Error attempting to enable full-screen mode: ${err.message}`,
            );
          });
        } else {
          document.exitFullscreen();
        }
        return;
      }

      // Shift + F for Search (Only if not Ctrl/Meta)
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && e.key === "F") {
        e.preventDefault();
        setIsSearchOpen(true);
        return;
      }

      // Shift + A for Add Stock
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && e.key === "A") {
        e.preventDefault();
        setIsAddOpen(true);
        return;
      }

      // Shift + I for Import Latest Prices
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && e.key === "I") {
        e.preventDefault();
        handleImportLatestPrices();
        return;
      }

      // Alt + 1/2/3/4/5/6 for Holding Sub Tabs
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        let selectedTab:
          | "觀察中"
          | "候選名單"
          | "買進操作"
          | "賣出操作"
          | "平倉操作"
          | "乖離名單"
          | null = null;
        if (e.code === "Digit1") selectedTab = "觀察中";
        else if (e.code === "Digit2") selectedTab = "候選名單";
        else if (e.code === "Digit3") selectedTab = "買進操作";
        else if (e.code === "Digit4") selectedTab = "賣出操作";
        else if (e.code === "Digit5") selectedTab = "平倉操作";
        else if (e.code === "Digit6") selectedTab = "乖離名單";

        if (selectedTab) {
          e.preventDefault();
          setActiveViewTab("active");
          setActiveHoldingSubTab(selectedTab);
          setTimeout(() => {
            const el = document.getElementById("active-cards-section");
            if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 50);
          return;
        }
      }

      // Alt + Z for flipping visible stock cards
      if (
        e.altKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.shiftKey &&
        (e.key === "Z" || e.key === "z")
      ) {
        e.preventDefault();
        setFlippedCards((prev) => {
          const visibleIds = visibleTabsRef.current.map((t) => t.id);
          if (visibleIds.length === 0) return prev;

          const anyUnflipped = visibleIds.some((id) => !prev[id]);
          const targetState = anyUnflipped;
          const nextState = { ...prev };
          visibleIds.forEach((id) => {
            nextState[id] = targetState;
          });
          return nextState;
        });
        return;
      }

      // Shift + 1/2/3/4 for Navigation
      if (e.shiftKey && !e.ctrlKey && !e.metaKey) {
        if (e.code === "Digit1") {
          e.preventDefault();
          setActiveViewTab("active");
          const el = document.getElementById("active-cards-section");
          if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
        } else if (e.code === "Digit3") {
          e.preventDefault();
          setActiveViewTab("completed");
        } else if (e.code === "Digit4") {
          e.preventDefault();
          setActiveViewTab("socrates");
          // Wait for render
          setTimeout(() => {
            const el = document.getElementById("socrates-calendar-section");
            if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 50);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleImportLatestPrices]);

  const handleExportLocal = async () => {
    if (!user) {
      toast.error("請先登入");
      return;
    }
    try {
      setIsExporting(true);
      toast.loading("準備備份資料中...", { id: "export" });

      const exportData: any = {
        backupDate: new Date().toISOString(),
        userId: user.uid,
        stockTabs: [],
      };

      const q = query(
        collection(db, "stockTabs"),
        where("userId", "==", user.uid),
      );
      const tabsSnapshot = await getDocs(q);

      for (const docSnap of tabsSnapshot.docs) {
        const tabData = {
          id: docSnap.id,
          ...(docSnap.data() as any),
          trades: [],
          plannedOrders: [],
          strategy: null,
          dailyReports: [],
        };

        // Fetch Trades
        const tradesSnapshot = await getDocs(
          collection(db, `stockTabs/${docSnap.id}/trades`),
        );
        tabData.trades = tradesSnapshot.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));

        // Fetch Planned Orders
        const ordersSnapshot = await getDocs(
          collection(db, `stockTabs/${docSnap.id}/plannedOrders`),
        );
        tabData.plannedOrders = ordersSnapshot.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));

        // Fetch Strategy
        const strategySnapshot = await getDocs(
          collection(db, `stockTabs/${docSnap.id}/strategy`),
        );
        const mainStrategy = strategySnapshot.docs.find((d) => d.id === "main");
        if (mainStrategy) {
          tabData.strategy = { id: mainStrategy.id, ...mainStrategy.data() };
        }

        // Fetch Daily Reports
        const reportsSnapshot = await getDocs(
          collection(db, `stockTabs/${docSnap.id}/dailyReports`),
        );
        tabData.dailyReports = reportsSnapshot.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));

        exportData.stockTabs.push(tabData);
      }

      // 3. Fetch Socrates Data
      const socratesSnapshot = await getDocs(
        query(collection(db, `users/${user.uid}/socratesData`)),
      );
      exportData.socratesData = socratesSnapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));

      const backupJson = JSON.stringify(exportData, null, 2);
      const filename = `TradingBackup_${new Date().toISOString().split("T")[0]}_${Date.now()}.json`;

      const blob = new Blob([backupJson], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success("備份成功！已下載至本機", { id: "export" });
    } catch (error: any) {
      console.error("Export error:", error);
      const msg = error?.message || "未知錯誤";
      toast.error(`匯出失敗: ${msg}`, { id: "export" });
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportLocal = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (
      !window.confirm(
        "如果您繼續，將會清空目前的資料並由備份檔取代。此動作無法還原，確定要執行嗎？",
      )
    ) {
      e.target.value = "";
      return;
    }

    // Helper to recursively convert ISO strings to Firestore Timestamps
    const processData = (obj: any): any => {
      if (!obj || typeof obj !== "object" || obj instanceof Timestamp)
        return obj;

      if (Array.isArray(obj)) {
        return obj.map((item) => processData(item));
      }

      // Handle Firestore Timestamp JSON representation
      if (
        obj.type === "firestore/timestamp/1.0" &&
        typeof obj.seconds === "number" &&
        typeof obj.nanoseconds === "number"
      ) {
        return new Timestamp(obj.seconds, obj.nanoseconds);
      }

      const newObj: any = {};
      for (const [key, value] of Object.entries(obj)) {
        // Handle common date fields in ISO format
        if (
          typeof value === "string" &&
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)
        ) {
          newObj[key] = Timestamp.fromDate(new Date(value));
        } else {
          newObj[key] = processData(value);
        }
      }
      return newObj;
    };

    try {
      setIsImporting(true);
      console.log("Import process started...");
      toast.loading("正在解析備份檔案...", { id: "import" });

      let backupData: any;
      try {
        const text = await file.text();
        backupData = JSON.parse(text);
      } catch (parseError: any) {
        console.error("JSON Parse Error:", parseError);
        throw new Error("備份檔案格式錯誤，無法解析 JSON");
      }

      if (
        !backupData ||
        !backupData.stockTabs ||
        !Array.isArray(backupData.stockTabs)
      ) {
        throw new Error("無效的備份檔案內容：找不到 stockTabs 資料");
      }

      console.log(`Found ${backupData.stockTabs.length} tabs to restore.`);
      toast.loading("正在清理舊資料...", { id: "import" });

      // 1. Find all user tabs
      const q = query(
        collection(db, "stockTabs"),
        where("userId", "==", user.uid),
      );
      const oldTabs = await getDocs(q);

      console.log(`Deleting ${oldTabs.size} existing tabs...`);
      // Clean up subcollections for each old tab
      for (const oldTab of oldTabs.docs) {
        const docId = oldTab.id;
        try {
          const subCollections = [
            "trades",
            "plannedOrders",
            "strategy",
            "dailyReports",
          ];
          for (const sub of subCollections) {
            const snap = await getDocs(
              collection(db, `stockTabs/${docId}/${sub}`),
            );
            for (const d of snap.docs) await deleteDoc(d.ref);
          }
          await deleteDoc(oldTab.ref);
        } catch (delError: any) {
          console.warn(`Failed to clean up tab ${docId}:`, delError);
        }
      }

      // Cleanup Socrates Data
      console.log("Cleaning up Socrates data...");
      const socratesSnap = await getDocs(
        query(collection(db, `users/${user.uid}/socratesData`)),
      );
      for (const d of socratesSnap.docs) await deleteDoc(d.ref);

      toast.loading(`正在還原 ${backupData.stockTabs.length} 筆個股資料...`, {
        id: "import",
      });

      // 2. Import new tabs
      let count = 0;
      for (const rawTabData of backupData.stockTabs) {
        try {
          const tabData = processData(rawTabData);
          const { trades, plannedOrders, strategy, dailyReports, id, ...rest } =
            tabData;

          if (!rest.symbol) {
            console.warn("Skipping tab without symbol:", tabData);
            continue;
          }

          console.log(
            `Restoring tab [${++count}/${backupData.stockTabs.length}]: ${rest.symbol} (${id})`,
          );

          // Restore tab
          await setDoc(doc(db, "stockTabs", id), {
            ...rest,
            userId: user.uid,
            updatedAt: serverTimestamp(),
          });

          // Restore Trades
          if (Array.isArray(trades)) {
            for (const trade of trades) {
              const { id: tradeId, ...tradeRest } = trade;
              await setDoc(
                doc(db, `stockTabs/${id}/trades`, tradeId),
                tradeRest,
              );
            }
          }

          // Restore Planned Orders
          if (Array.isArray(plannedOrders)) {
            for (const order of plannedOrders) {
              const { id: orderId, ...orderRest } = order;
              await setDoc(
                doc(db, `stockTabs/${id}/plannedOrders`, orderId),
                orderRest,
              );
            }
          }

          // Restore Strategy
          if (strategy) {
            const { id: strategyId, ...strategyRest } = strategy;
            await setDoc(
              doc(db, `stockTabs/${id}/strategy`, strategyId),
              strategyRest,
            );
          }

          // Restore Daily Reports
          if (Array.isArray(dailyReports)) {
            for (const report of dailyReports) {
              const { id: reportId, ...reportRest } = report;
              await setDoc(
                doc(db, `stockTabs/${id}/dailyReports`, reportId),
                reportRest,
              );
            }
          }
        } catch (tabError: any) {
          console.error(
            `Failed to restore tab ${rawTabData.symbol || "unknown"}:`,
            tabError,
          );
          throw new Error(
            `還原個股 ${rawTabData.symbol || "未知"} 時發生權限或格式錯誤: ${tabError.message}`,
          );
        }
      }

      // 3. Import Socrates Data
      if (Array.isArray(backupData.socratesData)) {
        console.log(
          `Restoring ${backupData.socratesData.length} Socrates records...`,
        );
        for (const rawSoc of backupData.socratesData) {
          const soc = processData(rawSoc);
          const { id: dateKey, ...socData } = soc;
          await setDoc(
            doc(db, `users/${user.uid}/socratesData`, dateKey),
            socData,
          );
        }
      }

      console.log("Restoration completed successfully.");
      toast.success("資料還原成功！系統將在 1.5 秒後重新整理", {
        id: "import",
      });
      setTimeout(() => window.location.reload(), 1500);
    } catch (error: any) {
      console.error("Import process failed:", error);
      toast.error(`還原失敗: ${error.message}`, { id: "import" });
    } finally {
      setIsImporting(false);
      if (e.target) e.target.value = "";
    }
  };

  const activeTabs = tabs.filter((t) => t.status === "ACTIVE");
  const visibleActiveTabs = activeTabs.filter((t) => !t.isHidden);
  const hiddenActiveTabs = activeTabs.filter((t) => t.isHidden);

  // further categorize visible tabs based on holdingStatus for rendering
  const currentSubTabVisibleTabs = visibleActiveTabs.filter(
    (t) => getDisplayHoldingStatus(t.holdingStatus) === activeHoldingSubTab,
  );
  visibleTabsRef.current = currentSubTabVisibleTabs;

  const renderGroups = useMemo(() => {
    const groups: { isGroup: boolean; id: string; tabs: any[] }[] = [];
    const processedGroupIds = new Set<string>();
    
    currentSubTabVisibleTabs.forEach((tab) => {
      if (tab.groupId) {
        if (!processedGroupIds.has(tab.groupId)) {
          processedGroupIds.add(tab.groupId);
          const allGroupTabs = visibleActiveTabs.filter(t => t.groupId === tab.groupId);
          groups.push({
            isGroup: true,
            id: tab.groupId,
            tabs: allGroupTabs
          });
        }
      } else {
        groups.push({
          isGroup: false,
          id: tab.id,
          tabs: [tab]
        });
      }
    });
    return groups;
  }, [currentSubTabVisibleTabs, visibleActiveTabs]);

  const completedTabs = tabs.filter((t) => t.status === "COMPLETED");

  const handleSmartSuggestion = async (tab: any) => {
    if (!tab) return;

    setIsGeneratingSuggestion(true);
    toast.loading("AI 正在動態分析並更新策略...", {
      id: "ai-smart-suggestion",
    });

    try {
      const { GoogleGenAI } = await import("@/lib/ai");
      // @ts-ignore
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

      // Fetch the strategy
      const strategyDocRef = doc(db, `stockTabs/${tab.id}/strategy`, 'main');
      const strategySnap = await getDoc(strategyDocRef);
      const strategyData = strategySnap.exists() ? strategySnap.data() : { entries: [], tpTargets: [], slTargets: [], slConditions: "", resistanceZones: [], supportZones: [] };

      const currentPriceStr = tab.currentPrice
        ? `$${tab.currentPrice}`
        : "未知";

      const prompt = `
        你是一個量化與風控並重的選股模型設計顧問，協助建立可實際交易的選股框架。
        請根據以下的股票資訊、個股評分指標及使用者的交易計畫，給出「執行操作備註」的建議。
        請善用你內建的 Google Search 能力尋找該股票 (${tab.symbol}) 最新的新聞、財報數據或技術分析，
        並結合以下三個面相來擬定內容：
        1. 當前情境分析：結合最新現價 (${currentPriceStr})、市況與「個股評分指標」來評估目前狀況。
        2. 進場操作建議：融合當前計畫（分批進出場規劃、止盈/止損、關鍵價格門檻），給予具體的執行細節。
        3. 綜合考量與注意事項：點出潛在風險（特別是崩盤相似度、波動性等），以及距離目標價的多寡。

        請保持專業簡潔，條理分明。按照上述三大點進行段落劃分，輸出格式為純文字。

        [當前狀態]
        股票代號: ${tab.symbol}
        目前現價: ${currentPriceStr}

        [個股評分指標]
        綜合評分: ${tab.rating || "未評分"} / 10
        企業體質 (Quality): ${tab.qualityScore || "未評分"} / 10
        估值 (Value): ${tab.valueScore || "未評分"} / 10
        崩盤相似度 (Crash Similarity): ${tab.crashSimilarity || "未評分"} / 10
        看多訊號 (Buy Rate): ${tab.buyRate || "未評分"} / 10
        看空訊號 (Sell Rate): ${tab.sellRate || "未評分"} / 10
        波動性: ${tab.volatility || "未知"}
        正向價值 (Pos Value): ${Math.max(0, Number(tab.rating||5) - 5) + Math.max(0, Number(tab.qualityScore||5) - 5) + Math.max(0, Number(tab.valueScore||5) - 5) + Number(tab.buyRate||5)}
        負向價值 (Neg Value): ${Math.max(0, 5 - Number(tab.rating||5)) + Math.max(0, 5 - Number(tab.qualityScore||5)) + Math.max(0, 5 - Number(tab.valueScore||5)) + Number(tab.sellRate||5)}
        
        [交易計畫與策略紀錄]
        分批進場規劃: ${JSON.stringify(strategyData.entries)}
        止盈設定: ${JSON.stringify(strategyData.tpTargets)}
        止損設定: ${JSON.stringify(strategyData.slTargets)}
        止損條件: ${strategyData.slConditions || "無"}
        上方壓力區: ${JSON.stringify(strategyData.resistanceZones)}
        下方支撐區: ${JSON.stringify(strategyData.supportZones)}
      `;

      const result = await ai.models.generateContent({
        model: "gemini-2.5-pro",
        contents: prompt,
      });

      const resultText = result.text;

      // Update the strategy with the new operationNote
      function stripUndefined(obj: any): any {
        if (obj === null || obj === undefined) return obj;
        if (Array.isArray(obj)) {
          return obj.map(stripUndefined);
        }
        if (typeof obj === 'object') {
          if (obj.constructor && obj.constructor.name !== 'Object') return obj;
          const newObj: any = {};
          for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined) {
              newObj[key] = stripUndefined(obj[key]);
            }
          }
          return newObj;
        }
        return obj;
      }

      const updatedStrategy = { ...strategyData, operationNote: resultText, updatedAt: serverTimestamp() };
      const sanitizedData = stripUndefined(updatedStrategy);

      await setDoc(doc(db, `stockTabs/${tab.id}/strategy`, 'main'), sanitizedData, { merge: true });

      toast.success("AI 已產生並更新策略建議", { id: "ai-smart-suggestion" });
      setIsActionDialogOpen(false);
    } catch (error) {
      console.error(error);
      toast.error("AI 產生失敗，請稍後再試", { id: "ai-smart-suggestion" });
    } finally {
      setIsGeneratingSuggestion(false);
    }
  };

  const toggleTabGroup = async (tab: any) => {
    if (tab.groupId) {
      try {
        await updateTab(tab.id, { groupId: "" });
        toast.success("已解除區塊連動");
      } catch (e) {
        toast.error("解除連動失敗");
      }
    } else {
      setGroupingTabId(tab.id);
    }
  };

  const handleGroupWith = async (sourceTabId: string, targetTab: any) => {
    const sourceTab = tabs.find(t => t.id === sourceTabId);
    if (!sourceTab) return;
    
    const existingGroup = targetTab.groupId;
    const newGroupId = existingGroup || sourceTab.symbol + '-' + Date.now();
    
    try {
      if (!existingGroup) {
         await updateTab(targetTab.id, { groupId: newGroupId });
      }
      await updateTab(sourceTabId, { groupId: newGroupId });
      toast.success("已成功連動區塊");
      setGroupingTabId(null);
    } catch (e) {
      toast.error("連動失敗");
    }
  };

  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center font-mono">
        載入中...
      </div>
    );
  }

  const moveTabUp = async (index: number) => {
    if (index === 0) return;
    const newTabs = [...activeTabs];
    const temp = newTabs[index];
    newTabs[index] = newTabs[index - 1];
    newTabs[index - 1] = temp;
    const updates = newTabs.map((tab, idx) => ({ id: tab.id, sortOrder: idx }));
    await updateTabOrder(updates);
  };

  const moveTabDown = async (index: number) => {
    if (index === activeTabs.length - 1) return;
    const newTabs = [...activeTabs];
    const temp = newTabs[index];
    newTabs[index] = newTabs[index + 1];
    newTabs[index + 1] = temp;
    const updates = newTabs.map((tab, idx) => ({ id: tab.id, sortOrder: idx }));
    await updateTabOrder(updates);
  };

  const realCompletedTabs = completedTabs.filter((t) => t.tradeType === "real");
  const totalCompletedPnL = realCompletedTabs.reduce(
    (acc, tab) => acc + (tab.finalPnL || 0),
    0,
  );
  const simulatedCompletedPnL = completedTabs
    .filter((tab) => tab.tradeType === "simulated")
    .reduce((acc, tab) => acc + (tab.finalPnL || 0), 0);

  const realWinningTrades = realCompletedTabs.filter(
    (t) => (t.finalPnL || 0) > 0,
  );
  const realWinRate =
    realCompletedTabs.length > 0
      ? ((realWinningTrades.length / realCompletedTabs.length) * 100).toFixed(1)
      : 0;

  const simulatedCompletedTabs = completedTabs.filter(
    (t) => t.tradeType === "simulated",
  );
  const simulatedWinningTrades = simulatedCompletedTabs.filter(
    (t) => (t.finalPnL || 0) > 0,
  );
  const simulatedWinRate =
    simulatedCompletedTabs.length > 0
      ? (
          (simulatedWinningTrades.length / simulatedCompletedTabs.length) *
          100
        ).toFixed(1)
      : 0;

  // Neo-brutalist card variants
  const cardVariants = {
    rest: {
      scale: 1,
      y: 0,
      opacity: 0.9,
      filter: "brightness(1) drop-shadow(0 4px 6px rgba(0,0,0,0.1))",
    },
    hover: {
      scale: 1.02,
      y: -4,
      opacity: 1,
      filter: "brightness(1.1) drop-shadow(0 20px 25px rgba(0,0,0,0.3))",
      transition: { type: "spring", stiffness: 400, damping: 25 },
    },
  };

  return (
    <div className="space-y-4 sm:space-y-6 max-w-6xl mx-auto pb-12 px-3 sm:px-4 mt-0">
      <ScrollIn>
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end glass-panel px-4 py-4 mb-4 relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/10 via-transparent to-blue-500/10 opacity-50 group-hover:opacity-100 transition-opacity duration-700"></div>
          <div className="relative z-10 w-full flex flex-col md:flex-row justify-between items-start md:items-end gap-3 sm:gap-4 border-b border-white/5 pb-2">
            <div className="w-full text-center md:text-left">
              <div className="flex items-center justify-center md:justify-start gap-2">
                <p className="text-[10px] font-medium tracking-[0.25em] text-emerald-400 uppercase mb-1">
                  Portfolio Overview
                </p>
                <button
                  onClick={() => setIsHelpOpen(true)}
                  className="mb-1 text-white/20 hover:text-white/50 transition-colors p-1"
                  title="快捷鍵一覽"
                >
                  <HelpCircle className="w-3.5 h-3.5" />
                </button>
              </div>
              <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-white to-white/60 drop-shadow-sm">
                交易總覽
              </h1>
            </div>
            <div className="grid grid-cols-2 sm:flex sm:flex-row w-full md:w-auto items-stretch sm:items-center gap-2">
              <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                <DialogTrigger
                  render={
                    <InteractiveButton
                      noGlow
                      as="button"
                      className="h-[36px] sm:h-8 w-full col-span-2 sm:col-span-1 sm:w-auto sm:min-w-[100px] px-3 flex items-center justify-center text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 text-xs sm:text-[11px] font-semibold transition-all hover:bg-emerald-500/20 hover:text-emerald-300 rounded-lg sm:rounded"
                    >
                      <span>新增股票</span>
                    </InteractiveButton>
                  }
                />
                <DialogContent className="glass-panel border-white/10 shadow-2xl bg-slate-900/90 backdrop-blur-3xl text-white outline-none w-[95vw] max-w-[400px] h-auto max-h-[90vh] overflow-y-auto !rounded-3xl p-5 sm:p-6 p-safe">
                  <DialogHeader>
                    <DialogTitle className="font-bold text-2xl tracking-tight text-white mb-2">
                      新增股票分頁
                    </DialogTitle>
                  </DialogHeader>
                  <form
                    onSubmit={handleAddSubmit}
                    className="space-y-5 outline-none"
                  >
                    <div className="space-y-2">
                      <Label
                        htmlFor="symbol_dashboard"
                        className="font-medium text-white/70 text-base sm:text-sm"
                      >
                        股票代號 (Ticker)
                      </Label>
                      <Input
                        id="symbol_dashboard"
                        value={newSymbol}
                        onChange={(e) =>
                          setNewSymbol(e.target.value.toUpperCase())
                        }
                        placeholder="例如：AAPL"
                        required
                        className="bg-white/5 border-white/10 text-white placeholder-white/30 focus-visible:ring-emerald-500/50 focus-visible:border-emerald-500 h-[48px] text-base"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label
                        htmlFor="company_dashboard"
                        className="font-medium text-white/70 text-base sm:text-sm"
                      >
                        公司名稱 (選填)
                      </Label>
                      <Input
                        id="company_dashboard"
                        value={newCompany}
                        onChange={(e) => setNewCompany(e.target.value)}
                        placeholder="例如：Apple Inc."
                        className="bg-white/5 border-white/10 text-white placeholder-white/30 focus-visible:ring-emerald-500/50 focus-visible:border-emerald-500 h-[48px] text-base"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="font-medium text-white/70 text-base sm:text-sm">
                        交易模式
                      </Label>
                      <Select
                        value={newTradeType}
                        onValueChange={(val: any) => setNewTradeType(val)}
                      >
                        <SelectTrigger className="w-full bg-white/5 border-white/10 text-white focus-visible:ring-emerald-500/50 focus-visible:border-emerald-500 h-[48px] text-base">
                          <SelectValue placeholder="選擇交易模式" />
                        </SelectTrigger>
                        <SelectContent className="glass-panel border-white/10 text-white outline-none">
                          <SelectItem
                            value="simulated"
                            className="font-medium focus:bg-white/10 focus:text-white cursor-pointer px-4 text-base sm:text-sm py-3 sm:py-1"
                          >
                            <div className="flex items-center gap-3">
                              <Gamepad2 className="h-5 w-5 sm:h-4 sm:w-4 text-amber-400" />
                              模擬交易 (Simulated)
                            </div>
                          </SelectItem>
                          <SelectItem
                            value="real"
                            className="font-medium focus:bg-white/10 focus:text-white cursor-pointer px-4 text-base sm:text-sm py-3 sm:py-1"
                          >
                            <div className="flex items-center gap-3">
                              <ShieldCheck className="h-5 w-5 sm:h-4 sm:w-4 text-emerald-400" />
                              真實交易 (Real)
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <DialogFooter className="pt-4 pb-2">
                      <button
                        type="submit"
                        className="glass-button w-full h-[52px] sm:h-auto justify-center bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 py-0 sm:py-6 text-[17px] font-bold transition-all shadow-[0_0_20px_rgba(16,185,129,0.1)] rounded-xl"
                      >
                        建立交易日誌檔案
                      </button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>

              <InteractiveButton
                onClick={handleImportLatestPrices}
                disabled={isImportingPrices || !user}
                noGlow
                as="button"
                className={`h-[36px] sm:h-8 w-full sm:w-auto sm:min-w-[100px] px-2 sm:px-3 flex items-center justify-center text-white/90 text-xs sm:text-[11px] font-semibold transition-all hover:text-white hover:bg-white/5 border border-white/10 sm:border-white/10 rounded-lg sm:rounded bg-white/[0.02] sm:bg-transparent ${!user || isImportingPrices ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <span>匯入最新現價</span>
              </InteractiveButton>

              <InteractiveButton
                onClick={handleExportLocal}
                disabled={isExporting || !user}
                noGlow
                as="button"
                className={`h-[36px] sm:h-8 w-full sm:w-auto sm:min-w-[100px] px-2 sm:px-3 flex items-center justify-center text-white/90 text-xs sm:text-[11px] font-semibold transition-all hover:text-white hover:bg-white/5 border border-white/10 sm:border-white/10 rounded-lg sm:rounded bg-white/[0.02] sm:bg-transparent ${!user || isExporting ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <span>備份至本機</span>
              </InteractiveButton>

              <InteractiveButton
                onClick={() => fileInputRef.current?.click()}
                disabled={isImporting || !user}
                noGlow
                as="button"
                className={`h-[36px] sm:h-8 w-full sm:w-auto sm:min-w-[100px] px-2 flex items-center justify-center text-white/90 text-xs sm:text-[11px] font-semibold transition-all hover:text-white hover:bg-white/5 border border-white/10 sm:border-white/10 rounded-lg sm:rounded bg-white/[0.02] sm:bg-transparent ${!user || isImporting ? "opacity-50 cursor-not-allowed pointer-events-none" : ""}`}
              >
                <span>清空與還原</span>
              </InteractiveButton>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={handleImportLocal}
                disabled={isImporting || !user}
              />
            </div>
          </div>
        </div>
      </ScrollIn>

      {/* Top Metrics Row - Hover Expandable */}
      <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3 mt-2 sm:mt-4">
        {[
          {
            title: "總持股數",
            rawValue: activeTabs.length,
            prefix: "",
            suffix: "",
            decimals: 0,
            icon: Activity,
            color: "red",
            sub: `${activeTabs.length} 持有中, ${completedTabs.length} 已完成`,
            showPlus: false,
            badge: undefined as number | undefined,
          },
          {
            title: "總實現損益",
            rawValue: totalCompletedPnL,
            prefix: "$",
            suffix: "",
            decimals: 1,
            icon: TrendingUp,
            color: "emerald",
            sub: `↗ ${realCompletedTabs.length} 檔已結清`,
            pnl: totalCompletedPnL,
            showPlus: true,
          },
          {
            title: "模擬實現損益",
            rawValue: simulatedCompletedPnL,
            prefix: "$",
            suffix: "",
            decimals: 1,
            icon: Gamepad2,
            color: "amber",
            sub: "🎮 模擬模式績效記錄",
            pnl: simulatedCompletedPnL,
            showPlus: true,
          },
          {
            title: "真實交易勝率",
            rawValue: realWinRate,
            prefix: "",
            suffix: "%",
            decimals: 0,
            icon: Target,
            color: "emerald",
            sub: `共 ${realCompletedTabs.length} 筆真實交易`,
            progress: realWinRate,
            showPlus: false,
          },
          {
            title: "模擬交易勝率",
            rawValue: simulatedWinRate,
            prefix: "",
            suffix: "%",
            decimals: 0,
            icon: Gamepad2,
            color: "amber",
            sub: `共 ${simulatedCompletedTabs.length} 筆模擬交易`,
            progress: simulatedWinRate,
            showPlus: false,
          },
        ].map((metric: any, i) => (
          <ScrollIn key={i} delay={i * 0.1}>
            <motion.div
              whileHover="hover"
              initial="rest"
              variants={cardVariants}
              className="glass-card relative group z-10 transition-all duration-300"
            >
              {metric.badge !== undefined && metric.badge > 0 && (
                <div className="absolute -top-2 -right-2 w-5 h-5 sm:w-6 sm:h-6 bg-red-500/90 text-white rounded-full flex items-center justify-center font-bold text-[10px] sm:text-xs border border-white/20 shadow-[0_0_15px_rgba(239,68,68,0.5)] z-30">
                  {metric.badge}
                </div>
              )}
              <div className="p-3 sm:p-4 flex justify-between items-center cursor-default">
                <div className="flex flex-col min-w-0">
                  <span className="text-[10px] font-medium tracking-wide text-white/50 uppercase truncate leading-none">
                    {metric.title}
                  </span>
                  <div
                    className={`text-lg sm:text-xl lg:text-lg xl:text-xl 2xl:text-2xl font-black tracking-tighter mt-[6px] leading-none ${metric.pnl !== undefined ? (metric.pnl >= 0 ? "text-emerald-400 color-glow-emerald" : "text-red-400 color-glow-red") : "text-white"} truncate`}
                    title={`${metric.showPlus && metric.rawValue > 0 ? "+" : ""}${metric.prefix}${metric.rawValue.toLocaleString(undefined, { minimumFractionDigits: metric.decimals, maximumFractionDigits: metric.decimals })}${metric.suffix}`}
                  >
                    <AnimatedNumber
                      value={metric.rawValue}
                      prefix={metric.prefix}
                      suffix={metric.suffix}
                      decimals={metric.decimals}
                      showPlus={metric.showPlus}
                    />
                  </div>
                </div>
              </div>
              <div className="grid grid-rows-[0fr] group-hover:grid-rows-[1fr] transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]">
                <div className="overflow-hidden px-3 sm:px-4">
                  <div className="pb-3 md:pb-4 border-t border-white/10 pt-2 md:pt-3">
                    {metric.progress !== undefined ? (
                      <>
                        <div className="w-full bg-white/5 rounded-full h-1 sm:h-1.5 border border-white/5 overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            whileInView={{ width: `${metric.progress}%` }}
                            transition={{ duration: 1, ease: "easeOut" }}
                            className="bg-gradient-to-r from-red-500 to-amber-500 h-full rounded-full"
                          ></motion.div>
                        </div>
                        <p className="text-[9px] sm:text-[10px] font-medium text-white/40 mt-1.5 md:mt-2 tracking-wide truncate">
                          {metric.sub}
                        </p>
                      </>
                    ) : (
                      <p className="text-[9px] sm:text-[10px] font-medium text-white/40 tracking-wide truncate">
                        {metric.sub}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          </ScrollIn>
        ))}
      </div>

      {/* Main Panels - Tabs */}
      <div className="flex flex-row snap-x flex-nowrap w-full gap-2 sm:gap-3 border-b border-white/10 mb-4 sm:mb-6 mt-4 sm:mt-5 overflow-x-auto pt-2 pb-px scrollbar-hide">
        <button
          onClick={() => setActiveViewTab("active")}
          className={`h-[48px] snap-start flex-shrink-0 flex items-center justify-center gap-2 px-5 sm:px-6 py-3 font-bold text-base tracking-wide rounded-t-xl transition-all duration-300 relative overflow-hidden ${
            activeViewTab === "active"
              ? "bg-emerald-500/10 text-emerald-400 border border-t-emerald-500/30 border-x-emerald-500/30 border-b-transparent shadow-[0_-10px_20px_rgba(16,185,129,0.05)]"
              : "bg-transparent text-white/50 hover:bg-white/5 hover:text-white/80 border border-transparent"
          }`}
        >
          {activeViewTab === "active" && (
            <motion.div
              layoutId="tab-indicator-active"
              className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-400"
            />
          )}
          <Activity
            className={`w-5 h-5 ${activeViewTab === "active" ? "text-emerald-400" : "opacity-70"}`}
          />
          持有中 (<AnimatedNumber value={visibleActiveTabs.length} />)
        </button>
        <button
          onClick={() => setActiveViewTab("completed")}
          className={`h-[48px] snap-start flex-shrink-0 flex items-center justify-center gap-2 px-5 sm:px-6 py-3 font-bold text-base tracking-wide rounded-t-xl transition-all duration-300 relative overflow-hidden ${
            activeViewTab === "completed"
              ? "bg-blue-500/10 text-blue-400 border border-t-blue-500/30 border-x-blue-500/30 border-b-transparent shadow-[0_-10px_20px_rgba(59,130,246,0.05)]"
              : "bg-transparent text-white/50 hover:bg-white/5 hover:text-white/80 border border-transparent"
          }`}
        >
          {activeViewTab === "completed" && (
            <motion.div
              layoutId="tab-indicator-completed"
              className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-400"
            />
          )}
          <TrendingUp
            className={`w-5 h-5 ${activeViewTab === "completed" ? "text-blue-400" : "opacity-70"}`}
          />
          已完成 (<AnimatedNumber value={completedTabs.length} />)
        </button>
        <button
          onClick={() => setActiveViewTab("socrates")}
          className={`h-[48px] snap-start flex-shrink-0 flex items-center justify-center gap-2 px-5 sm:px-6 py-3 font-bold text-base tracking-wide rounded-t-xl transition-all duration-300 relative overflow-hidden ${
            activeViewTab === "socrates"
              ? "bg-purple-500/10 text-purple-400 border border-t-purple-500/30 border-x-purple-500/30 border-b-transparent shadow-[0_-10px_20px_rgba(168,85,247,0.05)]"
              : "bg-transparent text-white/50 hover:bg-white/5 hover:text-white/80 border border-transparent"
          }`}
        >
          {activeViewTab === "socrates" && (
            <motion.div
              layoutId="tab-indicator-socrates"
              className="absolute bottom-0 left-0 right-0 h-0.5 bg-purple-400"
            />
          )}
          <Search
            className={`w-5 h-5 ${activeViewTab === "socrates" ? "text-purple-400" : "opacity-70"}`}
          />
          Socrates篩選榜
        </button>
      </div>

      <div className="space-y-6">
        {/* Search Dialog */}
        <Dialog open={isSearchOpen} onOpenChange={setIsSearchOpen}>
          <DialogContent className="glass-panel border-white/10 shadow-2xl bg-slate-900/90 backdrop-blur-3xl text-white max-w-sm">
            <DialogHeader>
              <DialogTitle className="font-bold text-xl text-white flex items-center gap-2">
                <Search className="h-5 w-5 text-emerald-400" />
                快速搜尋個股
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <Input
                autoFocus
                placeholder="輸入代號或名稱..."
                className="bg-white/5 border-white/10 text-white"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const filtered = tabs.filter(
                      (t) =>
                        t.status === "ACTIVE" &&
                        (t.symbol
                          .toLowerCase()
                          .includes(searchQuery.toLowerCase()) ||
                          t.companyName
                            ?.toLowerCase()
                            .includes(searchQuery.toLowerCase())),
                    );
                    if (filtered.length > 0) {
                      handleSearchSelect(filtered[0].id);
                    }
                  }
                }}
              />
              <div className="max-h-[300px] overflow-y-auto space-y-1 pr-1 scrollbar-hide">
                {tabs
                  .filter(
                    (t) =>
                      t.status === "ACTIVE" &&
                      (t.symbol
                        .toLowerCase()
                        .includes(searchQuery.toLowerCase()) ||
                        t.companyName
                          ?.toLowerCase()
                          .includes(searchQuery.toLowerCase())),
                  )
                  .map((t) => (
                    <button
                      key={t.id}
                      onClick={() => handleSearchSelect(t.id)}
                      className="w-full flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 border border-transparent hover:border-white/10 transition-all text-left group"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 flex items-center justify-center font-bold text-xs rounded bg-white/10 text-white">
                          {t.symbol.slice(0, 2)}
                        </div>
                        <div>
                          <p className="font-bold text-sm text-white group-hover:text-emerald-400 transition-colors">
                            {t.symbol}
                          </p>
                          <p className="text-[10px] text-white/40 truncate max-w-[150px]">
                            {t.companyName}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-bold text-white/60">
                          ${t.currentPrice?.toLocaleString()}
                        </p>
                      </div>
                    </button>
                  ))}
                {tabs.filter((t) => t.status === "ACTIVE").length === 0 && (
                  <p className="text-center py-8 text-white/30 text-sm italic">
                    尚無持有中的個股
                  </p>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Card Action Choice Dialog */}
        <Dialog open={isActionDialogOpen} onOpenChange={setIsActionDialogOpen}>
          <DialogContent className="glass-panel border-white/10 shadow-2xl bg-[#0F0F12]/95 backdrop-blur-3xl text-white max-w-[320px] p-6 rounded-2xl border border-white/10">
            <DialogHeader className="mb-4">
              <DialogTitle className="font-black text-xl text-white flex items-center justify-center gap-2">
                {selectedActionTab?.symbol} 操作
              </DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-1 gap-3">
              <button
                onClick={() => {
                  if (selectedActionTab) {
                    navigate(`/stock/${selectedActionTab.id}`);
                    setIsActionDialogOpen(false);
                  }
                }}
                className="w-full py-4 px-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl flex items-center justify-between transition-all group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <ExternalLink className="w-5 h-5 text-blue-400" />
                  </div>
                  <div className="text-left">
                    <p className="font-black text-sm text-white">檢視細節</p>
                    <p className="text-[10px] font-bold text-white/40">
                      進入個股詳情頁面
                    </p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-white/20 group-hover:text-blue-400 group-hover:translate-x-1 transition-all" />
              </button>

              <button
                onClick={() => {
                  if (selectedActionTab) {
                    handleToggleTabHighlight(
                      selectedActionTab.id,
                      selectedActionTab.isFavoriteHighlight,
                    );
                  }
                }}
                className={`w-full py-4 px-4 border rounded-xl flex items-center justify-between transition-all group ${
                  selectedActionTab?.isFavoriteHighlight
                    ? "bg-[#B1C28D]/10 border-[#B1C28D]/30 hover:bg-[#B1C28D]/20"
                    : "bg-white/5 border-white/10 hover:bg-white/10"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform ${
                      selectedActionTab?.isFavoriteHighlight
                        ? "bg-[#B1C28D]/20"
                        : "bg-amber-500/20"
                    }`}
                  >
                    <Star
                      className={`w-5 h-5 ${selectedActionTab?.isFavoriteHighlight ? "text-[#B1C28D] fill-[#B1C28D]/50" : "text-amber-400"}`}
                    />
                  </div>
                  <div className="text-left">
                    <p className="font-black text-sm text-white">
                      {selectedActionTab?.isFavoriteHighlight
                        ? "取消重點"
                        : "重點關注"}
                    </p>
                    <p className="text-[10px] font-bold text-white/40">
                      切換首頁卡片高亮狀態
                    </p>
                  </div>
                </div>
                <ChevronRight
                  className={`w-4 h-4 transition-all group-hover:translate-x-1 ${
                    selectedActionTab?.isFavoriteHighlight
                      ? "text-[#B1C28D]"
                      : "text-white/20 group-hover:text-amber-400"
                  }`}
                />
              </button>

              <button
                onClick={() => {
                  if (selectedActionTab) {
                    updateTab(selectedActionTab.id, {
                      isOperationConfirmed:
                        !selectedActionTab.isOperationConfirmed,
                    });
                    setIsActionDialogOpen(false);
                  }
                }}
                className={`w-full py-4 px-4 border rounded-xl flex items-center justify-between transition-all group ${
                  selectedActionTab?.isOperationConfirmed
                    ? "bg-[#A3A3A3]/20 border-[#A3A3A3]/50 hover:bg-[#A3A3A3]/30"
                    : "bg-white/5 border-white/10 hover:bg-white/10"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform ${
                      selectedActionTab?.isOperationConfirmed
                        ? "bg-[#A3A3A3]/30"
                        : "bg-emerald-500/20"
                    }`}
                  >
                    <CheckCircle2
                      className={`w-5 h-5 ${selectedActionTab?.isOperationConfirmed ? "text-white" : "text-emerald-400"}`}
                    />
                  </div>
                  <div className="text-left">
                    <p className="font-black text-sm text-white">操作確認</p>
                    <p className="text-[10px] font-bold text-white/40">
                      切換首頁卡片顏色
                    </p>
                  </div>
                </div>
                <ChevronRight
                  className={`w-4 h-4 transition-all group-hover:translate-x-1 ${
                    selectedActionTab?.isOperationConfirmed
                      ? "text-white"
                      : "text-white/20 group-hover:text-emerald-400"
                  }`}
                />
              </button>

              <button
                onClick={() => {
                  if (selectedActionTab) {
                    updateTab(selectedActionTab.id, {
                      isDeviationConfirmed:
                        !selectedActionTab.isDeviationConfirmed,
                    });
                    setIsActionDialogOpen(false);
                  }
                }}
                className={`w-full py-4 px-4 border rounded-xl flex items-center justify-between transition-all group ${
                  selectedActionTab?.isDeviationConfirmed
                    ? "bg-[#F0D1B9]/20 border-[#F0D1B9]/50 hover:bg-[#F0D1B9]/30"
                    : "bg-white/5 border-white/10 hover:bg-white/10"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform ${
                      selectedActionTab?.isDeviationConfirmed
                        ? "bg-[#F0D1B9]/30"
                        : "bg-[#F0D1B9]/10"
                    }`}
                  >
                    <Star
                      className={`w-5 h-5 ${selectedActionTab?.isDeviationConfirmed ? "text-[#F0D1B9]" : "text-[#F0D1B9]/70"}`}
                    />
                  </div>
                  <div className="text-left">
                    <p className="font-black text-sm text-white">乖離確認</p>
                    <p className="text-[10px] font-bold text-white/40">
                      更改卡片標題背景顏色
                    </p>
                  </div>
                </div>
                <ChevronRight
                  className={`w-4 h-4 transition-all group-hover:translate-x-1 ${
                    selectedActionTab?.isDeviationConfirmed
                      ? "text-[#F0D1B9]"
                      : "text-white/20 group-hover:text-[#F0D1B9]/70"
                  }`}
                />
              </button>

              <button
                onClick={() => {
                  if (selectedActionTab) {
                    setFlippedCards((prev) => ({
                      ...prev,
                      [selectedActionTab.id]: !prev[selectedActionTab.id],
                    }));
                    setIsActionDialogOpen(false);
                  }
                }}
                className="w-full py-4 px-4 border rounded-xl flex items-center justify-between transition-all group bg-white/5 border-white/10 hover:bg-white/10"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform bg-purple-500/20">
                    <Activity className="w-5 h-5 text-purple-400" />
                  </div>
                  <div className="text-left">
                    <p className="font-black text-sm text-white">數據圖視化</p>
                    <p className="text-[10px] font-bold text-white/40">
                      翻轉卡片檢視分批圖表
                    </p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-white/20 transition-all group-hover:translate-x-1 group-hover:text-purple-400" />
              </button>

              <button
                onClick={() => {
                  if (selectedActionTab && !isGeneratingSuggestion) {
                    handleSmartSuggestion(selectedActionTab);
                  }
                }}
                disabled={isGeneratingSuggestion}
                className="w-full py-4 px-4 border rounded-xl flex items-center justify-between transition-all group bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform bg-emerald-500/20">
                    <Sparkles className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div className="text-left">
                    <p className="font-black text-sm text-emerald-400">
                      {isGeneratingSuggestion ? "分析中..." : "AI 智能建議"}
                    </p>
                    <p className="text-[10px] font-bold text-emerald-400/60">
                      動態取得操作備註分析並更新策略
                    </p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-emerald-400/50 transition-all group-hover:translate-x-1 group-hover:text-emerald-400" />
              </button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Keyboard Shortcuts Help Dialog */}
        <Dialog open={isHelpOpen} onOpenChange={setIsHelpOpen}>
          <DialogContent className="border border-white/10 bg-[#0F0F12]/95 backdrop-blur-2xl text-white max-w-md">
            <DialogHeader>
              <DialogTitle className="text-xl font-black tracking-tight flex items-center gap-2">
                <HelpCircle className="w-5 h-5 text-emerald-400" />
                快捷鍵指南
              </DialogTitle>
              <DialogDescription className="text-white/40 font-medium">
                使用以下快捷鍵更快速地操作系統
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: "Shift + F", desc: "快速搜尋股票" },
                  { key: "Shift + H", desc: "切換全螢幕模式" },
                  { key: "Shift + 1", desc: "切換至 持有中 標籤" },
                  { key: "Shift + 3", desc: "切換至 已完成 標籤" },
                  { key: "Shift + 4", desc: "切換至 Socrates 篩選" },
                  { key: "Alt + 1", desc: "切換至 觀察中" },
                  { key: "Alt + 2", desc: "切換至 候選名單" },
                  { key: "Alt + 3", desc: "切換至 買進操作" },
                  { key: "Alt + 4", desc: "切換至 賣出操作" },
                  { key: "Alt + 5", desc: "切換至 平倉操作" },
                  { key: "Alt + 6", desc: "切換至 乖離名單" },
                  { key: "Alt + Z", desc: "翻面可見股票卡片" },
                  { key: "Shift + A", desc: "開啟 新增股票 對話框" },
                  { key: "Shift + I", desc: "匯入現價 / AI 智能建議 (詳情頁)" },
                  { key: "Shift + S", desc: "儲存策略 (詳情頁)" },
                  { key: "Shift + B", desc: "從詳情頁面 返回主頁" },
                ].map((item, i) => (
                  <div
                    key={i}
                    className="bg-white/5 border border-white/5 rounded-lg p-3 flex flex-col gap-1"
                  >
                    <span className="text-[10px] font-black text-emerald-400 tracking-wider uppercase">
                      {item.key}
                    </span>
                    <span className="text-xs font-bold text-white/70">
                      {item.desc}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => setIsHelpOpen(false)}
                className="w-full bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl"
              >
                了解
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {activeViewTab === "active" && (
          <div id="active-cards-section" className="grid grid-cols-1 gap-6">
            <div className="space-y-4">
              <ScrollIn delay={0.2} translateY={20}>
                <div className="w-screen relative left-1/2 -translate-x-1/2 border-y border-emerald-500/10 bg-emerald-500/[0.01] flex flex-col group transition-all duration-500">
                  <div className="py-2 border-b border-emerald-500/10 w-full">
                    <div className="max-w-6xl mx-auto px-4 flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-1.5 h-6 bg-gradient-to-b from-emerald-400 to-emerald-600 rounded-full shadow-[0_0_10px_rgba(16,185,129,0.5)]"></div>
                        <div className="flex bg-black/40 p-1 rounded-lg">
                          {(
                            [
                              "觀察中",
                              "候選名單",
                              "買進操作",
                              "賣出操作",
                              "平倉操作",
                              "乖離名單",
                            ] as const
                          ).map((tab) => (
                            <button
                              key={tab}
                              onClick={() => setActiveHoldingSubTab(tab as any)}
                              className={`px-4 py-1.5 text-sm font-bold rounded-md transition-all flex items-center gap-2 ${
                                activeHoldingSubTab === tab
                                  ? "bg-emerald-500/20 text-emerald-400"
                                  : "text-white/50 hover:text-white/80 hover:bg-white/5"
                              }`}
                            >
                              {tab}
                              <span className="text-[10px] opacity-70 border px-1.5 py-0.5 rounded-full border-current">
                                <AnimatedNumber
                                  value={
                                    visibleActiveTabs.filter(
                                      (t) =>
                                        getDisplayHoldingStatus(
                                          t.holdingStatus,
                                        ) === tab,
                                    ).length
                                  }
                                />{" "}
                                檔
                              </span>
                            </button>
                          ))}
                        </div>
                        {hiddenActiveTabs.length > 0 && (
                          <span className="text-xs font-bold border border-white/20 bg-white/10 text-white/50 px-2.5 py-1 rounded-full">
                            已隱藏 {hiddenActiveTabs.length} 檔
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Dialog
                          open={isManageHiddenOpen}
                          onOpenChange={(open) => {
                            setIsManageHiddenOpen(open);
                            if (!open) setConfirmDeleteId(null);
                          }}
                        >
                          <DialogTrigger
                            render={
                              <InteractiveButton
                                noGlow
                                as="button"
                                className="p-2 bg-white/5 border border-white/10 text-white/60 hover:text-white rounded-md transition-all"
                              >
                                <Settings2 className="w-4 h-4" />
                              </InteractiveButton>
                            }
                          />
                          <DialogContent className="glass-panel border-white/10 shadow-2xl bg-slate-900/90 backdrop-blur-3xl text-white outline-none sm:max-w-xl max-h-[80vh] overflow-y-auto w-11/12 max-w-lg fixed top-[50%] left-[50%] translate-x-[-50%] translate-y-[-50%] !rounded-2xl z-50">
                            <DialogHeader>
                              <DialogTitle className="font-bold text-xl">
                                管理持有中股票
                              </DialogTitle>
                            </DialogHeader>
                            <div className="space-y-6 py-4">
                              <div className="flex bg-black/40 p-1 rounded-lg w-full overflow-x-auto scrollbar-hide mb-2 border border-white/5">
                                {(
                                  [
                                    "觀察中",
                                    "候選名單",
                                    "買進操作",
                                    "賣出操作",
                                    "平倉操作",
                                    "乖離名單",
                                  ] as const
                                ).map((tab) => (
                                  <button
                                    key={tab}
                                    onClick={() => setActiveManageTab(tab)}
                                    className={`flex-shrink-0 px-4 py-1.5 text-sm font-bold rounded-md transition-all flex items-center gap-2 ${
                                      activeManageTab === tab
                                        ? "bg-emerald-500/20 text-emerald-400"
                                        : "text-white/50 hover:text-white/80 hover:bg-white/5"
                                    }`}
                                  >
                                    {tab}
                                  </button>
                                ))}
                              </div>
                              <div className="space-y-3">
                                {(() => {
                                  const categoryTabs = activeTabs.filter(
                                    (t) => getDisplayHoldingStatus(t.holdingStatus) === activeManageTab
                                  );
                                  if (categoryTabs.length === 0) {
                                    return <div className="text-center text-white/40 py-8 text-sm">此分類下沒有持有中股票</div>;
                                  }
                                  return categoryTabs.map((tab) => {
                                      const idx = activeTabs.findIndex(t => t.id === tab.id);
                                      return (
                                        <div
                                          className="flex flex-col gap-3 p-3 rounded-lg border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] transition-colors relative overflow-hidden"
                                          key={tab.id}
                                        >
                                          <div className="flex items-center justify-between z-10 w-full relative">
                                    <div className="flex items-center gap-3">
                                      <span
                                        className={`font-bold ${tab.isHidden ? "text-white/40 line-through" : "text-white"}`}
                                      >
                                        {tab.symbol}
                                      </span>
                                      {tab.tradeType === "simulated" ? (
                                        <Badge className="bg-amber-500/20 text-amber-500">
                                          模擬
                                        </Badge>
                                      ) : (
                                        <Badge className="bg-emerald-500/20 text-emerald-500">
                                          真實
                                        </Badge>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <button
                                        onClick={() => moveTabUp(idx)}
                                        disabled={idx === 0}
                                        className="p-1.5 rounded bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                        title="往上移"
                                      >
                                        <ArrowUp className="w-4 h-4 text-white/70" />
                                      </button>
                                      <button
                                        onClick={() => moveTabDown(idx)}
                                        disabled={idx === activeTabs.length - 1}
                                        className="p-1.5 rounded bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                        title="往下移"
                                      >
                                        <ArrowDown className="w-4 h-4 text-white/70" />
                                      </button>
                                    </div>
                                  </div>
                                  <div className="grid grid-cols-3 gap-2 mt-1">
                                    {(
                                      [
                                        "觀察中",
                                        "候選名單",
                                        "買進操作",
                                        "賣出操作",
                                        "平倉操作",
                                        "乖離名單",
                                      ] as const
                                    ).map((cat) => (
                                      <button
                                        key={cat}
                                        onClick={() =>
                                          updateTab(tab.id, {
                                            holdingStatus: cat,
                                          })
                                        }
                                        className={`flex-1 py-1.5 rounded text-xs font-bold transition-all ${
                                          getDisplayHoldingStatus(
                                            tab.holdingStatus,
                                          ) === cat
                                            ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                                            : "bg-white/5 text-white/50 hover:bg-white/10 border border-transparent"
                                        }`}
                                      >
                                        {cat}
                                      </button>
                                    ))}
                                  </div>
                                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mt-2 w-full relative">
                                    <button
                                      onClick={() =>
                                        updateTabHidden(tab.id, !tab.isHidden)
                                      }
                                      className={`flex-1 h-[48px] sm:h-[44px] rounded-lg sm:rounded-md border transition-all flex flex-row items-center justify-center gap-2 font-bold text-base sm:text-sm ${tab.isHidden ? "bg-white/10 border-white/20 text-white hover:bg-white/20" : "bg-amber-500/10 border-amber-500/20 text-amber-500 hover:bg-amber-500/20"}`}
                                    >
                                      {tab.isHidden ? (
                                        <EyeOff className="w-5 h-5 sm:w-4 sm:h-4 opacity-50" />
                                      ) : (
                                        <Eye className="w-5 h-5 sm:w-4 sm:h-4" />
                                      )}
                                      {tab.isHidden ? "取消隱藏" : "隱藏"}
                                    </button>

                                    <button
                                      onClick={() => toggleTabGroup(tab)}
                                      className={`flex-1 h-[48px] sm:h-[44px] rounded-lg sm:rounded-md border transition-all flex flex-row items-center justify-center gap-2 font-bold text-base sm:text-sm ${tab.groupId ? "bg-purple-500/20 border-purple-500/30 text-purple-400 hover:bg-purple-500/30" : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10"}`}
                                    >
                                      <Link className="w-5 h-5 sm:w-4 sm:h-4" />
                                      {tab.groupId ? "解除區塊" : "區塊"}
                                    </button>

                                    {confirmDeleteId === tab.id ? (
                                      <div className="absolute right-0 top-0 bottom-0 bg-slate-900 border border-slate-700 flex flex-col sm:flex-row items-stretch sm:items-center justify-end w-full rounded-lg sm:rounded-md px-1 py-1 sm:py-0 z-10 gap-2">
                                        <span className="text-white/70 text-sm font-medium mr-auto ml-3 hidden sm:inline">
                                          確定刪除?
                                        </span>
                                        <div className="flex gap-2 h-full w-full sm:w-auto">
                                          <button
                                            onClick={() =>
                                              setConfirmDeleteId(null)
                                            }
                                            className="flex-1 sm:flex-none p-2 px-3 h-full sm:h-[36px] rounded bg-white/10 text-white hover:bg-white/20 text-base sm:text-sm font-bold"
                                          >
                                            取消
                                          </button>
                                          <button
                                            onClick={() => {
                                              deleteTab(tab.id);
                                              setConfirmDeleteId(null);
                                            }}
                                            className="flex-1 sm:flex-none p-2 px-3 h-full sm:h-[36px] rounded bg-red-600 text-white hover:bg-red-700 text-base sm:text-sm font-bold"
                                          >
                                            確認刪除
                                          </button>
                                        </div>
                                      </div>
                                    ) : groupingTabId === tab.id ? (
                                      <div className="absolute right-0 top-0 bottom-0 bg-slate-900/95 border border-purple-500/50 shadow-xl flex flex-col items-center justify-center w-full rounded-lg px-2 py-2 z-10 gap-2 backdrop-blur-xl">
                                        <div className="text-white text-xs font-bold w-full text-center">選擇要連動的股票 (同一代號)</div>
                                        <div className="flex flex-wrap gap-2 w-full items-center justify-center">
                                           {activeTabs.filter(t => t.symbol === tab.symbol && t.id !== tab.id).length === 0 ? (
                                              <span className="text-red-400 text-xs">無其他相同代號的持有中股票</span>
                                           ) : (
                                              activeTabs.filter(t => t.symbol === tab.symbol && t.id !== tab.id).map(target => (
                                                 <button 
                                                    key={target.id}
                                                    onClick={(e) => { e.stopPropagation(); handleGroupWith(tab.id, target); }}
                                                    className={`px-3 py-1.5 border rounded-md text-xs font-bold transition-colors ${target.groupId ? "bg-purple-500/10 border-purple-500/30 text-purple-400" : "bg-white/10 hover:bg-white/20 border-white/20 text-white"}`}
                                                 >
                                                    {target.holdingStatus || '未分類'}
                                                 </button>
                                              ))
                                           )}
                                        </div>
                                        <button 
                                          onClick={() => setGroupingTabId(null)}
                                          className="absolute right-2 top-2 p-1 text-white/40 hover:text-white bg-white/5 hover:bg-white/10 rounded"
                                        >
                                          取消
                                        </button>
                                      </div>
                                    ) : (
                                      <button
                                        onClick={() =>
                                          setConfirmDeleteId(tab.id)
                                        }
                                        className="flex-1 h-[48px] sm:h-[44px] rounded-lg sm:rounded-md border transition-all bg-transparent sm:bg-red-500/5 border-red-500/20 text-red-500 hover:bg-red-500/10 flex flex-row items-center justify-center gap-2 font-bold text-base sm:text-sm"
                                      >
                                        <Trash2 className="w-5 h-5 sm:w-4 sm:h-4" />
                                        刪除
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            });
                          })()}
                          </div>
                              {activeTabs.length === 0 && (
                                <div className="text-white/50 text-center py-4">
                                  目前無持有中股票
                                </div>
                              )}
                            </div>
                          </DialogContent>
                        </Dialog>
                        <Magnetic>
                          <Activity className="h-6 w-6 text-emerald-500 opacity-80" />
                        </Magnetic>
                      </div>
                    </div>
                  </div>
                  <div className="bg-transparent w-full">
                    <div className="overflow-hidden w-full">
                      <div className="pt-0 pb-4 sm:pt-0 sm:pb-6 min-h-[200px] w-full">
                        <AnimatePresence mode="wait">
                          {currentSubTabVisibleTabs.length === 0 ? (
                            <motion.div
                              initial={{ opacity: 0, scale: 0.95 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.95 }}
                              className="h-full flex flex-col items-center justify-center text-white/30 py-16"
                            >
                              <div className="bg-white/5 p-5 border border-white/10 rounded-full mb-4">
                                <Activity className="h-10 w-10 opacity-40" />
                              </div>
                              <p className="text-base font-bold text-white/50 tracking-wide">
                                尚無可見的{activeHoldingSubTab}股票
                              </p>
                            </motion.div>
                          ) : (
                            <div
                              ref={carouselRef}
                              className="relative w-full overflow-x-auto snap-x snap-mandatory scrollbar-hide cursor-grab"
                              onMouseDown={onDragStart}
                            >
                              <div className="flex flex-nowrap gap-4 sm:gap-6 px-6 sm:px-[max(15%,calc((100vw-1152px)/2+16px))] pt-2 pb-4 w-max">
                                {renderGroups.map((group, groupIdx) => {
                                  const renderCard = (tab: any, idx: number) => {
                                    const plannedOrders =
                                    activeTabOrders[tab.id] || [];
                                  const trades = activeTabTrades[tab.id] || [];
                                  const stats = calculateStats(
                                    trades,
                                    tab.currentPrice,
                                  );
                                  const unrealizedPnL =
                                    stats.unrealizedPnL || 0;
                                  const pnlColor =
                                    unrealizedPnL > 0
                                      ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                                      : unrealizedPnL < 0
                                        ? "text-rose-400 bg-rose-500/10 border-rose-500/20"
                                        : "text-white/60 bg-white/5 border-white/10";

                                  let isBuyOperation = false;
                                  let tpMax = 0;
                                  let batchMax = 0;
                                  let batchMin = Infinity;

                                  plannedOrders.forEach((order) => {
                                    const fullText =
                                      `${order.category || ""} ${order.notes || ""} ${order.conditions || ""}`.trim();
                                    const isTP = fullText.includes("止盈");
                                    const isBatch =
                                      fullText.includes("分批") ||
                                      fullText.includes("分批進出場規劃");

                                    if (isBatch && order.direction === "BUY") {
                                      isBuyOperation = true;
                                    }

                                    const p = order.price || 0;
                                    if (p > 0) {
                                      if (isTP) {
                                        if (p > tpMax) tpMax = p;
                                      }
                                      if (isBatch) {
                                        if (p > batchMax) batchMax = p;
                                        if (p < batchMin) batchMin = p;
                                      }
                                    }
                                  });

                                  let shouldHighlightTitle = false;
                                  const currentP = tab.currentPrice || 0;
                                  if (isBuyOperation && currentP > 0) {
                                    if (tpMax > 0 && currentP > tpMax * 1.1) {
                                      shouldHighlightTitle = true;
                                    } else if (
                                      batchMax > 0 &&
                                      currentP > batchMax * 1.1
                                    ) {
                                      shouldHighlightTitle = true;
                                    } else if (
                                      batchMin !== Infinity &&
                                      batchMin > 0 &&
                                      currentP < batchMin * 0.9
                                    ) {
                                      shouldHighlightTitle = true;
                                    }
                                  }

                                  return (
                                    <div
                                      key={tab.id}
                                      id={`stock-card-${tab.id}`}
                                      className="card-wrapper shrink-0 w-[88vw] sm:w-[460px] snap-center transition-transform duration-500"
                                      onClickCapture={(e) => {
                                        if (
                                          dragRef.current
                                            .hasDraggedBeyondThreshold
                                        ) {
                                          e.preventDefault();
                                          e.stopPropagation();
                                        }
                                      }}
                                      onClick={(e) => {
                                        if (
                                          dragRef.current
                                            .hasDraggedBeyondThreshold
                                        ) {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          return;
                                        }
                                        setSelectedActionTab(tab);
                                        setIsActionDialogOpen(true);
                                      }}
                                    >
                                      <div
                                        className="card-inner-parallax"
                                        style={{ perspective: "1200px" }}
                                      >
                                        <motion.div
                                          layout
                                          initial={{ opacity: 0, y: 20 }}
                                          animate={{
                                            opacity: 1,
                                            y: 0,
                                            rotateY: flippedCards[tab.id]
                                              ? 180
                                              : 0,
                                          }}
                                          transition={{
                                            duration: 0.6,
                                            type: "spring",
                                            stiffness: 260,
                                            damping: 20,
                                            delay: idx * 0.05,
                                          }}
                                          key={tab.id}
                                          style={{
                                            transformStyle: "preserve-3d",
                                          }}
                                          className="relative w-full h-full cursor-pointer"
                                        >
                                          {/* Front Face */}
                                          <div
                                            style={{
                                              backfaceVisibility: "hidden",
                                              pointerEvents: flippedCards[
                                                tab.id
                                              ]
                                                ? "none"
                                                : "auto",
                                              opacity: flippedCards[tab.id]
                                                ? 0
                                                : 1,
                                              transition:
                                                "opacity 0.2s ease-in-out",
                                            }}
                                            className="glass-card flex flex-col p-3 group/item relative overflow-hidden w-full h-full"
                                          >
                                            {/* No spotlight or glow overlays */}
                                            <div
                                              className="flex items-start justify-between relative z-10 w-full overflow-hidden transition-colors duration-500 rounded-lg p-2 -mx-2 -mt-2"
                                              title={
                                                activeTabStrategies[tab.id]
                                                  ?.operationNote
                                                  ? `[執行操作備註]\n${activeTabStrategies[tab.id].operationNote}`
                                                  : undefined
                                              }
                                              style={{
                                                backgroundColor:
                                                  tab.isDeviationConfirmed
                                                    ? "#F0D1B9"
                                                    : tab.isOperationConfirmed
                                                      ? "#A3A3A3"
                                                      : tab.isFavoriteHighlight
                                                        ? "#B1C28D"
                                                        : shouldHighlightTitle
                                                          ? "#F5DAD5"
                                                          : "transparent",
                                              }}
                                            >
                                              <div className="flex items-start gap-4 w-full">
                                                <div className="flex flex-col w-full min-w-0">
                                                  {/* Row 1: Symbol & Name & Badge */}
                                                  <div className="flex items-baseline gap-2 mb-1">
                                                    <span
                                                      className={`font-black text-2xl tracking-tighter leading-none ${typeof tab.updatedAt?.toDate === 'function' && (new Date().getTime() - tab.updatedAt.toDate().getTime() > 17 * 60 * 60 * 1000) ? "text-red-500 animate-pulse font-bold" : tab.isDeviationConfirmed || tab.isOperationConfirmed || tab.isFavoriteHighlight || shouldHighlightTitle ? "text-[#0F0F0F]" : "text-white"}`}
                                                    >
                                                      {tab.symbol}
                                                    </span>
                                                    {tab.updatedAt && (
                                                      <span className={`text-[9px] tracking-widest ml-1 ${typeof tab.updatedAt.toDate === 'function' && (new Date().getTime() - tab.updatedAt.toDate().getTime() > 17 * 60 * 60 * 1000) ? "text-red-500 animate-pulse font-bold" : tab.isDeviationConfirmed || tab.isOperationConfirmed || tab.isFavoriteHighlight || shouldHighlightTitle ? "text-[#0F0F0F]/40" : "text-white/30"}`}>
                                                        {typeof tab.updatedAt.toDate === 'function' ? format(tab.updatedAt.toDate(), 'yyyy/MM/dd HH:mm') : ''}
                                                      </span>
                                                    )}
                                                    {tab.currentPrice !== undefined && (
                                                      <div className="flex items-baseline gap-2">
                                                        <span className={`text-lg font-black tabular-nums ${tab.isDeviationConfirmed || tab.isOperationConfirmed || tab.isFavoriteHighlight || shouldHighlightTitle ? "text-[#0F0F0F]" : "text-white"}`}>
                                                          ${tab.currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                        </span>
                                                        {unrealizedPnL !== 0 && (
                                                          <span className={`text-sm font-black tabular-nums ${unrealizedPnL > 0 ? "text-emerald-500" : "text-rose-500"}`}>
                                                            {unrealizedPnL > 0 ? "▲" : "▼"}{Math.abs(unrealizedPnL).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                          </span>
                                                        )}
                                                      </div>
                                                    )}
                                                    <div
                                                      className={`flex items-center gap-1 text-[9px] font-black px-1.5 py-0.5 rounded-full border uppercase tracking-widest ml-auto ${
                                                        tab.tradeType ===
                                                        "simulated"
                                                          ? "bg-amber-500/10 text-amber-500 border-amber-500/30"
                                                          : "bg-emerald-500/10 text-emerald-500 border-emerald-500/30"
                                                      }`}
                                                    >
                                                      {tab.tradeType ===
                                                      "simulated" ? (
                                                        <Gamepad2 className="h-2.5 w-2.5" />
                                                      ) : (
                                                        <ShieldCheck className="h-2.5 w-2.5" />
                                                      )}
                                                      {tab.tradeType ===
                                                      "simulated"
                                                        ? "SIM"
                                                        : "LIVE"}
                                                    </div>
                                                  </div>

                                                  {/* Row 2: Score & Sentiment Groups */}
                                                  <div className="flex flex-wrap items-center gap-2 mb-2">
                                                    <div
                                                      className={`flex items-center border rounded-md overflow-hidden h-5 ${tab.isOperationConfirmed || tab.isFavoriteHighlight || shouldHighlightTitle ? "border-black/10" : "border-white/10"}`}
                                                    >
                                                      <div
                                                        className={`px-1.5 h-full flex items-center border-r ${tab.isOperationConfirmed || tab.isFavoriteHighlight || shouldHighlightTitle ? "bg-black/5 border-black/10" : "bg-white/5 border-white/10"}`}
                                                      >
                                                        <span
                                                          className={`text-[10px] font-black ${tab.isOperationConfirmed || tab.isFavoriteHighlight || shouldHighlightTitle ? "text-amber-700" : "text-yellow-500"}`}
                                                        >
                                                          ★ {tab.rating || 8}
                                                        </span>
                                                      </div>
                                                      <div
                                                        className={`px-1.5 h-full flex items-center border-r ${tab.isOperationConfirmed || tab.isFavoriteHighlight || shouldHighlightTitle ? "bg-black/5 border-black/10" : "bg-white/5 border-white/10"}`}
                                                      >
                                                        <span
                                                          className={`text-[10px] font-black ${tab.isOperationConfirmed || tab.isFavoriteHighlight || shouldHighlightTitle ? "text-purple-700" : "text-purple-400"}`}
                                                        >
                                                          Q{" "}
                                                          {tab.qualityScore ||
                                                            5}
                                                        </span>
                                                      </div>
                                                      <div
                                                        className={`px-1.5 h-full flex items-center border-r ${tab.isOperationConfirmed || tab.isFavoriteHighlight || shouldHighlightTitle ? "bg-black/5 border-black/10" : "bg-white/5 border-white/10"}`}
                                                      >
                                                        <span
                                                          className={`text-[10px] font-black ${tab.isOperationConfirmed || tab.isFavoriteHighlight || shouldHighlightTitle ? "text-amber-700" : "text-amber-500"}`}
                                                        >
                                                          V{" "}
                                                          {tab.valueScore || 5}
                                                        </span>
                                                      </div>
                                                      <div
                                                        className={`px-1.5 h-full flex items-center bg-emerald-500/10 text-emerald-600`}
                                                      >
                                                        <span className="text-[10px] font-black">
                                                          B {tab.buyRate || 5}
                                                        </span>
                                                      </div>
                                                      <div
                                                        className={`px-1.5 h-full flex items-center bg-rose-500/10 text-rose-600`}
                                                      >
                                                        <span className="text-[10px] font-black">
                                                          S {tab.sellRate || 5}
                                                        </span>
                                                      </div>
                                                    </div>

                                                    <div
                                                      className={`flex items-center border rounded-md overflow-hidden h-5 ${tab.isOperationConfirmed || tab.isFavoriteHighlight || shouldHighlightTitle ? "border-black/10" : "border-white/10"}`}
                                                    >
                                                      <div
                                                        className={`px-1.5 h-full flex items-center border-r ${tab.isOperationConfirmed || tab.isFavoriteHighlight || shouldHighlightTitle ? "bg-black/5 border-black/10" : "bg-white/5 border-white/10"}`}
                                                      >
                                                        <span
                                                          className={`text-[10px] font-black ${tab.isOperationConfirmed || tab.isFavoriteHighlight || shouldHighlightTitle ? "text-indigo-700" : "text-indigo-400"}`}
                                                        >
                                                          🌊{" "}
                                                          {tab.volatility ||
                                                            "中"}
                                                        </span>
                                                      </div>
                                                      <div
                                                        className={`px-1.5 h-full flex items-center border-r ${tab.isOperationConfirmed || tab.isFavoriteHighlight || shouldHighlightTitle ? "bg-black/5 border-black/10" : "bg-white/5 border-white/10"}`}
                                                        title="Positive Value"
                                                      >
                                                        <span
                                                          className={`text-[10px] font-black ${tab.isOperationConfirmed || tab.isFavoriteHighlight || shouldHighlightTitle ? "text-emerald-700" : "text-emerald-400"}`}
                                                        >
                                                          P+{" "}
                                                          {calculatePositiveValue(Number(tab.rating||5), Number(tab.qualityScore||5), Number(tab.valueScore||5), Number(tab.buyRate||5))}
                                                        </span>
                                                      </div>
                                                      <div
                                                        className={`px-1.5 h-full flex items-center ${tab.isOperationConfirmed || tab.isFavoriteHighlight || shouldHighlightTitle ? "bg-black/5" : "bg-white/5"}`}
                                                        title="Negative Value"
                                                      >
                                                        <span
                                                          className={`text-[10px] font-black ${tab.isOperationConfirmed || tab.isFavoriteHighlight || shouldHighlightTitle ? "text-red-700" : "text-red-400"}`}
                                                        >
                                                          N-{" "}
                                                          {calculateNegativeValue(Number(tab.rating||5), Number(tab.qualityScore||5), Number(tab.valueScore||5), Number(tab.sellRate||5))}
                                                        </span>
                                                      </div>
                                                    </div>
                                                  </div>
                                                </div>
                                              </div>

                                              {/* Right side: Action Button */}
                                              <div className="flex flex-col items-end justify-center self-stretch ml-2">
                                                <div className={`${tab.groupId ? 'opacity-100 translate-x-0' : 'opacity-0 group-hover/item:opacity-100 translate-x-4 group-hover/item:translate-x-0'} transition-all duration-500 transform`}>
                                                  <button
                                                    className={`whitespace-nowrap text-sm font-black rounded-full px-5 py-2.5 hover:scale-105 active:scale-95 transition-all ${tab.isDeviationConfirmed || tab.isOperationConfirmed || tab.isFavoriteHighlight || shouldHighlightTitle ? "bg-[#0F0F12] text-white" : "bg-white text-black shadow-[0_0_20px_rgba(255,255,255,0.3)]"} ${tab.tradeDirection === '看跌' ? '!bg-red-500 !text-white' : tab.tradeDirection === '看漲' ? '!bg-emerald-500 !text-white' : ''}`}
                                                  >
                                                    {tab.tradeDirection ? `${tab.tradeDirection}操作` : "檢視細節"}
                                                  </button>
                                                </div>
                                              </div>
                                            </div>

                                            {plannedOrders.length > 0 && (
                                              <div className="mt-2 pt-2 border-t border-white/10 relative z-10">
                                                <p className="text-[12px] font-medium text-white/40 mb-[6px] tracking-wide uppercase">
                                                  預定訂單 (
                                                  {plannedOrders.length})
                                                </p>
                                                <div className="flex flex-col gap-1">
                                                  {Object.entries(
                                                    plannedOrders.reduce(
                                                      (
                                                        acc: Record<
                                                          string,
                                                          any[]
                                                        >,
                                                        order,
                                                      ) => {
                                                        const fullText =
                                                          `${order.notes || ""} ${order.conditions || ""}`.trim();
                                                        let category =
                                                          order.category ||
                                                          "其他";

                                                        if (
                                                          category === "其他" ||
                                                          !order.category ||
                                                          category ===
                                                            "關鍵價格門檻"
                                                        ) {
                                                          if (
                                                            fullText.includes(
                                                              "[支撐",
                                                            ) ||
                                                            fullText.includes(
                                                              "支撐門檻",
                                                            )
                                                          )
                                                            category =
                                                              "支撐門檻";
                                                          else if (
                                                            fullText.includes(
                                                              "[壓力",
                                                            ) ||
                                                            fullText.includes(
                                                              "壓力門檻",
                                                            )
                                                          )
                                                            category =
                                                              "壓力門檻";
                                                          else if (
                                                            fullText.includes(
                                                              "止損設定",
                                                            ) ||
                                                            fullText.includes(
                                                              "[止損",
                                                            )
                                                          )
                                                            category =
                                                              "止損設定";
                                                          else if (
                                                            fullText.includes(
                                                              "止盈設定",
                                                            ) ||
                                                            fullText.includes(
                                                              "[止盈",
                                                            )
                                                          )
                                                            category =
                                                              "止盈設定";
                                                          else if (
                                                            fullText.includes(
                                                              "分批進出場",
                                                            ) ||
                                                            fullText.includes(
                                                              "[分批",
                                                            )
                                                          )
                                                            category =
                                                              "分批進出場規劃";
                                                          // Fallbacks
                                                          else if (
                                                            fullText.includes(
                                                              "支撐",
                                                            )
                                                          )
                                                            category =
                                                              "支撐門檻";
                                                          else if (
                                                            fullText.includes(
                                                              "壓力",
                                                            )
                                                          )
                                                            category =
                                                              "壓力門檻";
                                                          else if (
                                                            fullText.includes(
                                                              "止損",
                                                            )
                                                          )
                                                            category =
                                                              "止損設定";
                                                          else if (
                                                            fullText.includes(
                                                              "止盈",
                                                            )
                                                          )
                                                            category =
                                                              "止盈設定";
                                                          else if (
                                                            fullText.includes(
                                                              "分批",
                                                            )
                                                          )
                                                            category =
                                                              "分批進出場規劃";
                                                        }

                                                        const displayCategory = `[${category}]`;

                                                        if (
                                                          !acc[displayCategory]
                                                        )
                                                          acc[displayCategory] =
                                                            [];
                                                        acc[
                                                          displayCategory
                                                        ].push(order);
                                                        return acc;
                                                      },
                                                      {},
                                                    ),
                                                  )
                                                    .sort(([a], [b]) => {
                                                      const order = [
                                                        "[止損設定]",
                                                        "[止盈設定]",
                                                        "[分批進出場規劃]",
                                                        "[支撐門檻]",
                                                        "[壓力門檻]",
                                                        "[其他]",
                                                      ];
                                                      const idxA =
                                                        order.indexOf(a);
                                                      const idxB =
                                                        order.indexOf(b);
                                                      if (
                                                        idxA !== -1 &&
                                                        idxB !== -1
                                                      )
                                                        return idxA - idxB;
                                                      if (idxA !== -1)
                                                        return -1;
                                                      if (idxB !== -1) return 1;
                                                      return a.localeCompare(b);
                                                    })
                                                    .map(
                                                      ([
                                                        category,
                                                        categoryOrders,
                                                      ]) => {
                                                        const categoryType =
                                                          category.replace(
                                                            /[\[\]]/g,
                                                            "",
                                                          );
                                                        return (
                                                          <div
                                                            key={category}
                                                            className="flex flex-col gap-1"
                                                          >
                                                            <div className="flex items-center gap-1.5 px-1 mb-1 mt-1.5">
                                                              <div
                                                                className={`h-1 w-1 rounded-full ${
                                                                  categoryType ===
                                                                  "止損設定"
                                                                    ? "bg-red-400"
                                                                    : categoryType ===
                                                                        "止盈設定"
                                                                      ? "bg-emerald-400"
                                                                      : categoryType ===
                                                                            "支撐門檻" ||
                                                                          categoryType ===
                                                                            "壓力門檻"
                                                                        ? "bg-amber-400"
                                                                        : "bg-blue-400"
                                                                }`}
                                                              ></div>
                                                              <span
                                                                className={`text-[11px] font-bold tracking-widest uppercase leading-none ${
                                                                  categoryType ===
                                                                  "止損設定"
                                                                    ? "text-red-400/80"
                                                                    : categoryType ===
                                                                        "止盈設定"
                                                                      ? "text-emerald-400/80"
                                                                      : categoryType ===
                                                                            "支撐門檻" ||
                                                                          categoryType ===
                                                                            "壓力門檻"
                                                                        ? "text-amber-400/80"
                                                                        : "text-white/40"
                                                                }`}
                                                              >
                                                                {category}
                                                              </span>
                                                            </div>
                                                            <div className="flex flex-wrap gap-1">
                                                              {(
                                                                categoryOrders as any[]
                                                              )
                                                                .sort(
                                                                  (a, b) =>
                                                                    (b.price ||
                                                                      0) -
                                                                    (a.price ||
                                                                      0),
                                                                )
                                                                .map(
                                                                  (order) => {
                                                                    const isStopLoss =
                                                                      categoryType ===
                                                                      "止損設定";
                                                                    const isKeyPrice =
                                                                      categoryType ===
                                                                        "支撐門檻" ||
                                                                      categoryType ===
                                                                        "壓力門檻";
                                                                    const keyLabel =
                                                                      isKeyPrice
                                                                        ? categoryType ===
                                                                          "支撐門檻"
                                                                          ? "支撐"
                                                                          : "壓力"
                                                                        : order.direction ===
                                                                            "BUY"
                                                                          ? "買入"
                                                                          : "賣出";

                                                                    const isAlertTriggered =
                                                                      order.price &&
                                                                      tab.currentPrice &&
                                                                      Math.abs(
                                                                        (tab.currentPrice -
                                                                          order.price) /
                                                                          order.price,
                                                                      ) <= 0.02;
                                                                    const isHighlighted =
                                                                      isAlertTriggered ||
                                                                      order.isManualHighlight;

                                                                    let colorClass =
                                                                      "";
                                                                    let borderClass =
                                                                      "border";
                                                                    let opacityClass =
                                                                      "opacity-70";
                                                                    let borderLClass =
                                                                      "border-white/10";

                                                                    if (
                                                                      isHighlighted
                                                                    ) {
                                                                      colorClass =
                                                                        "bg-[#ED8900] text-[#0F0F0F] border-transparent shadow-[0_0_15px_rgba(237,137,0,0.5)]";
                                                                      borderClass =
                                                                        "";
                                                                      opacityClass =
                                                                        "opacity-100 font-bold";
                                                                      borderLClass =
                                                                        "border-[#0F0F0F]/20";
                                                                    } else if (
                                                                      isStopLoss
                                                                    ) {
                                                                      colorClass =
                                                                        "border-[#D6B2AB]/20 text-[#D6B2AB] bg-[#D6B2AB]/5";
                                                                    } else if (
                                                                      isKeyPrice
                                                                    ) {
                                                                      colorClass =
                                                                        "bg-amber-500/5 border-amber-500/20 text-amber-400";
                                                                    } else {
                                                                      colorClass =
                                                                        order.direction ===
                                                                        "BUY"
                                                                          ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-400"
                                                                          : "bg-blue-500/5 border-blue-500/20 text-blue-400";
                                                                    }

                                                                    return (
                                                                      <div
                                                                        key={
                                                                          order.id
                                                                        }
                                                                        title={
                                                                          isKeyPrice
                                                                            ? order.notes ||
                                                                              order.conditions ||
                                                                              ""
                                                                            : undefined
                                                                        }
                                                                        className={`rounded ${borderClass} py-[6px] px-[10px] flex items-center gap-[6px] backdrop-blur-sm transition-all duration-300 cursor-pointer select-none ${colorClass}`}
                                                                        onClick={(
                                                                          e,
                                                                        ) => {
                                                                          e.stopPropagation();
                                                                        }}
                                                                        onDoubleClick={(
                                                                          e,
                                                                        ) => {
                                                                          e.stopPropagation();
                                                                          handleToggleOrderHighlight(
                                                                            tab.id,
                                                                            order.id,
                                                                            order.isManualHighlight,
                                                                          );
                                                                        }}
                                                                      >
                                                                        <div className="flex flex-col min-w-[28px]">
                                                                          <span
                                                                            className={`text-[10px] tracking-wider leading-none mb-[2px] ${isHighlighted ? "font-black" : "font-bold"}`}
                                                                          >
                                                                            {
                                                                              keyLabel
                                                                            }
                                                                          </span>
                                                                          {order.purpose ? (
                                                                            <span
                                                                              className={`text-[10px] tracking-wide truncate max-w-[40px] leading-none ${opacityClass}`}
                                                                            >
                                                                              {
                                                                                order.purpose
                                                                              }
                                                                            </span>
                                                                          ) : (
                                                                            isKeyPrice && (
                                                                              <span
                                                                                className={`text-[10px] tracking-wide leading-none ${opacityClass}`}
                                                                              >
                                                                                門檻
                                                                              </span>
                                                                            )
                                                                          )}
                                                                        </div>
                                                                        <div
                                                                          className={`flex flex-col border-l pl-2 ${borderLClass}`}
                                                                        >
                                                                          <div className="flex gap-2 items-baseline">
                                                                            <span
                                                                              className={`text-[13px] leading-none ${isHighlighted ? "font-black" : "font-bold"}`}
                                                                            >
                                                                              {order.price
                                                                                ? `$${order.price.toLocaleString()}`
                                                                                : "市價"}
                                                                            </span>
                                                                            {!isKeyPrice && (
                                                                              <span
                                                                                className={`text-[10px] leading-none ${opacityClass}`}
                                                                              >
                                                                                {
                                                                                  order.quantity
                                                                                }

                                                                                股
                                                                              </span>
                                                                            )}
                                                                          </div>
                                                                          {order.conditions && (
                                                                            <span
                                                                              className={`text-[10px] italic truncate max-w-[120px] mt-[3px] leading-none ${isHighlighted ? "opacity-90 font-medium" : "opacity-50"}`}
                                                                            >
                                                                              {
                                                                                order.conditions
                                                                              }
                                                                            </span>
                                                                          )}
                                                                        </div>
                                                                      </div>
                                                                    );
                                                                  },
                                                                )}
                                                            </div>
                                                          </div>
                                                        );
                                                      },
                                                    )}
                                                </div>
                                              </div>
                                            )}

                                            {trades.length > 0 && (
                                              <div className="mt-2 pt-2 border-t border-white/10 relative z-10">
                                                <div className="flex items-center justify-between mb-[4px]">
                                                  <p className="text-[12px] font-medium text-white/40 tracking-wide uppercase">
                                                    近期操作記錄 (
                                                    {trades.length})
                                                  </p>
                                                  {stats.totalQuantity !==
                                                    0 && (
                                                    <div className="flex items-center gap-2 text-[10px] text-white/40">
                                                      <span>
                                                        平均成本{" "}
                                                        <span className="font-bold text-white/80">
                                                          $
                                                          {stats.averagePrice.toLocaleString(
                                                            undefined,
                                                            {
                                                              minimumFractionDigits: 2,
                                                              maximumFractionDigits: 2,
                                                            },
                                                          )}
                                                        </span>
                                                      </span>
                                                      <span>
                                                        持有數量{" "}
                                                        <span className="font-bold text-white/80">
                                                          {Math.abs(
                                                            stats.totalQuantity,
                                                          )}
                                                          股
                                                        </span>
                                                      </span>
                                                    </div>
                                                  )}
                                                </div>
                                                <div className="flex flex-wrap gap-1">
                                                  {trades
                                                    .slice(0, 3)
                                                    .map((trade) => (
                                                      <div
                                                        key={trade.id}
                                                        className={`text-[11px] rounded border px-[8px] py-[2px] flex items-center gap-[4px] backdrop-blur-md ${trade.type === "BUY" ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-400" : "bg-blue-500/5 border-blue-500/20 text-blue-400"}`}
                                                      >
                                                        <span className="font-bold">
                                                          {trade.type === "BUY"
                                                            ? "買，"
                                                            : "賣，"}
                                                        </span>
                                                        <span className="font-medium">
                                                          {trade.price
                                                            ? `$${trade.price}`
                                                            : "市價"}{" "}
                                                          / {trade.quantity}股
                                                        </span>
                                                        {trade.operator === "機器" && (
                                                          <span className="text-red-500 font-bold ml-0.5">(機器)</span>
                                                        )}
                                                        {trade.operator === "人" && (
                                                          <span className="text-white/40 font-bold ml-0.5">(人)</span>
                                                        )}
                                                      </div>
                                                    ))}
                                                  {trades.length > 3 && (
                                                    <div className="text-[11px] rounded border border-white/10 px-[8px] py-[2px] flex items-center gap-[4px] text-white/40">
                                                      +{trades.length - 3} 更多
                                                    </div>
                                                  )}
                                                </div>
                                              </div>
                                            )}

                                            {/* Flip Trigger Area (Bottom section) */}
                                            <div
                                              className="absolute bottom-0 left-0 right-0 h-[60px] z-20 cursor-pointer group/flip bg-gradient-to-t from-white/[0.03] to-transparent hover:from-white/[0.08] transition-colors"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setFlippedCards((prev) => ({
                                                  ...prev,
                                                  [tab.id]: true,
                                                }));
                                              }}
                                            >
                                              <div className="absolute bottom-2 right-3 opacity-0 group-hover/flip:opacity-60 text-[10px] text-white transition-opacity flex items-center gap-1 font-bold">
                                                <svg
                                                  width="12"
                                                  height="12"
                                                  viewBox="0 0 24 24"
                                                  fill="none"
                                                  stroke="currentColor"
                                                  strokeWidth="2.5"
                                                  strokeLinecap="round"
                                                  strokeLinejoin="round"
                                                >
                                                  <path d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3m9 9a9 9 0 0 1-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 0 1 9-9" />
                                                </svg>
                                                數據圖視化
                                              </div>
                                            </div>
                                          </div>

                                          {/* Back Face */}
                                          <div
                                            style={{
                                              backfaceVisibility: "hidden",
                                              transform: "rotateY(180deg)",
                                            }}
                                            className="absolute inset-0 glass-card bg-transparent rounded-2xl flex flex-col p-3 w-full h-full cursor-pointer hover:bg-white/[0.04] transition-colors"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setFlippedCards((prev) => ({
                                                ...prev,
                                                [tab.id]: false,
                                              }));
                                            }}
                                          >
                                            <StockCardVisualizer
                                              plannedOrders={plannedOrders}
                                              currentPrice={tab.currentPrice}
                                              onToggleHighlight={(orderId, currentStatus) => handleToggleOrderHighlight(tab.id, orderId, currentStatus)}
                                              tabId={tab.id}
                                              annotations={tab.chartAnnotations || []}
                                              onUpdateAnnotations={(newAnn) => updateTab(tab.id, { chartAnnotations: newAnn })}
                                              averageCost={stats.totalQuantity !== 0 ? stats.averagePrice : undefined}
                                              stockName={tab.symbol}
                                              rating={tab.rating}
                                              qualityScore={tab.qualityScore}
                                              valueScore={tab.valueScore}
                                              buyRate={tab.buyRate}
                                              sellRate={tab.sellRate}
                                              volatility={tab.volatility}
                                              crashSimilarity={tab.crashSimilarity}
                                            />

                                            {/* Close back button */}
                                            <div className="absolute top-2 right-2">
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setFlippedCards((prev) => ({
                                                    ...prev,
                                                    [tab.id]: false,
                                                  }));
                                                }}
                                                className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/50 hover:text-white transition-colors"
                                              >
                                                ✕
                                              </button>
                                            </div>
                                          </div>
                                        </motion.div>
                                      </div>
                                    </div>
                                  );
                                  };

                                  if (group.isGroup) {
                                    return (
                                      <div key={group.id} className="relative flex p-1.5 sm:p-2 bg-gradient-to-r from-white/[0.04] to-white/[0.01] border border-white/5 shadow-2xl rounded-[36px] shrink-0 gap-4 group/box transition-all">
                                        {/* Optional Label / Indicator indicating this is a paired block could go here */}
                                        <div className="absolute -top-2 left-1/2 -translate-x-1/2 bg-white/10 px-3 py-0.5 rounded-full text-[10px] font-bold text-white/50 opacity-0 group-hover/box:opacity-100 transition-opacity whitespace-nowrap pointer-events-none border border-white/10">
                                          連動區塊
                                        </div>
                                        {group.tabs.map((t, i) => renderCard(t, i))}
                                      </div>
                                    );
                                  }
                                  
                                  return renderCard(group.tabs[0], groupIdx);
                                })}
                              </div>
                            </div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  </div>
                </div>
              </ScrollIn>
            </div>
          </div>
        )}

        {activeViewTab === "completed" && (
          <div className="grid grid-cols-1 gap-6">
            <div className="space-y-4">
              <ScrollIn delay={0.2} translateY={20}>
                <div className="glass-panel overflow-hidden drop-shadow-2xl flex flex-col group transition-all duration-500 h-auto">
                  <div className="px-6 py-5 flex items-center justify-between bg-blue-500/[0.03] border-b border-blue-500/10">
                    <div className="flex items-center gap-4">
                      <div className="w-1.5 h-6 bg-gradient-to-b from-blue-400 to-blue-600 rounded-full shadow-[0_0_10px_rgba(59,130,246,0.5)]"></div>
                      <h3 className="font-bold text-xl tracking-tight text-white/90">
                        已完成
                      </h3>
                      <span className="text-xs font-bold border border-blue-500/30 bg-blue-500/10 text-blue-400 px-2.5 py-1 rounded-full shadow-[0_0_10px_rgba(59,130,246,0.2)]">
                        <AnimatedNumber value={completedTabs.length} /> 檔
                      </span>
                    </div>
                    <Magnetic>
                      <TrendingUp className="h-6 w-6 text-blue-400 opacity-80 group-hover:text-blue-300 transition-colors" />
                    </Magnetic>
                  </div>
                  <div className="bg-transparent">
                    <div className="overflow-hidden">
                      <div className="p-6 flex flex-col min-h-[200px]">
                        <AnimatePresence mode="wait">
                          {completedTabs.length === 0 ? (
                            <motion.div
                              initial={{ opacity: 0, scale: 0.95 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.95 }}
                              className="h-full flex flex-col items-center justify-center text-white/30 flex-1 py-16"
                            >
                              <div className="bg-white/5 p-5 border border-white/10 rounded-full mb-4">
                                <TrendingUp className="h-10 w-10 opacity-40" />
                              </div>
                              <p className="text-base font-bold text-white/50 tracking-wide">
                                尚無已完成交易
                              </p>
                            </motion.div>
                          ) : (
                            <div className="space-y-8">
                              {realCompletedTabs.length > 0 && (
                                <div className="space-y-4">
                                  <div className="flex items-center gap-2">
                                    <div className="h-1.5 w-1.5 rounded-full bg-emerald-400/80 shadow-[0_0_5px_rgba(52,211,153,0.5)]"></div>
                                    <h4 className="text-xs font-bold text-emerald-400/80 tracking-widest uppercase">
                                      真實交易
                                    </h4>
                                  </div>
                                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {realCompletedTabs.map((tab, idx) => (
                                      <motion.div
                                        layout
                                        initial={{ opacity: 0, y: 15 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: idx * 0.05 }}
                                        whileHover={{ scale: 1.02, y: -2 }}
                                        key={tab.id}
                                        onClick={() =>
                                          navigate(`/stock/${tab.id}`)
                                        }
                                        className="glass-card flex items-center justify-between p-4 cursor-pointer relative overflow-hidden group/item border border-emerald-500/10 hover:border-emerald-500/30"
                                      >
                                        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent opacity-0 group-hover/item:opacity-100 transition-opacity duration-500"></div>
                                        <div className="relative z-10 flex flex-col gap-1.5">
                                          <div className="font-black text-xl tracking-wide text-white/90">
                                            {tab.symbol}
                                          </div>
                                        </div>
                                        <div
                                          className={`relative z-10 text-xl font-black ${tab.finalPnL && tab.finalPnL >= 0 ? "text-emerald-400 color-glow-emerald" : "text-red-400 color-glow-red"}`}
                                        >
                                          {tab.finalPnL && tab.finalPnL >= 0
                                            ? "+"
                                            : ""}
                                          ${tab.finalPnL?.toLocaleString() || 0}
                                        </div>
                                      </motion.div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {completedTabs.filter(
                                (t) => t.tradeType === "simulated",
                              ).length > 0 && (
                                <div className="space-y-4">
                                  <div className="flex items-center gap-2">
                                    <div className="h-1.5 w-1.5 rounded-full bg-amber-400/80 shadow-[0_0_5px_rgba(251,191,36,0.5)]"></div>
                                    <h4 className="text-xs font-bold text-amber-400/80 tracking-widest uppercase">
                                      模擬交易
                                    </h4>
                                  </div>
                                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {completedTabs
                                      .filter(
                                        (t) => t.tradeType === "simulated",
                                      )
                                      .map((tab, idx) => (
                                        <motion.div
                                          layout
                                          initial={{ opacity: 0, y: 15 }}
                                          animate={{ opacity: 1, y: 0 }}
                                          transition={{ delay: idx * 0.05 }}
                                          whileHover={{ scale: 1.02, y: -2 }}
                                          key={tab.id}
                                          onClick={() =>
                                            navigate(`/stock/${tab.id}`)
                                          }
                                          className="glass-card flex items-center justify-between p-4 cursor-pointer relative overflow-hidden group/item border border-amber-500/10 hover:border-amber-500/30"
                                        >
                                          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-transparent opacity-0 group-hover/item:opacity-100 transition-opacity duration-500"></div>
                                          <div className="relative z-10 flex flex-col gap-1.5">
                                            <div className="font-black text-xl tracking-wide text-white/90">
                                              {tab.symbol}
                                            </div>
                                          </div>
                                          <div
                                            className={`relative z-10 text-xl font-black ${tab.finalPnL && tab.finalPnL >= 0 ? "text-emerald-400 color-glow-emerald" : "text-red-400 color-glow-red"}`}
                                          >
                                            {tab.finalPnL && tab.finalPnL >= 0
                                              ? "+"
                                              : ""}
                                            $
                                            {tab.finalPnL?.toLocaleString() ||
                                              0}
                                          </div>
                                        </motion.div>
                                      ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  </div>
                </div>
              </ScrollIn>
            </div>
          </div>
        )}

        {activeViewTab === "socrates" && (
          <div
            id="socrates-calendar-section"
            className="flex flex-col gap-4 w-[calc(100vw-2rem)] sm:w-[calc(100vw-3rem)] lg:w-[calc(100vw-6rem)] max-w-[1920px] relative left-1/2 -translate-x-1/2 animate-in fade-in duration-700 pb-4"
          >
            <ScrollIn delay={0.1} translateY={20}>
              <div className="rounded-[2rem] border border-white/5 bg-[#0F0F12]/80 backdrop-blur-xl overflow-hidden shadow-[0_20px_60px_-15px_rgba(0,0,0,0.5)] relative group/calendar">
                {/* Ambient Glow */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-purple-600/20 blur-[120px] rounded-full pointer-events-none transition-opacity duration-1000"></div>

                <div
                  className="px-4 py-4 sm:px-6 sm:py-5 flex flex-col sm:flex-row sm:items-center justify-between border-b border-white/5 gap-4 relative z-10 cursor-pointer group/header"
                  onClick={() =>
                    setIsSocratesCalendarOpen(!isSocratesCalendarOpen)
                  }
                >
                  <div className="flex items-center gap-4">
                    <div className="w-1.5 h-8 bg-gradient-to-b from-cyan-400 to-purple-600 rounded-full shadow-[0_0_15px_rgba(168,85,247,0.6)]"></div>
                    <h3 className="font-extrabold text-2xl tracking-tight text-white flex items-center gap-3">
                      <Calendar className="w-7 h-7 text-purple-400" />
                      Socrates 日曆
                    </h3>
                  </div>

                  <div className="flex items-center gap-4">
                    <AnimatePresence>
                      {isSocratesCalendarOpen && (
                        <motion.div
                          initial={{ opacity: 0, width: 0 }}
                          animate={{ opacity: 1, width: "auto" }}
                          exit={{ opacity: 0, width: 0 }}
                          className="flex items-center gap-4 bg-white/[0.03] p-1.5 rounded-full border border-white/5 backdrop-blur-md overflow-hidden"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() =>
                              setSocratesCurrentDate(
                                new Date(
                                  socratesCurrentDate.getFullYear(),
                                  socratesCurrentDate.getMonth() - 1,
                                  1,
                                ),
                              )
                            }
                            className="p-2.5 hover:bg-white/10 rounded-full transition-all group/btn shrink-0"
                          >
                            <ChevronLeft className="w-5 h-5 text-white/50 group-hover/btn:text-purple-400 transition-colors" />
                          </button>
                          <span className="font-bold text-lg text-white/90 w-36 text-center tracking-wide shrink-0">
                            {socratesCurrentDate.getFullYear()} 年{" "}
                            {socratesCurrentDate.getMonth() + 1} 月
                          </span>
                          <button
                            onClick={() =>
                              setSocratesCurrentDate(
                                new Date(
                                  socratesCurrentDate.getFullYear(),
                                  socratesCurrentDate.getMonth() + 1,
                                  1,
                                ),
                              )
                            }
                            className="p-2.5 hover:bg-white/10 rounded-full transition-all group/btn shrink-0"
                          >
                            <ChevronRight className="w-5 h-5 text-white/50 group-hover/btn:text-purple-400 transition-colors" />
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                    <motion.div
                      animate={{ rotate: isSocratesCalendarOpen ? 180 : 0 }}
                      transition={{ duration: 0.3 }}
                      className="p-2 bg-white/5 rounded-full border border-white/10 group-hover/header:bg-white/10"
                    >
                      <ChevronDown className="w-5 h-5 text-purple-400" />
                    </motion.div>
                  </div>
                </div>

                <AnimatePresence>
                  {isSocratesCalendarOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.4, ease: "easeInOut" }}
                      className="overflow-hidden"
                    >
                      <div className="py-2 px-0 sm:px-2 relative z-10">
                        <div className="grid grid-cols-7 gap-1 sm:gap-2 text-center mb-2">
                          {[
                            "Sun",
                            "Mon",
                            "Tue",
                            "Wed",
                            "Thu",
                            "Fri",
                            "Sat",
                          ].map((day, idx) => (
                            <div
                              key={day}
                              className={`text-[11px] font-bold tracking-widest uppercase py-2 ${idx === 0 || idx === 6 ? "text-purple-400/50" : "text-white/40"}`}
                            >
                              {day}
                            </div>
                          ))}
                        </div>

                        {/* Calendar Grid */}
                        <div className="grid grid-cols-7 gap-1 sm:gap-2 relative">
                          {Array.from({
                            length: new Date(
                              socratesCurrentDate.getFullYear(),
                              socratesCurrentDate.getMonth(),
                              1,
                            ).getDay(),
                          }).map((_, i) => (
                            <div
                              key={`empty-${i}`}
                              className="h-16 sm:h-24 opacity-10"
                            ></div>
                          ))}

                          {Array.from({
                            length: new Date(
                              socratesCurrentDate.getFullYear(),
                              socratesCurrentDate.getMonth() + 1,
                              0,
                            ).getDate(),
                          }).map((_, i) => {
                            const d = i + 1;
                            const dateObj = new Date(
                              socratesCurrentDate.getFullYear(),
                              socratesCurrentDate.getMonth(),
                              d,
                            );
                            const dateKey = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, "0")}-${String(dateObj.getDate()).padStart(2, "0")}`;
                            const dayData = socratesData[dateKey];
                            const hasData =
                              !!dayData && (!!dayData.strong || !!dayData.weak);
                            const isSelected =
                              selectedSocratesDate?.getTime() ===
                              dateObj.getTime();
                            const today = new Date();
                            const isToday =
                              dateObj.getFullYear() === today.getFullYear() &&
                              dateObj.getMonth() === today.getMonth() &&
                              dateObj.getDate() === today.getDate();

                            const totalItems = hasData
                              ? (dayData.strong?.length || 0) +
                                (dayData.weak?.length || 0)
                              : 0;

                            return (
                              <div
                                key={d}
                                onClick={() => setSelectedSocratesDate(dateObj)}
                                className={`h-16 sm:h-24 rounded-2xl flex flex-col p-2 sm:p-3 cursor-pointer transition-all duration-500 relative overflow-hidden group/day
                                  ${isSelected ? "bg-purple-900/40 shadow-[0_0_30px_rgba(168,85,247,0.2)] border border-purple-500/50 scale-[1.02] z-10" : "bg-white/[0.02] hover:bg-white/[0.06] border border-white/5 hover:border-white/10"}
                                  ${isToday && !isSelected ? "ring-1 ring-purple-500/30" : ""}
                                `}
                              >
                                <div className="flex justify-between items-start">
                                  <span
                                    className={`text-base sm:text-lg font-bold select-none transition-colors duration-300 ${isSelected ? "text-white" : hasData ? "text-white/80" : "text-white/30 group-hover/day:text-white/50"} ${isToday && !isSelected ? "text-purple-400" : ""}`}
                                  >
                                    {d}
                                  </span>
                                  {isToday && (
                                    <span className="text-[9px] font-black uppercase text-purple-400 tracking-wider">
                                      Today
                                    </span>
                                  )}
                                </div>

                                {hasData && (
                                  <div className="mt-auto flex flex-col items-start gap-1.5 w-full">
                                    {dayData.strong &&
                                      dayData.strong.length > 0 && (
                                        <div className="flex items-center gap-1.5 w-full">
                                          <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]"></div>
                                          <div className="h-1 flex-1 bg-white/5 rounded-full overflow-hidden">
                                            <div
                                              className="h-full bg-emerald-400 rounded-full"
                                              style={{
                                                width: `${Math.min(100, dayData.strong.length * 10)}%`,
                                              }}
                                            ></div>
                                          </div>
                                        </div>
                                      )}
                                    {dayData.weak &&
                                      dayData.weak.length > 0 && (
                                        <div className="flex items-center gap-1.5 w-full">
                                          <div className="h-1.5 w-1.5 rounded-full bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.8)]"></div>
                                          <div className="h-1 flex-1 bg-white/5 rounded-full overflow-hidden">
                                            <div
                                              className="h-full bg-rose-400 rounded-full"
                                              style={{
                                                width: `${Math.min(100, dayData.weak.length * 10)}%`,
                                              }}
                                            ></div>
                                          </div>
                                        </div>
                                      )}
                                  </div>
                                )}

                                {isSelected && (
                                  <motion.div
                                    layoutId="calendar-selection"
                                    className="absolute inset-0 border-2 border-purple-400/80 rounded-2xl pointer-events-none"
                                    initial={false}
                                    transition={{
                                      type: "spring",
                                      stiffness: 300,
                                      damping: 30,
                                    }}
                                  >
                                    <div className="absolute inset-0 bg-gradient-to-br from-purple-500/20 to-transparent opacity-100"></div>
                                  </motion.div>
                                )}
                                {!isSelected && hasData && (
                                  <div className="absolute top-0 right-0 w-8 h-8 bg-gradient-to-bl from-purple-500/20 to-transparent pointer-events-none rounded-bl-2xl"></div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </ScrollIn>

            {/* Selected Date Details */}
            <AnimatePresence mode="wait">
              {isSocratesCalendarOpen && selectedSocratesDate && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                  key={selectedSocratesDate.toISOString()}
                  className="rounded-[2rem] border border-white/5 bg-[#0F0F12]/80 backdrop-blur-xl overflow-hidden shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)] relative mt-4"
                >
                  {/* Subtle connecting line anchor */}
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 w-px h-8 bg-gradient-to-b from-purple-500/0 via-purple-500/50 to-purple-500/0"></div>

                  <div className="px-4 py-4 sm:px-6 sm:py-5 flex flex-col sm:flex-row items-center justify-between border-b border-white/5 bg-white/[0.01]">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-purple-500/10 rounded-2xl border border-purple-500/20">
                        <TrendingUp className="w-6 h-6 text-purple-400" />
                      </div>
                      <div>
                        <h3 className="font-extrabold text-2xl text-white">
                          {selectedSocratesDate.toLocaleDateString("zh-TW", {
                            year: "numeric",
                            month: "long",
                            day: "numeric",
                          })}
                        </h3>
                        <p className="text-sm font-medium text-white/40 mt-1">
                          Socrates 市場訊號分析
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex px-4 pt-4 sm:px-6">
                    <div className="flex p-1 bg-white/[0.03] rounded-xl border border-white/5 backdrop-blur-sm">
                      <button
                        onClick={() => setSocratesSubTab("strong")}
                        className={`relative px-6 py-2.5 text-sm font-bold transition-all duration-300 rounded-lg overflow-hidden ${
                          socratesSubTab === "strong"
                            ? "text-white"
                            : "text-white/40 hover:text-white/70 hover:bg-white/5"
                        }`}
                      >
                        {socratesSubTab === "strong" && (
                          <motion.div
                            layoutId="subtab-bg"
                            className="absolute inset-0 bg-emerald-500/20 border border-emerald-500/30 rounded-lg pointer-events-none shadow-[0_0_15px_rgba(16,185,129,0.2)]"
                          />
                        )}
                        <span className="relative z-10 flex items-center gap-2">
                          <TrendingUp className="w-4 h-4" /> 最強前 10 名
                        </span>
                      </button>
                      <button
                        onClick={() => setSocratesSubTab("weak")}
                        className={`relative px-6 py-2.5 text-sm font-bold transition-all duration-300 rounded-lg overflow-hidden ${
                          socratesSubTab === "weak"
                            ? "text-white"
                            : "text-white/40 hover:text-white/70 hover:bg-white/5"
                        }`}
                      >
                        {socratesSubTab === "weak" && (
                          <motion.div
                            layoutId="subtab-bg"
                            className="absolute inset-0 bg-rose-500/20 border border-rose-500/30 rounded-lg pointer-events-none shadow-[0_0_15px_rgba(244,63,94,0.2)]"
                          />
                        )}
                        <span className="relative z-10 flex items-center gap-2">
                          <TrendingDown className="w-4 h-4" /> 最弱前 10 名
                        </span>
                      </button>
                    </div>
                  </div>

                  <div className="p-8">
                    {(() => {
                      const dateKey = `${selectedSocratesDate.getFullYear()}-${String(selectedSocratesDate.getMonth() + 1).padStart(2, "0")}-${String(selectedSocratesDate.getDate()).padStart(2, "0")}`;
                      const dayData = socratesData[dateKey]?.[socratesSubTab];

                      if (!dayData || dayData.length === 0) {
                        return (
                          <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
                            <div className="w-24 h-24 mb-8 relative">
                              <div className="absolute inset-0 bg-purple-500/20 rounded-full blur-2xl"></div>
                              <div className="relative w-full h-full bg-[#1A1A1E] border border-white/10 rounded-full flex items-center justify-center shadow-xl">
                                <FileJson className="w-10 h-10 text-purple-400/50" />
                              </div>
                            </div>
                            <h4 className="text-xl font-bold text-white/90 mb-2">
                              尚無{" "}
                              {socratesSubTab === "strong" ? "最強" : "最弱"}{" "}
                              分析資料
                            </h4>
                            <p className="text-white/40 font-medium mb-8 max-w-md">
                              匯入 Socrates JSON 檔案以查看{" "}
                              {selectedSocratesDate.getMonth() + 1} 月{" "}
                              {selectedSocratesDate.getDate()}{" "}
                              日的市場訊號與股票清單。
                            </p>
                            <div className="relative inline-block group/btn">
                              <Input
                                type="file"
                                accept=".json"
                                onChange={(e) =>
                                  handleSocratesUpload(
                                    e,
                                    dateKey,
                                    socratesSubTab,
                                  )
                                }
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                              />
                              <button className="flex items-center gap-3 px-8 py-4 bg-white/5 hover:bg-white/10 text-white font-bold rounded-2xl border border-white/10 transition-all shadow-lg hover:shadow-[0_0_30px_rgba(168,85,247,0.2)] group-hover/btn:border-purple-500/50 group-hover/btn:text-purple-300">
                                <Upload className="w-5 h-5 text-purple-400 group-hover/btn:-translate-y-1 transition-transform" />
                                匯入{" "}
                                {socratesSubTab === "strong" ? "最強" : "最弱"}{" "}
                                前 10 名 JSON
                              </button>
                            </div>
                          </div>
                        );
                      }

                      const sortedData = getSortedSocratesData(dayData);

                      return (
                        <div className="overflow-x-auto pb-4">
                          <div className="flex justify-between items-center mb-6">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-white/40 font-medium tracking-wide">
                                點擊標題欄位可排序資料
                              </span>
                              <button
                                onClick={() =>
                                  setIsSocratesSortWeightsOpen(true)
                                }
                                className="ml-4 flex items-center gap-1.5 text-xs font-bold text-purple-400/80 hover:text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 px-3 py-1.5 rounded-lg transition-colors border border-purple-500/20"
                              >
                                <SlidersHorizontal className="w-3.5 h-3.5" />{" "}
                                綜合評分排序設定
                                {socratesSortConfig?.key === "customScore" && (
                                  <span className="ml-1 text-purple-300">
                                    {socratesSortConfig.direction === "asc"
                                      ? "↑"
                                      : "↓"}
                                  </span>
                                )}
                              </button>
                            </div>
                            <button
                              onClick={() =>
                                deleteSocratesData(dateKey, socratesSubTab)
                              }
                              className="flex items-center gap-1.5 text-xs font-bold text-rose-500/50 hover:text-rose-400 bg-rose-500/5 hover:bg-rose-500/10 px-3 py-1.5 rounded-lg transition-colors border border-transparent hover:border-rose-500/20"
                            >
                              <Trash2 className="w-3.5 h-3.5" /> 移除此清單
                            </button>
                          </div>
                          <div className="overflow-x-auto pb-4 w-full">
                            <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="border-b border-white/10">
                                <th
                                  className="py-1.5 px-2 font-black text-white/40 text-[10px] tracking-wider uppercase whitespace-nowrap hover:text-white/80 cursor-pointer transition-colors"
                                  onClick={() => handleSocratesSort("symbol")}
                                >
                                  代碼{" "}
                                  {socratesSortConfig?.key === "symbol" && (
                                    <span className="text-purple-400">
                                      {socratesSortConfig.direction === "asc"
                                        ? "↑"
                                        : "↓"}
                                    </span>
                                  )}
                                </th>
                                <th
                                  className="py-1.5 px-2 font-black text-white/40 text-[10px] tracking-wider uppercase whitespace-nowrap hover:text-white/80 cursor-pointer transition-colors"
                                  onClick={() => handleSocratesSort("name")}
                                >
                                  名稱{" "}
                                  {socratesSortConfig?.key === "name" && (
                                    <span className="text-purple-400">
                                      {socratesSortConfig.direction === "asc"
                                        ? "↑"
                                        : "↓"}
                                    </span>
                                  )}
                                </th>
                                <th
                                  className="py-1.5 px-2 font-black text-white/40 text-[10px] tracking-wider uppercase text-right whitespace-nowrap hover:text-white/80 cursor-pointer transition-colors"
                                  onClick={() => handleSocratesSort("price")}
                                >
                                  現價{" "}
                                  {socratesSortConfig?.key === "price" && (
                                    <span className="text-purple-400">
                                      {socratesSortConfig.direction === "asc"
                                        ? "↑"
                                        : "↓"}
                                    </span>
                                  )}
                                </th>
                                <th
                                  className="py-1.5 px-2 font-black text-fuchsia-400/50 text-[10px] tracking-wider uppercase text-right whitespace-nowrap hover:text-fuchsia-400 cursor-pointer transition-colors"
                                  onClick={() => handleSocratesSort("rating")}
                                >
                                  AI分析{" "}
                                  {socratesSortConfig?.key === "rating" && (
                                    <span className="text-fuchsia-400">
                                      {socratesSortConfig.direction === "asc"
                                        ? "↑"
                                        : "↓"}
                                    </span>
                                  )}
                                </th>
                                <th
                                  className="py-1.5 px-2 font-black text-emerald-500/50 text-[10px] tracking-wider uppercase text-right whitespace-nowrap hover:text-emerald-400 cursor-pointer transition-colors"
                                  onClick={() => handleSocratesSort("buyScore")}
                                >
                                  Buy{" "}
                                  {socratesSortConfig?.key === "buyScore" && (
                                    <span className="text-emerald-400">
                                      {socratesSortConfig.direction === "asc"
                                        ? "↑"
                                        : "↓"}
                                    </span>
                                  )}
                                </th>
                                <th
                                  className="py-1.5 px-2 font-black text-rose-400/50 text-[10px] tracking-wider uppercase text-right whitespace-nowrap hover:text-rose-400 cursor-pointer transition-colors"
                                  onClick={() =>
                                    handleSocratesSort("sellScore")
                                  }
                                >
                                  Sell{" "}
                                  {socratesSortConfig?.key === "sellScore" && (
                                    <span className="text-rose-400">
                                      {socratesSortConfig.direction === "asc"
                                        ? "↑"
                                        : "↓"}
                                    </span>
                                  )}
                                </th>
                                <th
                                  className="py-1.5 px-2 font-black text-cyan-400/50 text-[10px] tracking-wider uppercase text-right whitespace-nowrap hover:text-cyan-400 cursor-pointer transition-colors"
                                  onClick={() =>
                                    handleSocratesSort("crashSimilarity")
                                  }
                                >
                                  風險{" "}
                                  {socratesSortConfig?.key ===
                                    "crashSimilarity" && (
                                    <span className="text-cyan-400">
                                      {socratesSortConfig.direction === "asc"
                                        ? "↑"
                                        : "↓"}
                                    </span>
                                  )}
                                </th>
                                <th
                                  className="py-1.5 px-2 font-black text-white/40 text-[10px] tracking-wider uppercase text-right whitespace-nowrap hover:text-white/80 cursor-pointer transition-colors"
                                  onClick={() =>
                                    handleSocratesSort("qualityScore")
                                  }
                                >
                                  Qual{" "}
                                  {socratesSortConfig?.key ===
                                    "qualityScore" && (
                                    <span className="text-purple-400">
                                      {socratesSortConfig.direction === "asc"
                                        ? "↑"
                                        : "↓"}
                                    </span>
                                  )}
                                </th>
                                <th
                                  className="py-1.5 px-2 font-black text-white/40 text-[10px] tracking-wider uppercase text-right whitespace-nowrap hover:text-white/80 cursor-pointer transition-colors"
                                  onClick={() =>
                                    handleSocratesSort("valueScore")
                                  }
                                >
                                  Val{" "}
                                  {socratesSortConfig?.key === "valueScore" && (
                                    <span className="text-purple-400">
                                      {socratesSortConfig.direction === "asc"
                                        ? "↑"
                                        : "↓"}
                                    </span>
                                  )}
                                </th>
                                <th
                                  className="py-1.5 px-2 font-black text-emerald-400/40 text-[10px] tracking-wider uppercase text-right whitespace-nowrap hover:text-emerald-400/80 cursor-pointer transition-colors"
                                  onClick={() =>
                                    handleSocratesSort("positiveValue")
                                  }
                                >
                                  Pos Val{" "}
                                  {socratesSortConfig?.key === "positiveValue" && (
                                    <span className="text-emerald-400">
                                      {socratesSortConfig.direction === "asc"
                                        ? "↑"
                                        : "↓"}
                                    </span>
                                  )}
                                </th>
                                <th
                                  className="py-1.5 px-2 font-black text-rose-400/40 text-[10px] tracking-wider uppercase text-right whitespace-nowrap hover:text-rose-400/80 cursor-pointer transition-colors"
                                  onClick={() =>
                                    handleSocratesSort("negativeValue")
                                  }
                                >
                                  Neg Val{" "}
                                  {socratesSortConfig?.key === "negativeValue" && (
                                    <span className="text-rose-400">
                                      {socratesSortConfig.direction === "asc"
                                        ? "↑"
                                        : "↓"}
                                    </span>
                                  )}
                                </th>
                                <th
                                  className="py-1.5 px-2 font-black text-white/40 text-[10px] tracking-wider uppercase text-left whitespace-nowrap hover:text-white/80 cursor-pointer transition-colors"
                                  onClick={() =>
                                    handleSocratesSort("ecmStatus")
                                  }
                                >
                                  訊號解讀{" "}
                                  {socratesSortConfig?.key === "ecmStatus" && (
                                    <span className="text-purple-400">
                                      {socratesSortConfig.direction === "asc"
                                        ? "↑"
                                        : "↓"}
                                    </span>
                                  )}
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/[0.03]">
                              {sortedData.map((item, idx) => (
                                <tr
                                  key={idx}
                                  className="hover:bg-white/[0.04] transition-all duration-300 group/row ease-out hover:-translate-y-0.5 hover:shadow-lg relative"
                                >
                                  <td className="py-1.5 px-2 font-bold text-white whitespace-nowrap text-xs group-hover/row:text-purple-300 transition-colors">
                                    <div className="flex items-center gap-1.5">
                                      <div
                                        className={`w-1 h-5 rounded-full ${socratesSubTab === "strong" ? "bg-emerald-500/50" : "bg-rose-500/50"} opacity-0 group-hover/row:opacity-100 transition-opacity`}
                                      ></div>
                                      {item.symbol}
                                    </div>
                                  </td>
                                  <td className="py-1.5 px-2 text-white/70 font-medium text-[11px] truncate max-w-[80px] sm:max-w-[120px] xl:max-w-[160px]" title={item.name}>
                                    {item.name || "-"}
                                  </td>
                                  <td className="py-1.5 px-2 text-white/90 text-[11px] font-bold text-right tabular-nums whitespace-nowrap">
                                    {item.price ? "$" + item.price : "-"}
                                  </td>
                                  <td className="py-1.5 px-2 text-fuchsia-400 font-extrabold text-[11px] text-right tabular-nums whitespace-nowrap group-hover/row:text-fuchsia-300 transition-colors">
                                    {item.rating !== undefined
                                      ? item.rating
                                      : "-"}
                                  </td>
                                  <td className="py-1.5 px-2 text-emerald-400 font-extrabold text-[11px] text-right tabular-nums whitespace-nowrap group-hover/row:text-emerald-300 transition-colors">
                                    {item.buyScore !== undefined
                                      ? item.buyScore
                                      : "-"}
                                  </td>
                                  <td className="py-1.5 px-2 text-rose-400 font-extrabold text-[11px] text-right tabular-nums whitespace-nowrap group-hover/row:text-rose-300 transition-colors">
                                    {item.sellScore !== undefined
                                      ? item.sellScore
                                      : "-"}
                                  </td>
                                  <td className="py-1.5 px-2 text-cyan-400 font-extrabold text-[11px] text-right tabular-nums whitespace-nowrap group-hover/row:text-cyan-300 transition-colors">
                                    {item.crashSimilarity !== undefined
                                      ? item.crashSimilarity
                                      : "-"}
                                  </td>
                                  <td className="py-1.5 px-2 text-indigo-400 font-extrabold text-[11px] text-right tabular-nums whitespace-nowrap group-hover/row:text-indigo-300 transition-colors">
                                    {item.qualityScore !== undefined
                                      ? item.qualityScore
                                      : "-"}
                                  </td>
                                  <td className="py-1.5 px-2 text-amber-400 font-extrabold text-[11px] text-right tabular-nums whitespace-nowrap group-hover/row:text-amber-300 transition-colors">
                                    {item.valueScore !== undefined
                                      ? item.valueScore
                                      : "-"}
                                  </td>
                                  <td className="py-1.5 px-2 text-emerald-400 font-extrabold text-[11px] text-right tabular-nums whitespace-nowrap group-hover/row:text-emerald-300 transition-colors">
                                    {item.positiveValue !== undefined
                                      ? item.positiveValue
                                      : "-"}
                                  </td>
                                  <td className="py-1.5 px-2 text-rose-400 font-extrabold text-[11px] text-right tabular-nums whitespace-nowrap group-hover/row:text-rose-300 transition-colors">
                                    {item.negativeValue !== undefined
                                      ? item.negativeValue
                                      : "-"}
                                  </td>
                                  <td className="py-1.5 px-2 text-white/50 text-[11px] text-left group-hover/row:text-white/80 transition-colors font-medium">
                                    <div className="flex items-center gap-1">
                                      {item.ecmStatus ? (
                                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-white/5 border border-white/5 whitespace-nowrap overflow-hidden text-ellipsis">
                                          {item.ecmStatus}
                                        </span>
                                      ) : (
                                        "-"
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Socrates Sort Weights Customization Dialog */}
      <Dialog
        open={isSocratesSortWeightsOpen}
        onOpenChange={setIsSocratesSortWeightsOpen}
      >
        <DialogContent className="glass-panel border-white/10 shadow-2xl bg-[#0F0F12]/95 backdrop-blur-3xl text-white max-w-[320px] p-6 rounded-2xl border border-white/10">
          <DialogHeader className="mb-4">
            <DialogTitle className="font-black text-xl text-white flex items-center justify-center gap-2">
              <SlidersHorizontal className="w-5 h-5 text-purple-400" />
              綜合評分權重設定
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="text-xs font-bold text-white/50 flex justify-between">
                <span>崩盤相似度權重</span>
                <span className="text-purple-400">
                  {socratesSortWeights.crashSimilarity}
                </span>
              </label>
              <input
                type="range"
                min="0"
                max="10"
                step="1"
                className="w-full mt-2 accent-purple-500"
                value={socratesSortWeights.crashSimilarity}
                onChange={(e) =>
                  setSocratesSortWeights((prev) => ({
                    ...prev,
                    crashSimilarity: Number(e.target.value),
                  }))
                }
              />
            </div>
            <div>
              <label className="text-xs font-bold text-white/50 flex justify-between">
                <span>Buy Rate 權重</span>
                <span className="text-emerald-400">
                  {socratesSortWeights.buyScore}
                </span>
              </label>
              <input
                type="range"
                min="0"
                max="10"
                step="1"
                className="w-full mt-2 accent-emerald-500"
                value={socratesSortWeights.buyScore}
                onChange={(e) =>
                  setSocratesSortWeights((prev) => ({
                    ...prev,
                    buyScore: Number(e.target.value),
                  }))
                }
              />
            </div>
            <div>
              <label className="text-xs font-bold text-white/50 flex justify-between">
                <span>Sell Rate 權重</span>
                <span className="text-rose-400">
                  {socratesSortWeights.sellScore}
                </span>
              </label>
              <input
                type="range"
                min="0"
                max="10"
                step="1"
                className="w-full mt-2 accent-rose-500"
                value={socratesSortWeights.sellScore}
                onChange={(e) =>
                  setSocratesSortWeights((prev) => ({
                    ...prev,
                    sellScore: Number(e.target.value),
                  }))
                }
              />
            </div>
            <div>
              <label className="text-xs font-bold text-white/50 flex justify-between">
                <span>Quality Score 權重</span>
                <span className="text-indigo-400">
                  {socratesSortWeights.qualityScore}
                </span>
              </label>
              <input
                type="range"
                min="0"
                max="10"
                step="1"
                className="w-full mt-2 accent-indigo-500"
                value={socratesSortWeights.qualityScore}
                onChange={(e) =>
                  setSocratesSortWeights((prev) => ({
                    ...prev,
                    qualityScore: Number(e.target.value),
                  }))
                }
              />
            </div>
            <div>
              <label className="text-xs font-bold text-white/50 flex justify-between">
                <span>Value Score 權重</span>
                <span className="text-amber-400">
                  {socratesSortWeights.valueScore}
                </span>
              </label>
              <input
                type="range"
                min="0"
                max="10"
                step="1"
                className="w-full mt-2 accent-amber-500"
                value={socratesSortWeights.valueScore}
                onChange={(e) =>
                  setSocratesSortWeights((prev) => ({
                    ...prev,
                    valueScore: Number(e.target.value),
                  }))
                }
              />
            </div>
          </div>
          <DialogFooter className="mt-6">
            <Button
              className="w-full bg-purple-500 hover:bg-purple-600 text-white font-bold"
              onClick={() => {
                setIsSocratesSortWeightsOpen(false);
                handleSocratesSort("customScore");
              }}
            >
              依此權重重新排序
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
