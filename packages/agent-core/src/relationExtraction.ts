import type { PlanRelation, PlanRelationKind, PlanRelationTarget } from "./contracts"

/**
 * **从用户原话里抽关系**（设计 2026-10-03 的方案 C，2026-10-03 追加）。
 *
 * ## 为什么最后还是走了这条路
 *
 * 原设计（方案一）让**模型**声明一张 `relations` 表，系统只做覆盖度校对 + 残差核验，
 * 想法是"判据精确、模型也没法糊弄过去"。**实测推翻了它**：用户在真实应用里发
 * 「在四棱锥 P-ABCD 中，PA垂直 平面 ABCD，BC平行 AD，AB垂直AD，画出P-ABCD」，
 * 模型两次都没给出 `relations` —— 即使系统明确告诉它「这次只允许改这几处：envelope.relations」、
 * 并把缺的那两条（perpendicular / parallel）逐条列给它，它仍然只是把同一份计划又发了一遍。
 *
 * 于是那条覆盖度门禁变成了**模型满足不了的关卡**：一份几何完全正确的计划，会因为"没有自证"
 * 而被判失败。这不是 bug，是设计缺陷 —— **质量门禁不能依赖被测方主动配合**。
 *
 * 结论：关系由**系统自己**从原话里读，模型只负责给出满足这些关系的坐标。
 *
 * ## 抽取纪律
 *
 * 1. **只认高精度写法**。`角`（"一角 60°"）、`比`（"比如"）这类噪声词一律不认 —— 踩过：
 *    宽口径直接打红了两个既有夹具。
 * 2. **点名必须真的存在**。名字→下标由调用方给的 `indexOf` 决定；对不上就**不抽**
 *   （宁可少验一条，也不拿错的 targets 去判"关系不成立"）。
 * 3. **抽不到不阻塞**，由调用方把"未核验"如实报出来 —— 空说"已全部核验"是这里最容易犯的错。
 *
 * ## 名字怎么传下去
 *
 * targets 一律写成**下标名** `v0`、`v1`…（与 `relations.ts` / `solid.create_polyhedron` 的
 * `vertices` 口径一致）。名字→下标这一次翻译由本层负责，判据层不再认中文点名。
 */

/**
 * 关系词表：**只在这里定义一次**。顺序有意义（先长后短，避免 `垂直` 抢在 `垂直于` 前面）。
 *
 * `suffix: true` 表示**两个对象都写在词的前面**（`BC与AD等长`、`BC与AD之比`）——
 * 这类词的左侧要取**倒数第二段**，不是紧邻的那一段。实测踩到过：只取紧邻一段时，
 * "BC与AD等长"被读成 `AD`(左) 与 `等`(右)，于是两侧都不是线段，那条关系就废了。
 */
const RELATION_WORDS: readonly { kind: PlanRelationKind; suffix?: boolean; words: readonly string[] }[] = [
  { kind: "perpendicular", words: ["垂直于", "垂直", "⊥"] },
  { kind: "parallel", words: ["平行于", "平行", "∥"] },
  { kind: "coplanar", words: ["共面"] },
  { kind: "equalLength", suffix: true, words: ["长度相等", "线段相等", "边相等", "等长"] },
  { kind: "midpoint", words: ["中点"] },
  { kind: "ratio", suffix: true, words: ["之比", "比值", "比例"] }
]

export interface ExtractedRelation {
  relation: PlanRelation
  /** 这句话里**为什么**抽出它 —— 给日志与调试看，也用来向用户说明"我按什么判的"。 */
  evidence: string
}

export interface RelationExtraction {
  relations: ExtractedRelation[]
  /**
   * 原话里出现了关系词、但**没能**可靠抽成一条关系的原因。
   *
   * 它必须被如实报出来（"这条没被核验"），**不能**当成"已核验通过"。
   */
  unverified: string[]
}

/** 连续的大写字母/数字串（`PA`、`ABCD`、`AD`）—— 几何里点名就是这个形状。 */
function pointRuns(text: string): string[] {
  return [...text.matchAll(/[A-Z][A-Z0-9]*/g)].map((match) => match[0])
}

/** `ABCD` → `["A","B","C","D"]`；单个字母原样返回。 */
function splitRun(run: string): string[] {
  return run.length <= 1 ? [run] : [...run]
}

type Shape = { kind: "point" | "line" | "plane"; names: string[] }

/** 一个连续大写串代表什么：1 个字母 = 点；2 个 = 线段；≥3 个 = 多边形（定平面）。 */
function asShape(run: string, known: (name: string) => boolean): Shape | null {
  const names = splitRun(run)
  if (names.length === 1) return known(names[0]) ? { kind: "point", names } : null
  if (names.length === 2) return names.every(known) ? { kind: "line", names } : null
  return names.length >= 3 && names.every(known) ? { kind: "plane", names } : null
}

