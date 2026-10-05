/**
 * **凭据检查**（实施计划 N4 的 RED 之一："包含 secret 时报告生成必须失败"）。
 *
 * ## 为什么 benchmark 要专门查这个
 *
 * 题集是从**真实报障原话**里长出来的，而用户贴原话时经常顺手把 key 一起贴进来；运行记录里
 * 还会有 provider 的响应片段。这些一旦落进仓库就是永久泄漏（git 历史删不掉）。
 * 所以两道口子都查：题集解析时查，报告生成时查。
 *
 * ## 判据是"看起来像凭据"，不是"我知道它是凭据"
 *
 * 只认几种**结构明确**的形状（见 `SECRET_PATTERNS`），不做熵估计 —— 熵估计会把
 * 一串普通十六进制 id 误判成密钥，而误判的代价是"合法题集跑不了"，比漏判更常见。
 * 漏判的那部分由 `assertNoSecrets` 的**失败方向**兜底：它抛异常，不静默。
 */

export interface SecretFinding {
  /** 命中的模式名（机器可读，测试与文案都按它分流）。 */
  name: string
  /** 在原文里的下标，便于定位。 */
  index: number
}

/**
 * 只认结构明确的几种。
 *
 * `generic-env-secret` 是唯一"看着宽"的一条：`SOMETHING_API_KEY=...` 这种赋值形态，
 * 因为 npm/环境变量片段被贴进原话是最常见的泄漏方式。
 */
const SECRET_PATTERNS: readonly { name: string; pattern: RegExp }[] = [
  { name: "openai-style-key", pattern: /\bsk-[A-Za-z0-9_-]{16,}/g },
  { name: "bearer-token", pattern: /\bBearer\s+[A-Za-z0-9._-]{16,}/g },
  { name: "aws-access-key-id", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/g },
  { name: "private-key-block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: "generic-env-secret", pattern: /\b[A-Z][A-Z0-9_]*(?:_API_KEY|_SECRET|_TOKEN|_PASSWORD)\s*[:=]\s*\S{8,}/g }
]

/** 找出所有像凭据的片段。**不改写文本** —— 调用方要么拒绝、要么自己决定怎么脱敏。 */
export function findSecrets(text: string): SecretFinding[] {
  const found: SecretFinding[] = []
  for (const { name, pattern } of SECRET_PATTERNS) {
    // 每次从新的一份正则开始：带 /g 的正则会在多次调用之间记住 lastIndex。
    const scanner = new RegExp(pattern.source, pattern.flags)
    let match = scanner.exec(text)
    while (match !== null) {
      found.push({ name, index: match.index })
      if (match.index === scanner.lastIndex) scanner.lastIndex += 1
      match = scanner.exec(text)
    }
  }
  return found.sort((first, second) => first.index - second.index)
}

/**
 * 发现凭据就**抛**（不是返回布尔值）：这两道口子的调用方没有"发现了但继续"这个选项，
 * 而返回布尔值一定会有人忘记检查。
 *
 * @param where 出错时点名的位置（哪份题集 / 哪一轮记录），便于直接定位。
 */
export function assertNoSecrets(text: string, where: string): void {
  const found = findSecrets(text)
  if (found.length === 0) return
  const names = [...new Set(found.map((entry) => entry.name))].join("、")
  throw new Error(`${where} 里出现了疑似凭据（${names}）：题集与运行记录都不许把密钥写进仓库。`)
}
