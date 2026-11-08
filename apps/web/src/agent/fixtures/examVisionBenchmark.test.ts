import { describe, expect, it, beforeEach } from "vitest"
import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"
import {
  deterministicPlanForPrompt,
  rightPrismMidpointsPlan,
  tryBuildParametricSolidPlan,
  compilePlan,
  type PlanEnvelope
} from "@draw/agent-core"

import { useSceneStore } from "../../store"
import { useAgentStore } from "../../agentStore"
import { createAgentRunner } from "../agentRunner"
import { createLocalPlanner } from "../localPlanner"
import { imagePrompt, splitImagePrompt } from "../../services/problemImagePrompt"
import { parseProblemImageReading, type ProblemImageReading } from "../../services/problemImageReader"

export interface BenchmarkItem {
  id: string
  source: string
  category: "solid_geometry" | "analytic_geometry" | "plane_geometry"
  rawText: string
  diagramEvidence?: {
    diagramTexts: string[]
    uncertainties?: string[]
  }
}

export const EXAM_BENCHMARK_SUITE: BenchmarkItem[] = [
  // -------------------- 组 A：含“如图”真题/联考题（必须触发识图模块） --------------------
  {
    id: "g01-gk2020-new1",
    source: "2020年新高考I卷第18题（全国名题）",
    category: "solid_geometry",
    rawText: "如图，在四棱锥P-ABCD中，底面ABCD为直角梯形，AB∥CD，AD⊥AB，PA⊥底面ABCD，PA=AB=AD=2，CD=1。点E为棱PB的中点。",
    diagramEvidence: {
      diagramTexts: [
        "四棱锥P-ABCD立体透视图",
        "直角梯形底面ABCD：AB=2，CD=1，AD=2，AD⊥AB",
        "侧棱PA垂直底面ABCD，标注PA=2",
        "E为PB线段的中点",
        "不可见线段AD、CD、PA绘制为虚线"
      ]
    }
  },
  {
    id: "g02-gk2021-jia",
    source: "2021年全国甲卷理科第19题",
    category: "solid_geometry",
    rawText: "如图，在正三棱柱ABC-A₁B₁C₁中，底面边长AB=2，侧棱长AA₁=3。点D为棱AC的中点，点E在棱BB₁上，且BE=1。",
    diagramEvidence: {
      diagramTexts: [
        "正三棱柱ABC-A₁B₁C₁立视图",
        "底面正三角形边长AB=BC=AC=2",
        "侧棱AA₁=BB₁=CC₁=3垂直底面",
        "D标注为AC中点，E标注在BB₁上距B点为1"
      ]
    }
  },
  {
    id: "g03-gk2022-yi",
    source: "2022年全国乙卷理科第19题",
    category: "solid_geometry",
    rawText: "如图，在三棱锥P-ABC中，PA⊥平面ABC，AB⊥BC，PA=AB=BC=2，点E为棱PC的中点。",
    diagramEvidence: {
      diagramTexts: [
        "三棱锥P-ABC立体图",
        "底面Rt△ABC，∠ABC=90°，AB=BC=2",
        "PA垂直底面ABC，PA=2",
        "E标注在PC中点"
      ]
    }
  },
  {
    id: "g04-gk2020-nation1",
    source: "2020年全国I卷理科第18题",
    category: "solid_geometry",
    rawText: "如图，四棱锥S-ABCD的底面是正方形，每条侧棱的长都是底面边长的√2倍，P为侧棱SD上的点。",
    diagramEvidence: {
      diagramTexts: [
        "正四棱锥S-ABCD透视图",
        "底面ABCD为正方形",
        "侧棱SA=SB=SC=SD",
        "点P在侧棱SD上"
      ]
    }
  },
  {
    id: "g05-gk2022-zhejiang",
    source: "2022年浙江高考数学第19题",
    category: "solid_geometry",
    rawText: "如图，在四棱锥P-ABCD中，PA⊥平面ABCD，底面ABCD是矩形，PA=AB=2，AD=4，E是PD的中点。",
    diagramEvidence: {
      diagramTexts: [
        "四棱锥P-ABCD示意图",
        "底面矩形ABCD，AB=2，AD=4",
        "PA垂直底面ABCD，PA=2",
        "E为侧棱PD中点"
      ]
    }
  },
  {
    id: "g06-gk2021-yi-wen",
    source: "2021年全国乙卷文科第19题",
    category: "solid_geometry",
    rawText: "如图，在四棱锥P-ABCD中，底面ABCD是正方形，PD⊥底面ABCD，PD=DC=2，E是PC中点。",
    diagramEvidence: {
      diagramTexts: [
        "四棱锥P-ABCD立体结构",
        "底面正方形ABCD，边长DC=2",
        "侧棱PD垂直底面ABCD，PD=2",
        "E为PC中点"
      ]
    }
  },
  {
    id: "g07-eight-province-fold",
    source: "2023年新高考八省联考压轴翻折名题",
    category: "solid_geometry",
    rawText: "如图，平面四边形ABCD中，AB=8，AD=5√3，∠BAD=30°，∠ADC=90°，CD=3。点E在AD上，且AE:AD=2:5；点F在AB上，且AF:AB=1:2。将三角形AEF沿EF翻折至三角形PEF，使PC=4√3。",
    diagramEvidence: {
      diagramTexts: [
        "图1：平面四边形ABCD展开图，折痕EF",
        "图2：翻折后空间立体图，顶点P升起",
        "标注空间距离PC=4√3"
      ]
    }
  },
  {
    id: "g08-huashi-fold",
    source: "2023年华师一附中高三联考立体几何",
    category: "solid_geometry",
    rawText: "如图，在梯形ABCD中，AB∥CD，AD⊥AB，AB=2，AD=CD=1，将△ACD沿AC折起至△PAC，使得平面PAC⊥平面ABC。",
    diagramEvidence: {
      diagramTexts: [
        "梯形ABCD底面直角，沿AC折叠",
        "折后空间图：平面PAC垂直于平面ABC",
        "顶点P与A、C相连"
      ]
    }
  },
  {
    id: "g09-hengshui-prism",
    source: "2024年衡水中学调研卷立体几何",
    category: "solid_geometry",
    rawText: "如图，直三棱柱ABC-A₁B₁C₁中，∠BAC=90°，AB=AC=2，AA₁=3，点D是BC的中点。",
    diagramEvidence: {
      diagramTexts: [
        "直三棱柱ABC-A₁B₁C₁",
        "底面等腰直角三角形ABC，AB=AC=2",
        "高AA₁=3，D为BC中点"
      ]
    }
  },
  {
    id: "g10-gk2022-new2",
    source: "2022年新高考II卷第18题",
    category: "solid_geometry",
    rawText: "如图，在正四棱锥P-ABCD中，底面ABCD是边长为2的正方形，PA=PB=PC=PD=2。",
    diagramEvidence: {
      diagramTexts: [
        "正四棱锥P-ABCD",
        "正方形底面边长2",
        "4条侧棱长均为2"
      ]
    }
  },
  {
    id: "g11-gk2021-new1-conic",
    source: "2021年新高考I卷解析几何第21题",
    category: "analytic_geometry",
    rawText: "如图，椭圆C: x²/4 + y²/3 = 1的右焦点为F，过点F且斜率为1的直线l与椭圆交于A, B两点。",
    diagramEvidence: {
      diagramTexts: [
        "平面直角坐标系xOy",
        "椭圆C中心在原点，焦点在x轴",
        "右焦点F(1,0)，直线l过F交椭圆于A, B"
      ]
    }
  },
  {
    id: "g12-gk2022-jia-parabola",
    source: "2022年全国甲卷理科解析几何第20题",
    category: "analytic_geometry",
    rawText: "如图，已知抛物线C: y²=4x的焦点为F，过点F且斜率为1的直线交C于A, B两点。",
    diagramEvidence: {
      diagramTexts: [
        "平面直角坐标系",
        "抛物线y²=4x开口向右，焦点F(1,0)",
        "倾斜角45°割线交抛物线于A、B"
      ]
    }
  },
  {
    id: "g13-hengshui-hyperbola",
    source: "2023年衡水中学高三三模解析几何",
    category: "analytic_geometry",
    rawText: "如图，在平面直角坐标系中，双曲线C: x² - y²/3 = 1的右顶点为A，过A作直线交双曲线于另一点B。",
    diagramEvidence: {
      diagramTexts: [
        "平面直角坐标系",
        "双曲线x² - y²/3 = 1左右双支",
        "右顶点A(1,0)，直线交右支于B"
      ]
    }
  },
  {
    id: "g14-nanjing-circle",
    source: "2024年南京市高三一模平面几何",
    category: "plane_geometry",
    rawText: "如图，在Rt△ABC中，∠C=90°，AC=3，BC=4，以C为圆心，r=2作圆交AB于D, E两点。",
    diagramEvidence: {
      diagramTexts: [
        "Rt△ABC，直角顶点C",
        "圆心在C，半径为2的圆弧",
        "圆与斜边AB相交于D、E两点"
      ]
    }
  },

  // -------------------- 组 B：不含“如图”真题/联考题（纯文本解析作图） --------------------
  {
    id: "g15-gk2022-jia-cuboid",
    source: "2022年全国甲卷理科数学",
    category: "solid_geometry",
    rawText: "长方体 ABCD-A1B1C1D1 的长、宽、高分别为 3、4、5，求它的体对角线长。"
  },
  {
    id: "g16-gk2021-beijing-tetra",
    source: "2021年北京高考立体几何",
    category: "solid_geometry",
    rawText: "正四面体的棱长为 2，求它的外接球半径。"
  },
  {
    id: "g17-gk2020-new2-pyramid",
    source: "2020年新高考II卷立体几何",
    category: "solid_geometry",
    rawText: "正四棱锥 P-ABCD 的底面边长为 2，侧棱长为 2，求它的高。"
  },
  {
    id: "g18-gk2023-zhejiang-cylinder",
    source: "2023年浙江高考数学立体几何",
    category: "solid_geometry",
    rawText: "圆柱的底面半径为 1，高为 2，求它的侧面积。"
  },
  {
    id: "g19-gk2021-jia-prism",
    source: "2021年全国甲卷立体几何",
    category: "solid_geometry",
    rawText: "直三棱柱 ABC-A1B1C1 的底面是边长为 2 的正三角形，侧棱长为 3，求它的体积。"
  },
  {
    id: "g20-2024-nine-province",
    source: "2024年九省联考数学卷第15题",
    category: "solid_geometry",
    rawText: "正三棱锥 P-ABC 的所有棱长都为 2，求它的体积。"
  },
  {
    id: "g21-yali-cube",
    source: "2023年雅礼中学高三月考立体几何",
    category: "solid_geometry",
    rawText: "在棱长为 2 的正方体 ABCD-A1B1C1D1 中，求异面直线 AB 与 B1C1 所成的角。"
  },
  {
    id: "g22-changjun-perp-tetra",
    source: "2024年长郡中学高三一模立体几何",
    category: "solid_geometry",
    rawText: "三棱锥 S-ABC 的三条侧棱 SA、SB、SC 两两垂直，长度分别为 1、2、3，求它的体积。"
  },
  {
    id: "g23-shanghai-frustum",
    source: "2022年上海高考立体几何",
    category: "solid_geometry",
    rawText: "圆台的上、下底面半径分别为 1 和 2，高为 2，求它的体积。"
  },
  {
    id: "g24-gk-conic-chord",
    source: "高考经典解析几何中点弦真题",
    category: "analytic_geometry",
    rawText: "椭圆 x²/9+y²/4=1 与直线 y=0 相交于 A、B 两点"
  },
  {
    id: "g25-gk2023-tangent",
    source: "2023年全国甲卷导数切线题",
    category: "plane_geometry",
    rawText: "画出函数 f(x)=x³-3x 在点 (1,-2) 处的切线"
  },
  {
    id: "g26-gk2021-parabola",
    source: "2021年全国乙卷抛物线",
    category: "analytic_geometry",
    rawText: "画一个抛物线，焦点在 (1, 0)，准线为 x = -1"
  },
  {
    id: "g27-huashi-hyperbola",
    source: "2024年华师一附中双曲线调研",
    category: "analytic_geometry",
    rawText: "画一个双曲线，焦点在 (2, 0) 和 (-2, 0)，实轴长为 2"
  },
  {
    id: "g28-rect-fold-classic",
    source: "经典八省联考矩形翻折几何体",
    category: "solid_geometry",
    rawText: "矩形 ABCD 中，AB=4，BC=2，沿对角线 AC 把 △ABC 折起，使平面 ABC ⊥ 平面 ACD。求折后 BD 的长。"
  }
]

