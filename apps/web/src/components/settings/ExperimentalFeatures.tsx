import { useState } from "react"

import { loadConstrainedDragEnabled, loadProofExportEnabled, loadWitnessSearchEnabled, saveConstrainedDragEnabled, saveProofExportEnabled, saveWitnessSearchEnabled } from "../../persistence/nextPhasePreferences"

/**
 * **设置 → 实验性功能**（N3 的第一个产品入口，2026-10-05，用户批准）。
 *
 * ## 为什么需要它
 *
 * "约束拖动"这个能力**代码在、却没有入口** —— `agentNextPhaseFlags()` 一直返回全关的一份，
 * 而 `App.tsx` 关着时走的是原来的 `translatePrimitive3`。没有入口，浏览器验收就写不出来
 *（`docs/current-status.md` §一.2 第 1 条）。
 *
 * ## 为什么这个开关必须**说清两边各是什么行为**
 *
 * 它**会换掉拖动路径**。一个只有"约束拖动"四个字的开关，用户没法判断该不该开，
 * 也就没法在出问题时知道"关掉它会不会回到原样"。所以文案里两句都要有：
 * **关着是原来的自由拖动，打开是沿约束走**（并占一步撤销）。
 *
 * ## 状态从哪来
 *
 * 挂载时**读存储**（不是自己存一份默认值）—— 存储是唯一的事实来源，
 * 而"读不出来就是关"的口径在 `nextPhasePreferences.ts` 里。
 * 点一下**先写存储再更新界面**的顺序不重要，但两件事都必须发生。
 *
 * ## 为什么这里只有三个开关，不是五个
 *
 * `constrainedDrag` / `witnessSearch` / `proofExport` 都有真实执行路径与产品入口，但都默认关；
 * 见证搜索仅限有界题型的候选救援，可能替换模型给的坐标；
 * **形式证明导出**会在跑完作图之后去起一个 Lean 进程（只有桌面版能真跑），
 * 两条都必须显式选择。`obligationIR` / `openProblemCompiler` 没有可用的用户任务入口，
 * 不因这一页保存的偏好而被打开。
 */
export function ExperimentalFeatures() {
  const [constrainedDrag, setConstrainedDrag] = useState(loadConstrainedDragEnabled)
  const [witnessSearch, setWitnessSearch] = useState(loadWitnessSearchEnabled)
  const [proofExport, setProofExport] = useState(loadProofExportEnabled)

  return (
    <section className="experimental-features" aria-label="实验性功能">
      <h3>实验性功能</h3>
      <p>这些开关会改变画布的行为，默认都是关的。打开哪一个，就只有哪一个生效。</p>
      <label className="experimental-feature-row">
        <span className="experimental-feature-text">
          <strong>约束拖动</strong>
          <span className="experimental-feature-hint">
            关着：拖动几何点就是原来的自由拖动。打开：拖动受约束的点时，它会沿约束走（并且占一步撤销）。
          </span>
        </span>
        <input
          type="checkbox"
          role="switch"
          aria-label="约束拖动"
          aria-checked={constrainedDrag}
          checked={constrainedDrag}
          onChange={(event) => {
            const next = event.target.checked
            setConstrainedDrag(next)
            saveConstrainedDragEnabled(next)
          }}
        />
      </label>
      <label className="experimental-feature-row">
        <span className="experimental-feature-text">
          <strong>示意图见证搜索</strong>
          <span className="experimental-feature-hint">
            关着：使用原来的候选图核验。打开：仅当候选不满足题设时尝试寻找另一组坐标；只覆盖部分棱锥题型，不保证所有高中题都能画。题设核验和手动确认不会跳过。
          </span>
        </span>
        <input
          type="checkbox"
          role="switch"
          aria-label="示意图见证搜索"
          aria-checked={witnessSearch}
          checked={witnessSearch}
          onChange={(event) => {
            const next = event.target.checked
            saveWitnessSearchEnabled(next)
            setWitnessSearch(loadWitnessSearchEnabled())
          }}
        />
      </label>
      <label className="experimental-feature-row">
        <span className="experimental-feature-text">
          <strong>形式证明导出</strong>
          <span className="experimental-feature-hint">
            关着：跑完作图不会调用证明后端。打开：题面里那一条能形式化的目标会顺手去证一次（只有桌面版能真跑），
            结果与"正文是谁给的、系统替你选了哪些值"一起摆在确认面板上。原题其余题设不会进命题，所以那是这一条目标的形式证明，不等于整题已证明；作图与人工确认都不受影响。
          </span>
        </span>
        <input
          type="checkbox"
          role="switch"
          aria-label="形式证明导出"
          aria-checked={proofExport}
          checked={proofExport}
          onChange={(event) => {
            const next = event.target.checked
            saveProofExportEnabled(next)
            setProofExport(loadProofExportEnabled())
          }}
        />
      </label>
    </section>
  )
}
