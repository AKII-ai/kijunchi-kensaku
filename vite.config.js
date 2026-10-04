import { defineConfig } from "vite";

// 開発サーバでは /egov を e-Gov 法令API v2 へ転送する（ブラウザ直接アクセスは CORS で止まる）。
export default defineConfig({
  base: "./",
  // exceljs（約940kB）はダウンロードボタンを押したときだけ読み込む別ファイルなので、警告の上限を上げる。
  build: { chunkSizeWarningLimit: 1000 },
  server: {
    port: 5173,
    proxy: {
      "/egov": {
        target: "https://laws.e-gov.go.jp",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/egov/, "/api/2"),
      },
    },
  },
});
