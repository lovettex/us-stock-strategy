/// <reference types="vite/client" />

// Vite 的 `?url` / `?raw` 匯入需要型別宣告
declare module "*?url" {
  const src: string;
  export default src;
}

declare module "*?raw" {
  const src: string;
  export default src;
}
