//! **模板形状检查**：这份 Lean 文件**是不是我们自己的模板生成的那一种**。
//!
//! 这是"受限"两个字的落点。桌面命令会把这段文本交给编译器执行，所以它必须先回答：
//! **这段文本有没有可能去做编译之外的事**。Lean 能做到（`#eval`、`IO.Process.run`、`@[extern]`…），
//! 所以这里用的是**白名单 + 黑名单两侧都查**：
//!
//! - **白名单**（必须有的）：生成标记、恰好一条允许的 `import`、一条有上限的 `set_option maxHeartbeats`、
//!   一条针对**白名单定理名**的 `#print axioms`。少了任何一条就不是我们的模板产物。
//! - **黑名单**（一个字都不许有）：能执行代码 / 反射 / 扩展语法的那些关键字。
//!
//! **它不判断数学**：这里只看形状。数学那半在 Lean 内核（跑完之后），判据那半在 TS
//!（`checkAxiomsReport`）。这一层**不重复**任何一方的判断。

/// 适配器生成文件的第一行标记（`lean4Adapter.ts` 里的那一串，**逐字**）。
pub const GENERATED_MARKER: &str = "由 @draw/agent-core 的 Lean 4 适配器生成";

/// **允许的 `import`**（都是一条窄导入：整包 Mathlib 要慢约 4 倍，实测）。
///
/// 2026-10-10 加第三类（切线/导数）时从"一条常量"改成"一张表"：那一类**换了一座数学塔**
/// （实分析而不是内积空间），import 与它需要的两行 `open` 都不同。
/// **能用 ≠ 允许执行** —— 表外的 import 一律拒，哪怕它也是 mathlib 的一部分（有用例钉住）。
pub const ALLOWED_IMPORTS: [&str; 2] = [
    "import Mathlib.Analysis.InnerProductSpace.Orthogonal",
    "import Mathlib.Analysis.Calculus.Deriv.Slope",
];

/// **允许出现在 `#print axioms` 后面的定理名**（适配器现在生成的那三个）。
///
/// 加目标类时**必须**在这里加一行 —— 那条摩擦是故意的：这个名字决定"我们能问哪个定理
/// 到底依赖什么公理"，名字对不上就得不到报告，而"没有报告"必须判失败。
pub const ALLOWED_THEOREM_NAMES: [&str; 3] = [
    "draw_perpendicular_goal",
    "draw_line_plane_perpendicular_goal",
    "draw_tangent_slope_goal",
];

/// `maxHeartbeats` 的**上限**：模板默认 400_000；给到 4_000_000 已是很宽的余地。
/// 超过它就拒 —— 那是"把确定性预算当摆设"的写法。
const MAX_HEARTBEATS: u64 = 4_000_000;

/// 文件大小上限（模板生成的文件是几 KB 量级）。
const MAX_SOURCE_BYTES: usize = 200_000;

/// **能执行代码 / 反射 / 扩展语法的关键字**（出现任何一个都拒）。
///
/// 这张表不追求"穷尽 Lean 的所有逃逸路径"（那要靠沙箱，而沙箱实测未做），
/// 它挡的是**从模板正常生成的文本里根本不该出现**的那些词。少一个的代价是明确的：
/// 逃逸路径要绕过白名单（生成标记 + 允许的 import + 白名单定理名）才能进来。
const FORBIDDEN_TOKENS: [&str; 15] = [
    "#eval", "#exec", "#reduce", "#load", "#compile", "IO.", "System.", "unsafe", "extern", "run_cmd", "elab ",
    "macro ", "syntax ", "initialize ", "include ",
];

/// 这份文本是不是**我们的模板生成的那种文件**。`Ok(())` = 形状对得上。
pub fn inspect_template_source(source: &str) -> Result<(), String> {
    if source.len() > MAX_SOURCE_BYTES {
        return Err(format!("文件太大（{} 字节 > 上限 {MAX_SOURCE_BYTES}）—— 模板生成的文件是几 KB 量级。", source.len()));
    }
    let first_content_line = source.lines().find(|line| !line.trim().is_empty()).unwrap_or("");
    if !first_content_line.contains(GENERATED_MARKER) {
        return Err(format!("第一行不是适配器生成标记（期望包含「{GENERATED_MARKER}」）—— 这不是我们的模板产物。"));
    }

    for token in FORBIDDEN_TOKENS {
        if source.contains(token) {
            return Err(format!("出现了不许出现的语法「{token}」—— 模板生成的文件里不会有它，而它能让 Lean 去干编译之外的事。"));
        }
    }

    let imports: Vec<&str> = source.lines().map(str::trim).filter(|line| line.starts_with("import ")).collect();
    if imports.len() != 1 || !ALLOWED_IMPORTS.contains(&imports[0]) {
        return Err(format!("`import` 必须恰好一条且在白名单 {ALLOWED_IMPORTS:?} 里，实际 {imports:?}。"));
    }

    let heartbeats: Vec<&str> = source.lines().map(str::trim).filter(|line| line.starts_with("set_option ")).collect();
    match heartbeats.as_slice() {
        [only] if only.starts_with("set_option maxHeartbeats ") => {
            let value = only.trim_start_matches("set_option maxHeartbeats ").trim();
            let parsed: u64 = value.parse().map_err(|_| format!("`maxHeartbeats` 不是整数：{value:?}"))?;
            if parsed == 0 || parsed > MAX_HEARTBEATS {
                return Err(format!("`maxHeartbeats` = {parsed} 落在允许区间 (0, {MAX_HEARTBEATS}] 之外。"));
            }
        }
        other => return Err(format!("`set_option` 必须恰好一条 `maxHeartbeats`，实际 {other:?}。")),
    }

    let prints: Vec<&str> = source.lines().map(str::trim).filter(|line| line.starts_with("#print axioms ")).collect();
    match prints.as_slice() {
        [only] => {
            let name = only.trim_start_matches("#print axioms ").trim();
            if !ALLOWED_THEOREM_NAMES.contains(&name) {
                return Err(format!("`#print axioms` 后面的定理名「{name}」不在白名单 {ALLOWED_THEOREM_NAMES:?} 里。"));
            }
        }
        other => return Err(format!("`#print axioms` 必须恰好一条，实际 {other:?} —— 没有报告就等于没有证据。")),
    }

    Ok(())
}


