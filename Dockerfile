# Cloud Run 部署用（Express + Vite 建置後的靜態檔由同一台伺服器提供）
FROM node:22-slim

WORKDIR /app

# 先裝依賴，利用 layer cache
COPY package*.json ./
RUN npm install --no-audit --no-fund

# 複製其餘原始碼並建置前端
COPY . .
RUN npm run build

ENV NODE_ENV=production
# Cloud Run 會注入 PORT（預設 8080），server.ts 已支援 process.env.PORT
EXPOSE 8080

CMD ["npm", "start"]
