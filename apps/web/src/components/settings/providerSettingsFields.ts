/**
 * Provider 设置的**纯函数与常量**（与组件分开的文件）。
 *
 * 为什么单独一个文件：`react-refresh` 要求"只导出组件的文件才能热更新"，
 * 而组件文件里导出 `slug` / `PRESETS` 会让那个文件**整块**失去快速刷新 ——
 * 改一行样式就要刷新整页，而设置表单是有输入状态的（刷新会丢掉用户刚填的东西）。
 * 把纯函数与常量挪出来，组件文件就只剩组件。
 */

import type { ProviderProfile, ProviderProtocol } from "../../services/providerProfileClient"

/** 显示名称 → 稳定标识。中文名字也要能用，所以非 ASCII 一律回退为 `profile`。 */
export function slug(name: string): string {
  const ascii = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  return ascii.length > 0 ? ascii : name.trim().length > 0 ? "profile" : ""
}

/** 把失败原因码翻成一句用户能照做的话。 */
export function reasonFor(code: string, detail: string): string {
  switch (code) {
    case "no_desktop_shell":
      return "密钥与配置需要桌面版（Windows 应用）；当前在浏览器里运行。"
    case "secret_not_allowed":
      return "配置里不能带密钥字段，请把它填在「API key」这一栏。"
    case "ipc_failed":
      return `保存失败：${detail}`
    default:
      return detail
  }
}

/**
 * 预设：常见服务的协议 / 方言 / 基址。**只有这三样**，模型名留给用户填 ——
 * 猜一个模型名比留空更糟（用户会以为"它能用"，直到第一次请求失败）。
 */
export const PRESETS: { label: string; protocol: ProviderProtocol; dialect: ProviderProfile["dialect"]; baseUrl: string; networkPolicy: ProviderProfile["networkPolicy"] }[] = [
  { label: "OpenAI", protocol: "openai_compatible", dialect: "openai_native", baseUrl: "https://api.openai.com/v1", networkPolicy: "cloud" },
  { label: "DeepSeek", protocol: "openai_compatible", dialect: "deepseek", baseUrl: "https://api.deepseek.com/v1", networkPolicy: "cloud" },
  { label: "Moonshot", protocol: "openai_compatible", dialect: "moonshot", baseUrl: "https://api.moonshot.cn/v1", networkPolicy: "cloud" },
  { label: "Anthropic", protocol: "anthropic", dialect: "anthropic_messages", baseUrl: "https://api.anthropic.com/v1", networkPolicy: "cloud" },
  { label: "Ollama（本机）", protocol: "ollama", dialect: "ollama_native", baseUrl: "http://127.0.0.1:11434/v1", networkPolicy: "local" },
  { label: "自定义（OpenAI 兼容）", protocol: "openai_compatible", dialect: "generic_compatible", baseUrl: "", networkPolicy: "cloud" }
]

/** 能力徽章的中文名。四个能力与 `providers::capability` 的闭集逐字对应。 */
export const FEATURE_LABELS: Record<string, string> = { tools: "工具调用", json: "严格 JSON", vision: "图像", streaming: "流式" }

/**
 * 健康状态的中文名。**三态各有各的词**，不把"未知"说成"失败"：
 * "未检测"是"还没试过"，"不可用"是"试过且不行"—— 两者的下一步动作完全不同。
 */
export const HEALTH_LABELS: Record<string, string> = { unknown: "未验证", ok: "可用", degraded: "部分可用", failed: "不可用" }