export function extractRelations(prompt: string, indexOf: (name: string) => number): RelationExtraction {
  const relations: ExtractedRelation[] = []
  const unverified: string[] = []
  const known = (name: string) => indexOf(name) >= 0
  const vertexTarget = (name: string): PlanRelationTarget => ({ vertex: `v${indexOf(name)}` })

  for (const entry of RELATION_WORDS) {
    for (const word of entry.words) {
      let from = 0
      while (true) {
        const at = prompt.indexOf(word, from)
        if (at < 0) break
        from = at + word.length

        /**
         * 关系词两侧的点名。
         *
         * - **前缀/中缀**（`垂直`、`平行`、`共面`、`中点`）：左侧取**紧邻**的那一段，
         *   右侧取词后第一段。例：`PA垂直 平面 ABCD`、`BC平行 AD`。
         * - **后缀**（`等长`、`之比`）：**两个对象都写在词前面**，词后什么都没有。
         *   例：`BC与AD等长` 在"等长"处看到的是 `leftRuns = ["BC","AD"]`、`rightText = ""`。
         *   所以这两个名字要**都从左窗口取**：第一个是左操作数、第二个是右操作数。
         *   第一版只取紧邻那段，于是 `right = undefined`，整条关系作废（实测踩到）。
         */
        const leftRuns = pointRuns(prompt.slice(Math.max(0, at - 24), at))
        const rightText = prompt.slice(at + word.length, at + word.length + 24)
        // 右侧优先认「平面 / 面 + 点名」这种带前缀的写法，否则取词后第一个点名串。
        const planePrefix = /^\s*(平面|面)\s*([A-Z][A-Z0-9]*)/.exec(rightText)
        const trailing = planePrefix ? planePrefix[2] : pointRuns(rightText).at(0)

        const left = entry.suffix ? leftRuns.at(-2) : leftRuns.at(-1)
        const right = entry.suffix ? leftRuns.at(-1) : trailing
        if (!left || !right) {
          unverified.push(`原话里的「${word}」没有读到两侧的点名，未核验。`)
          continue
        }

        const leftShape = asShape(left, known)
        const rightShape = asShape(right, known)
        if (!leftShape || !rightShape) {
          unverified.push(`原话里的「${word}」（${left} / ${right}）里有点名不在这份计划里，未核验。`)
          continue
        }
        const describe = `${left} ${word} ${right}`

        if (entry.kind === "perpendicular" || entry.kind === "parallel") {
          // 线⊥面 / 线∥面：一侧是线（2 点）、另一侧是面（≥3 点）。
          if (leftShape.kind === "line" && rightShape.kind === "plane") {
            relations.push({ relation: { kind: entry.kind, targets: [...leftShape.names, ...rightShape.names.slice(0, 3)].map(vertexTarget) }, evidence: `${describe}（线 - 平面）` })
            continue
          }
          if (leftShape.kind === "plane" && rightShape.kind === "line") {
            relations.push({ relation: { kind: entry.kind, targets: [...rightShape.names, ...leftShape.names.slice(0, 3)].map(vertexTarget) }, evidence: `${describe}（平面 - 线）` })
            continue
          }
          if (leftShape.kind === "line" && rightShape.kind === "line") {
            relations.push({ relation: { kind: entry.kind, targets: [...leftShape.names, ...rightShape.names].map(vertexTarget) }, evidence: `${describe}（线 - 线）` })
            continue
          }
          unverified.push(`原话里的「${word}」（${left} / ${right}）不是"线-线"或"线-面"，未核验。`)
          continue
        }

        if (entry.kind === "coplanar") {
          const names = [...new Set([...leftShape.names, ...rightShape.names])]
          if (names.length < 4) {
            unverified.push(`原话里的「共面」只读到 ${names.length} 个点（要 ≥4），未核验。`)
            continue
          }
          relations.push({ relation: { kind: "coplanar", targets: names.map(vertexTarget) }, evidence: describe })
          continue
        }

        if (entry.kind === "equalLength" || entry.kind === "ratio") {
          if (leftShape.kind !== "line" || rightShape.kind !== "line") {
            unverified.push(`原话里的「${word}」（${left} / ${right}）两侧不都是线段，未核验。`)
            continue
          }
          relations.push({ relation: { kind: entry.kind, targets: [...leftShape.names, ...rightShape.names].map(vertexTarget) }, evidence: describe })
          continue
        }

        // midpoint：`M是中点 AD` —— 左侧是点、右侧是那条线段。
        if (leftShape.kind === "point" && rightShape.kind === "line") {
          relations.push({
            relation: { kind: "midpoint", targets: [vertexTarget(leftShape.names[0]), ...rightShape.names.map(vertexTarget)] },
            evidence: `${describe}（${left} 是 ${right} 的中点）`
          })
          continue
        }
        unverified.push(`原话里的「中点」（${left} / ${right}）没读成"点 + 线段"，未核验。`)
      }
    }
  }

  return { relations, unverified }
}
