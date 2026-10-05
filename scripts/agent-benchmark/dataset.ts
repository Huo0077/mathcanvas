import schema from "./dataset.schema.json"
import { assertNoSecrets } from "./redaction"

/**
 * **benchmark 题集**（实施计划 N4 的 `BenchmarkCase` / JSONL 读取）。
 *
 * ## 词表只有一处：`dataset.schema.json`
 *
 * 类别清单、必需字段、允许的 workspace 全部**从 schema 文件读**，不在这个文件里再写一遍。
 * 两处各写一份必然分叉，而分叉的表现是"schema 说合法、校验器说非法"这类最难查的不一致。
 *
 * ## 为什么坏输入是**抛**而不是返回错误数组
 *
 * 题集是**喂给 benchmark 的输入**：解析出一半、另一半悄悄丢掉，会得到一份"看起来跑完了、
 * 其实少了几道题"的报告 —— 那正是本项目最忌讳的静默丢数据。所以这里一次把所有问题列齐、
 * 然后抛。
 */

export interface BenchmarkCase {
  id: string
  category: string
  workspace: string
  prompt: string
  /** 给人看的：这条题在测什么。不参与判分。 */
  note?: string
}

export class BenchmarkDatasetError extends Error {
  constructor(problems: readonly string[]) {
    super(`题集不合法（${problems.length} 处）：\n- ${problems.join("\n- ")}`)
    this.name = "BenchmarkDatasetError"
  }
}

export const BENCHMARK_CATEGORIES: readonly string[] = schema.properties.category.enum
export const BENCHMARK_CASE_REQUIRED_FIELDS: readonly string[] = schema.required
const ALLOWED_WORKSPACES: readonly string[] = schema.properties.workspace.enum
const ALLOWED_FIELDS = new Set(Object.keys(schema.properties))

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

/**
 * 解析 JSONL 题集。空行忽略；其余每行必须是一条合法 `BenchmarkCase`。
 *
 * @param where 出错时点名的位置（哪份题集），便于直接定位。
 */
export function parseBenchmarkDataset(text: string, where = "题集"): BenchmarkCase[] {
  const problems: string[] = []
  const cases: BenchmarkCase[] = []
  const seenIds = new Set<string>()

  const lines = text.split(/\r?\n/)
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim()
    if (line.length === 0) continue
    const lineNumber = index + 1

    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch (error) {
      problems.push(`第 ${lineNumber} 行不是合法 JSON：${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      problems.push(`第 ${lineNumber} 行必须是一个对象`)
      continue
    }

    const record = parsed as Record<string, unknown>
    for (const field of BENCHMARK_CASE_REQUIRED_FIELDS) {
      if (!nonEmptyString(record[field])) problems.push(`第 ${lineNumber} 行缺少必填字段 ${field}（或它不是非空字符串）`)
    }
    for (const field of Object.keys(record)) {
      if (!ALLOWED_FIELDS.has(field)) problems.push(`第 ${lineNumber} 行有未声明的字段 ${field}`)
    }
    if (nonEmptyString(record.category) && !BENCHMARK_CATEGORIES.includes(record.category)) {
      problems.push(`第 ${lineNumber} 行的 category「${record.category}」不在词表里：${BENCHMARK_CATEGORIES.join(" / ")}`)
    }
    if (nonEmptyString(record.workspace) && !ALLOWED_WORKSPACES.includes(record.workspace)) {
      problems.push(`第 ${lineNumber} 行的 workspace「${record.workspace}」不在词表里：${ALLOWED_WORKSPACES.join(" / ")}`)
    }
    if (nonEmptyString(record.id)) {
      if (seenIds.has(record.id)) problems.push(`第 ${lineNumber} 行的 id「${record.id}」重复了 —— 报告里两条记录会分不清谁是谁`)
      seenIds.add(record.id)
    }
    // 凭据检查放在最后：它抛自己的错误，所以要先把这一行的形状问题收集完。
    if (nonEmptyString(record.prompt)) {
      try {
        assertNoSecrets(String(record.prompt), `${where} 第 ${lineNumber} 行`)
      } catch (error) {
        problems.push(error instanceof Error ? error.message : String(error))
      }
    }

    if (BENCHMARK_CASE_REQUIRED_FIELDS.every((field) => nonEmptyString(record[field]))) {
      cases.push({
        id: record.id as string,
        category: record.category as string,
        workspace: record.workspace as string,
        prompt: record.prompt as string,
        ...(nonEmptyString(record.note) ? { note: record.note } : {})
      })
    }
  }

  if (problems.length > 0) throw new BenchmarkDatasetError(problems)
  return cases
}

/** 覆盖矩阵：七类各几道题。**缺哪一类要说出来**，而不是让"题集跑完了"掩盖覆盖不足。 */
export function categoryCoverage(cases: readonly BenchmarkCase[]): { category: string; count: number; covered: boolean }[] {
  return BENCHMARK_CATEGORIES.map((category) => {
    const count = cases.filter((entry) => entry.category === category).length
    return { category, count, covered: count > 0 }
  })
}
