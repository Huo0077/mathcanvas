import eslint from "@eslint/js"
import reactHooks from "eslint-plugin-react-hooks"
import reactRefresh from "eslint-plugin-react-refresh"
import tseslint from "typescript-eslint"

export default tseslint.config(
  {
    /**
     * Rust 的构建产物（`cargo` 把生成物放在 `target/` 下，其中包含 `tauri-codegen` 生成的 JS）。
     *
     * 这些文件**不是我们的源码**：`tauri build` 一跑就会在里面生成新的 JS，
     * 于是 lint 会在"刚构建过"和"没构建过"之间给出不同的结果 ——
     * 这不是代码质量问题，而是把别人的产物当成了自己的源码在检查。
     */
    ignores: ["**/node_modules/**", "**/dist/**", "**/build-check/**", "**/test-results/**", "**/playwright-report/**", "**/vite-cache*/**", "**/src-tauri/target/**", "**/src-tauri/gen/**"]
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    /**
     * `.mjs` 是**脚本**（构建、预览、工具链包装），跑在 Node 里。
     *
     * `process` 早就在白名单里，但 `console` 不在 —— 于是给工具链写日志时会报
     * `'console' is not defined`。这是配置漏了一项，不是代码有问题。
     */
    files: ["**/*.mjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly" } }
  },
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      "no-undef": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "react-hooks/static-components": "off",
      "react-hooks/use-memo": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/incompatible-library": "off",
      "react-hooks/immutability": "off",
      "react-hooks/globals": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/error-boundaries": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-render": "off",
      "react-hooks/unsupported-syntax": "off",
      "react-hooks/config": "off",
      "react-hooks/gating": "off"
    }
  },
  {
    files: ["**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off"
    }
  }
)
