import { useState } from "react"

import { loadConstrainedDragEnabled, saveConstrainedDragEnabled } from "../../persistence/nextPhasePreferences"

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
 * ## 这里**只**放一个开关，不是五个
 *
 * 另外四个（`obligationIR` / `witnessSearch` / `openProblemCompiler` / `proofExport`）**故意不在这里**：
 * 它们要么还没交付，要么有自己的接线前提（`witnessSearch` 打开会替换被物化的坐标与点名）。
 * 给用户一个"存了就能全开"的面板，等于把四个未完成阶段的路一起打开。
 */
export function ExperimentalFeatures() {
  const [constrainedDrag, setConstrainedDrag] = useState(loadConstrainedDragEnabled)

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
    </section>
  )
}
