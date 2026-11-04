/**
 * Provider 设置的**纯函数与常量**（与组件分开的文件）。
 *
 * 为什么单独一个文件：`react-refresh` 要求"只导出组件的文件才能热更新"，
 * 而组件文件里导出 `slug` / `PRESETS` 会让那个文件**整块**失去快速刷新 ——
 * 改一行样式就要刷新整页，而设置表单是有输入状态的（刷新会丢掉用户刚填的东西）。
 * 把纯函数与常量挪出来，组件文件就只剩组件。
 */

import type { ProviderHealth, ProviderProfile, ProviderProtocol } from "../../services/providerProfileClient"

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
 * 预设保存服务的协议、方言和基址。官方有明确推荐的模型 ID 时提供默认值。
 */
export const PRESETS: { label: string; protocol: ProviderProtocol; dialect: ProviderProfile["dialect"]; baseUrl: string; networkPolicy: ProviderProfile["networkPolicy"]; defaultModelId?: string }[] = [
  { label: "OpenAI", protocol: "openai_compatible", dialect: "openai_native", baseUrl: "https://api.openai.com/v1", networkPolicy: "cloud" },
  { label: "DeepSeek", protocol: "openai_compatible", dialect: "deepseek", baseUrl: "https://api.deepseek.com", networkPolicy: "cloud", defaultModelId: "deepseek-flash" },
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

/** Translate saved evidence without exposing the provider's response body. */
export function providerProbeIssue(health: ProviderHealth, feature?: string): string | undefined {
  const details = health.capabilityEvidence.filter((entry) => entry.status !== "verified" && (!feature || entry.feature === feature))
    .map((entry) => entry.detail ?? "")
  for (const detail of details) {
    const status = /the provider (?:returned|failed|refused the request|rejected the credential|is rate limiting)\s+\(?([45]\d{2})\b/i.exec(detail)?.[1]
    switch (status) {
      case "401": return "服务拒绝了 API Key（HTTP 401）。请检查密钥是否属于这个服务。"
      case "402": return "服务要求支付或充值（HTTP 402）。请检查账户余额。"
      case "403": return "服务拒绝访问（HTTP 403）。请检查账号权限或网络。"
      case "404": return "服务未找到请求的资源（HTTP 404）。请检查接口地址和模型 ID。"
      case "415": return "服务拒绝了请求的内容类型（HTTP 415）。请使用更新后的桌面版重新验证。"
      case "429": return "服务限流（HTTP 429）。请稍后重试。"
    }
    if (status) return `服务拒绝了验证请求（HTTP ${status}）。请检查接口地址和模型配置。`
    if (/has no credential stored/i.test(detail)) return "找不到保存的 API Key。请在模型服务里重新保存。"
    if (/provider could not be reached|probe could not reach the provider/i.test(detail)) return "验证请求未完成。请检查接口地址、密钥和网络后重试。"
    if (/did not read the verification code/i.test(detail)) return "模型未读对测试图的验证码。请确认这个接口的模型支持图像。"
  }
  return undefined
}
