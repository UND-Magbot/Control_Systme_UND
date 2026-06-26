import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // tsconfig 의 "@/*" -> "./*" 별칭과 동일하게 매핑
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["app/**/*.{test,spec}.{ts,tsx}"],
    css: false,
  },
});
