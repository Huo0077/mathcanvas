//! **模板形状检查**：这份 Lean 文件**是不是我们自己的模板生成的那一种**。
//!
//! 这是"受限"两个字的落点。桌面命令会把这段文本交给编译器执行，所以它必须先回答：
//! **这段文本有没有可能去做编译之外的事**。Lean 能做到（`#eval`、`IO.Process.run`、`@[extern]`…），
//! 所以这里用的是**白名单 + 黑名单两侧都查**：
//!
//! - **白名单**（必须有的）：生成标记、恰好一条允许的 `import`、一条有上限的 `set_option maxHeartbeats`、
//!   一条针对**白名单定理名**的 `#print axioms`。少了任何一条就不是我们的模板产物。
//! - **完整模板准入**：导入/open/预算/命题/正文/报告必须按顺序匹配四类有限语法。
//!   模型正文也只能使用显式允许的证明策略；额外命令、任意 Lean 正文不能进入进程。
//! - **黑名单**：保留作提前诊断；安全边界不依赖枚举危险关键字。
//!
//! 这不是 OS 沙箱，仍假设固定工具链、工程与 mathlib 缓存可信。
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

/// **允许出现在 `#print axioms` 后面的定理名**（适配器现在生成的四个）。
///
/// 加目标类时**必须**在这里加一行 —— 那条摩擦是故意的：这个名字决定"我们能问哪个定理
/// 到底依赖什么公理"，名字对不上就得不到报告，而"没有报告"必须判失败。
pub const ALLOWED_THEOREM_NAMES: [&str; 4] = [
    "draw_perpendicular_goal",
    "draw_line_plane_perpendicular_goal",
    "draw_tangent_slope_goal",
    "draw_line_in_plane_goal",
];

/// `maxHeartbeats` 的**上限**：模板默认 400_000；给到 4_000_000 已是很宽的余地。
/// 超过它就拒 —— 那是"把确定性预算当摆设"的写法。
const MAX_HEARTBEATS: u64 = 4_000_000;

/// 文件大小上限（模板生成的文件是几 KB 量级）。
const MAX_SOURCE_BYTES: usize = 200_000;

/// **能执行代码 / 反射 / 扩展语法的关键字**（出现任何一个都拒）。
///
/// 这张表只用于提前给出清楚的拒绝原因，并不穷尽 Lean 的执行语法。
/// 真正的源码准入由后面的完整模板有限语法负责；工具链/工程可信假设与 OS 沙箱边界见模块头。
const FORBIDDEN_TOKENS: [&str; 15] = [
    "#eval",
    "#exec",
    "#reduce",
    "#load",
    "#compile",
    "IO.",
    "System.",
    "unsafe",
    "extern",
    "run_cmd",
    "elab ",
    "macro ",
    "syntax ",
    "initialize ",
    "include ",
];

/// 这份文本是不是**我们的模板生成的那种文件**。`Ok(())` = 形状对得上。
pub fn inspect_template_source(source: &str) -> Result<(), String> {
    if source.len() > MAX_SOURCE_BYTES {
        return Err(format!(
            "文件太大（{} 字节 > 上限 {MAX_SOURCE_BYTES}）—— 模板生成的文件是几 KB 量级。",
            source.len()
        ));
    }
    let first_content_line = source
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("");
    if !first_content_line.trim().starts_with("-- ")
        || !first_content_line.contains(GENERATED_MARKER)
    {
        return Err(format!(
            "第一行不是适配器生成标记（期望包含「{GENERATED_MARKER}」）—— 这不是我们的模板产物。"
        ));
    }

    for token in FORBIDDEN_TOKENS {
        if source.contains(token) {
            return Err(format!("出现了不许出现的语法「{token}」—— 模板生成的文件里不会有它，而它能让 Lean 去干编译之外的事。"));
        }
    }

    let imports: Vec<&str> = source
        .lines()
        .map(str::trim)
        .filter(|line| line.starts_with("import "))
        .collect();
    if imports.len() != 1 || !ALLOWED_IMPORTS.contains(&imports[0]) {
        return Err(format!(
            "`import` 必须恰好一条且在白名单 {ALLOWED_IMPORTS:?} 里，实际 {imports:?}。"
        ));
    }

    let heartbeats: Vec<&str> = source
        .lines()
        .map(str::trim)
        .filter(|line| line.starts_with("set_option "))
        .collect();
    match heartbeats.as_slice() {
        [only] if only.starts_with("set_option maxHeartbeats ") => {
            let value = only.trim_start_matches("set_option maxHeartbeats ").trim();
            let parsed: u64 = value
                .parse()
                .map_err(|_| format!("`maxHeartbeats` 不是整数：{value:?}"))?;
            if parsed == 0 || parsed > MAX_HEARTBEATS {
                return Err(format!(
                    "`maxHeartbeats` = {parsed} 落在允许区间 (0, {MAX_HEARTBEATS}] 之外。"
                ));
            }
        }
        other => {
            return Err(format!(
                "`set_option` 必须恰好一条 `maxHeartbeats`，实际 {other:?}。"
            ))
        }
    }

    let prints: Vec<&str> = source
        .lines()
        .map(str::trim)
        .filter(|line| line.starts_with("#print axioms "))
        .collect();
    match prints.as_slice() {
        [only] => {
            let name = only.trim_start_matches("#print axioms ").trim();
            if !ALLOWED_THEOREM_NAMES.contains(&name) {
                return Err(format!("`#print axioms` 后面的定理名「{name}」不在白名单 {ALLOWED_THEOREM_NAMES:?} 里。"));
            }
        }
        other => {
            return Err(format!(
                "`#print axioms` 必须恰好一条，实际 {other:?} —— 没有报告就等于没有证据。"
            ))
        }
    }

    inspect_bounded_template(source)
}