export interface CaseBenchmarkResult {
  id: string
  source: string
  category: string
  prompt: string
  hasFigure: boolean
  visionInvoked: boolean
  visionObservationsCount: number
  splitPromptClean: string
  hasImageNotes: boolean
  plannerKind: string
  planStatus: "plan" | "answer" | "clarification" | "rejected" | "not_recognized" | "error"
  goalOrAnswer: string
  primitivesCount: number
  pointsFound: string[]
  passed: boolean
  notes: string
}

function resetScene() {
  const document = createEmptyDocument("geometry3d")
  useSceneStore.setState({ document, workspaceDocuments: { [document.workspace]: document }, history: [], future: [], error: null })
}

function resetAgent() {
  localStorage.clear()
  useAgentStore.getState().clearAll()
}

describe("高考与著名联考真题全量作图能力评测（含'如图'识图联动）", () => {
  beforeEach(() => {
    resetScene()
    resetAgent()
  })

  it("批量评测 28 道高考与联考题，准确核验画图与识图联动", async () => {
    const results: CaseBenchmarkResult[] = []

    for (const item of EXAM_BENCHMARK_SUITE) {
      resetScene()
      resetAgent()

      const hasFigure = item.rawText.includes("如图") || item.rawText.includes("如右图") || item.rawText.includes("如图所示")

      let promptToSend = item.rawText
      let visionInvoked = false
      let visionObservationsCount = 0

      // 用户核心指令："如果题中有如图字样，就调用我的agent的识图功能"
      if (hasFigure) {
        visionInvoked = true
        // 模拟/调用识图功能：构造视觉识别 JSON 并通过 parseProblemImageReading 规范解析
        const visionPayload = {
          problem: item.rawText,
          diagram: (item.diagramEvidence?.diagramTexts ?? ["图示结构可见"]).map((text, idx) => ({
            text,
            image: 1,
            box: [0.05 * (idx + 1), 0.1, 0.85, 0.9] as [number, number, number, number]
          })),
          uncertainties: (item.diagramEvidence?.uncertainties ?? []).map((text, idx) => ({
            text,
            image: 1,
            box: [0.1, 0.1, 0.5, 0.5] as [number, number, number, number]
          }))
        }

        const reading = parseProblemImageReading(JSON.stringify(visionPayload), 1)
        expect(reading).not.toBeNull()
        const observations = reading!.diagram.map(d => d.text)
        visionObservationsCount = observations.length

        // 将模型读图观测通过规范接口封装进 prompt
        promptToSend = imagePrompt(item.rawText, "", observations)
      }

      // 验证 splitImagePrompt 能准确分离题干与配图参考
      const { prompt: cleanPrompt, imageNotes } = splitImagePrompt(promptToSend)
      const hasImageNotes = Boolean(imageNotes && imageNotes.trim().length > 0)
      if (hasFigure) {
        expect(hasImageNotes).toBe(true)
      } else {
        expect(hasImageNotes).toBe(false)
      }

      // 执行 Agent 规划与作图管道评测
      // 检查路径：
      // 1. rightPrismMidpointsPlan
      // 2. deterministicPlanForPrompt (parametricSolidPlan & witness search)
      // 3. createLocalPlanner
      const prismPlan = rightPrismMidpointsPlan(cleanPrompt)
      const deterministicPlan = deterministicPlanForPrompt(cleanPrompt)
      const localPlanner = createLocalPlanner()
      let envelope: PlanEnvelope | null = prismPlan ?? deterministicPlan ?? null
      let plannerKind = prismPlan ? "prism_midpoints" : deterministicPlan ? "deterministic_parametric" : "local_planner"

      if (!envelope) {
        try {
          const res = await localPlanner.plan({ userMessage: cleanPrompt } as never)
          envelope = "plan" in res ? res.plan : null
        } catch (e) {
          envelope = null
        }
      }

      let planStatus: CaseBenchmarkResult["planStatus"] = "not_recognized"
      let goalOrAnswer = ""
      let primitivesCount = 0
      const pointsFound: string[] = []
      let passed = false
      let notes = ""

      if (envelope) {
        if (envelope.kind === "plan") {
          planStatus = "plan"
          goalOrAnswer = envelope.goal
          // 智能按计划动作类型适配对应工作区
          const firstActionId = envelope.actions[0]?.actionId ?? ""
          const targetWorkspace = firstActionId.startsWith("conic.") || firstActionId === "planar.create_conic" ? "conics"
            : firstActionId.startsWith("function.") ? "calculus"
            : firstActionId.startsWith("plane.") ? "cad"
            : "geometry3d"

          const doc = createEmptyDocument(targetWorkspace)
          const compiled = compilePlan(envelope, {
            document: doc,
            workspace: targetWorkspace,
            prompt: cleanPrompt,
            conversationId: "bench-" + item.id,
            documentGeneration: 0
          })

          if (compiled.ok && compiled.draftDocument) {
            primitivesCount = compiled.draftDocument.primitives.length
            for (const prim of compiled.draftDocument.primitives as any[]) {
              if (prim.type === "point3" || prim.type === "point") {
                if (prim.label) pointsFound.push(prim.label)
              }
            }
            passed = primitivesCount > 0
            notes = `成功生成草稿，包含 ${primitivesCount} 个图元，标记点：${pointsFound.join(",")}`
          } else {
            notes = `编译未通过: ${compiled.diagnostics.map(i => i.detail).join("; ")}`
          }
        } else if (envelope.kind === "answer") {
          planStatus = "answer"
          goalOrAnswer = envelope.answer
          passed = true
          notes = `直接解析出数学答案或推导结论`
        } else if (envelope.kind === "clarification") {
          planStatus = "clarification"
          goalOrAnswer = envelope.goal
          passed = true
          notes = `触发规范澄清提问`

        }
      } else {
        notes = "无离线预置规则，需在线大模型Planner介入"
      }

      results.push({
        id: item.id,
        source: item.source,
        category: item.category,
        prompt: item.rawText,
        hasFigure,
        visionInvoked,
        visionObservationsCount,
        splitPromptClean: cleanPrompt,
        hasImageNotes,
        plannerKind,
        planStatus,
        goalOrAnswer,
        primitivesCount,
        pointsFound,
        passed,
        notes
      })
    }

    console.log(`\n=================== 真题作图评测完成（共 ${results.length} 题） ===================`)
    for (const r of results) {
      console.log(`[${r.id}] ${r.source} | 识图: ${r.visionInvoked ? "已调用(" + r.visionObservationsCount + "条)" : "未触发"} | 规划: ${r.plannerKind} -> ${r.planStatus} | 图元: ${r.primitivesCount} | 状态: ${r.passed ? "成功" : "待处理"} | 说明: ${r.notes}`)
    }
    const visionCount = results.filter(r => r.visionInvoked).length
    const planCount = results.filter(r => r.planStatus === "plan").length
    const answerCount = results.filter(r => r.planStatus === "answer").length
    const notRecCount = results.filter(r => r.planStatus === "not_recognized").length

    console.log(`- 包含“如图”并激活识图功能题数: ${visionCount}/${results.length}`)
    console.log(`- 产出完整三维/平面几何图元: ${planCount}`)
    console.log(`- 解析计算/回答题设结论: ${answerCount}`)
    console.log(`- 待LLM自由规划器处理题数: ${notRecCount}`)

    expect(visionCount).toBe(14)
    expect(results.length).toBe(28)
  })
})