// Deliberately not a Lean parser. We accept a small closed language consisting of
// four generated statements and explicit proof strategies. Unknown syntax fails
// before writing a temporary source or probing/starting the toolchain.
use std::collections::{BTreeMap, BTreeSet};

const INNER_HEADER: &str = "{E : Type*} [NormedAddCommGroup E] [InnerProductSpace ℝ E]";
const PERP_STATEMENT: &str = "(hu : (POINT_B - POINT_A) ∈ (Submodule.span ℝ ({POINT_Q - POINT_P, POINT_R - POINT_P} : Set E))ᗮ) (hv : (POINT_D - POINT_C) ∈ Submodule.span ℝ ({POINT_Q - POINT_P, POINT_R - POINT_P} : Set E)) : inner ℝ (POINT_B - POINT_A) (POINT_D - POINT_C) = 0";
const LINE_PLANE_STATEMENT: &str = "(h1 : inner ℝ (POINT_B - POINT_A) (POINT_Q - POINT_P) = 0) (h2 : inner ℝ (POINT_B - POINT_A) (POINT_R - POINT_P) = 0) : (POINT_B - POINT_A) ∈ (Submodule.span ℝ ({POINT_Q - POINT_P, POINT_R - POINT_P} : Set E))ᗮ";
const LINE_IN_PLANE_STATEMENT: &str = "(h1 : (POINT_A - POINT_P) ∈ Submodule.span ℝ ({POINT_Q - POINT_P, POINT_R - POINT_P} : Set E)) (h2 : (POINT_B - POINT_P) ∈ Submodule.span ℝ ({POINT_Q - POINT_P, POINT_R - POINT_P} : Set E)) : (POINT_B - POINT_A) ∈ Submodule.span ℝ ({POINT_Q - POINT_P, POINT_R - POINT_P} : Set E)";
const TANGENT_STATEMENT: &str = "{POINT_F : ℝ → ℝ} {m x : ℝ} (h : HasDerivAt POINT_F m x) : Tendsto (slope POINT_F x) (nhdsWithin x {x}ᶜ) (𝓝 m)";

const PERP_PROOF: &str = "simpa [inner_eq_zero_symm] using hu (POINT_D - POINT_C) hv";
const LINE_PLANE_PROOF: &str = "rw [Submodule.mem_orthogonal']
intro y hy
induction hy using Submodule.span_induction with
| mem z hz =>
    rcases hz with rfl | rfl
    · simpa using h1
    · simpa using h2
| zero => simp
| add x y hx hy ihx ihy => rw [inner_add_right, ihx, ihy, add_zero]
| smul a x hx ih => rw [inner_smul_right, ih, mul_zero]";
const LINE_IN_PLANE_PROOF: &str =
    "have h : POINT_B - POINT_A = (POINT_B - POINT_P) - (POINT_A - POINT_P) := by abel
rw [h]
exact Submodule.sub_mem _ h2 h1";
const TANGENT_PROOF: &str = "exact hasDerivAt_iff_tendsto_slope.mp h";

// ASCII identifiers match lean4Adapter.assertPointName. Everything else is a
// literal token: strings, block comments, attributes and new syntax cannot hide
// inside an identifier or become an unchecked suffix. Whitespace is immaterial
// to admission; Lean still decides whether the layout elaborates successfully.
fn tokens(text: &str) -> Vec<String> {
    let mut result = Vec::new();
    let mut word = String::new();
    for ch in text.chars() {
        if ch.is_ascii_alphanumeric() || ch == '_' || ch == '\'' {
            word.push(ch);
        } else {
            if !word.is_empty() {
                result.push(std::mem::take(&mut word));
            }
            if !ch.is_whitespace() {
                result.push(ch.to_string());
            }
        }
    }
    if !word.is_empty() {
        result.push(word);
    }
    result
}

fn identifier(name: &str) -> bool {
    let mut chars = name.chars();
    matches!(chars.next(), Some(ch) if ch.is_ascii_alphabetic() || ch == '_')
        && chars.all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '\'')
}

fn match_pattern(
    actual: &[String],
    pattern: &str,
    bindings: &mut BTreeMap<String, String>,
) -> bool {
    let expected = tokens(pattern);
    actual.len() == expected.len()
        && actual.iter().zip(expected).all(|(value, token)| {
            if token.starts_with("POINT_") {
                if !identifier(value) {
                    return false;
                }
                match bindings.get(&token) {
                    Some(bound) => bound == value,
                    None => {
                        bindings.insert(token, value.clone());
                        true
                    }
                }
            } else {
                value == &token
            }
        })
}

fn inspect_bounded_template(source: &str) -> Result<(), String> {
    // Only whole-line comments are supported. No block-comment/string stripping:
    // accepting a normalized shadow of a different Lean program would be unsafe.
    let lines: Vec<&str> = source
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with("--"))
        .collect();
    let theorem_name = lines
        .last()
        .and_then(|line| line.strip_prefix("#print axioms "))
        .ok_or("模板必须以针对自身定理的 #print axioms 结束")?;
    let tangent = theorem_name == ALLOWED_THEOREM_NAMES[2];
    let prelude: &[&str] = if tangent {
        &[ALLOWED_IMPORTS[1], "open Filter", "open scoped Topology"]
    } else {
        &[ALLOWED_IMPORTS[0]]
    };
    if !lines.starts_with(prelude) {
        return Err("模板的 import/open 必须与目标类一致，且只能出现在固定位置".into());
    }
    let body_start = prelude.len() + 1; // The bounded heartbeat line was checked above.
    if !lines
        .get(prelude.len())
        .is_some_and(|line| line.starts_with("set_option maxHeartbeats "))
    {
        return Err("模板预算必须紧跟 import/open".into());
    }
    let proof_separator = lines
        .iter()
        .position(|line| *line == ":= by")
        .filter(|index| *index > body_start && *index + 1 < lines.len() - 1)
        .ok_or("模板必须包含非空命题和 := by 证明正文")?;
    let statement = tokens(&lines[body_start..proof_separator].join("\n"));
    let header = tokens(&format!(
        "theorem {theorem_name} {}",
        if tangent { "" } else { INNER_HEADER }
    ));
    if !statement.starts_with(&header) {
        return Err("定理声明必须与 #print axioms 的目标类、名字及类型前缀一致".into());
    }
    let mut rest = &statement[header.len()..];
    let mut declared = BTreeSet::new();
    if !tangent {
        // Every point binder is exactly '(name : E)'; no types/terms supplied by a caller.
        while rest.len() >= 5
            && rest[0] == "("
            && identifier(&rest[1])
            && rest[2] == ":"
            && rest[3] == "E"
            && rest[4] == ")"
        {
            if !declared.insert(rest[1].clone()) || declared.len() > 7 {
                return Err("模板点名绑定必须唯一，且不得超过七个".into());
            }
            rest = &rest[5..];
        }
        if declared.is_empty() {
            return Err("模板缺少点名绑定".into());
        }
    }
    let (statement_pattern, proof_pattern) = match theorem_name {
        name if name == ALLOWED_THEOREM_NAMES[0] => (PERP_STATEMENT, PERP_PROOF),
        name if name == ALLOWED_THEOREM_NAMES[1] => (LINE_PLANE_STATEMENT, LINE_PLANE_PROOF),
        name if name == ALLOWED_THEOREM_NAMES[2] => (TANGENT_STATEMENT, TANGENT_PROOF),
        name if name == ALLOWED_THEOREM_NAMES[3] => (LINE_IN_PLANE_STATEMENT, LINE_IN_PLANE_PROOF),
        _ => return Err("未知模板目标类".into()),
    };
    let mut bindings = BTreeMap::new();
    if !match_pattern(rest, statement_pattern, &mut bindings)
        || (!tangent && bindings.values().cloned().collect::<BTreeSet<_>>() != declared)
    {
        return Err("命题不是对应目标类的生成模板，或包含额外/未绑定变量".into());
    }
    let proof = tokens(&lines[proof_separator + 1..lines.len() - 1].join("\n"));
    // Provenance is not inferred here: a model may supply a supported strategy.
    // No arbitrary tactic, term elaborator, declaration or command is accepted.
    let alternatives: &[&str] = if tangent {
        &[
            TANGENT_PROOF,
            "simpa using hasDerivAt_iff_tendsto_slope.mp h",
        ]
    } else {
        &[proof_pattern]
    };
    if !alternatives
        .iter()
        .any(|pattern| match_pattern(&proof, pattern, &mut bindings.clone()))
    {
        return Err(
            "证明正文不在受限策略白名单内；没有执行任何 Lean 代码。模型正文也只能使用支持的策略"
                .into(),
        );
    }
    Ok(())
}
