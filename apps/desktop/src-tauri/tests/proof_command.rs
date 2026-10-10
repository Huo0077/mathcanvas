//! **受限证明命令的判据**（V2 GREEN 缺口④）。
//!
//! 这里**不需要 Lean、也不需要 mathlib**：被钉住的是"什么文本才允许被执行"与"没配置工具链时怎么答"。
//! 真的去跑一个 Lean 进程是**显式 gated** 的路（要配上 `DRAW_LEAN_LAKE` / `DRAW_LEAN_PROJECT`），
//! 本文件不假装跑过。

use mathcanvas_desktop_lib::proof::{self, source};
use std::path::{Path, PathBuf};

/// 一份**逐字像适配器生成**的文件（`packages/agent-core/src/proof/lean4Adapter.ts` 的两种模板取其一）。
fn template_source(theorem: &str) -> String {
    format!(
        "-- 由 @draw/agent-core 的 Lean 4 适配器生成（N5b）。**每次运行都是新的临时文件**，不进仓库树。\n\
         import Mathlib.Analysis.InnerProductSpace.Orthogonal\n\n\
         set_option maxHeartbeats 400000\n\n\
         theorem {theorem} {{E : Type*}} [NormedAddCommGroup E] [InnerProductSpace ℝ E]\n\
         \x20   (D : Submodule ℝ E) (u v : E) (hu : u ∈ Dᗮ) (hv : v ∈ D) :\n\
         \x20   inner ℝ u v = 0\n\
         \x20 := by\n\
         \x20 rw [Submodule.mem_orthogonal'] at hu\n\
         \x20 exact hu v hv\n\n\
         -- 结构化判据：问内核「这条定理到底依赖什么」。\n\
         #print axioms {theorem}\n"
    )
}

#[test]
fn accepts_a_template_shaped_file() {
    // 白名单里的**每一个**定理名都要收（第三个是 2026-10-10 加的切线/导数那一类）。
    for theorem in source::ALLOWED_THEOREM_NAMES {
        let inspected = source::inspect_template_source(&template_source(theorem));
        assert!(inspected.is_ok(), "{theorem} 应当通过：{inspected:?}");
    }
}

/// **换了数学塔的那一类**（切线/导数）：import 与 `open` 都不同，但它**仍然必须是我们的模板产物**。
///
/// 这条用例是"加第三个类"这块摩擦的落点：新增一类时，**桌面命令的白名单必须显式跟着加**
///（`ALLOWED_IMPORTS` 与 `ALLOWED_THEOREM_NAMES`）—— 忘了加，那一类在桌面侧会被形状检查拒掉，
/// 而这是**故意的**：白名单就是"我们允许执行哪些文本"这件事的唯一记录。
fn tangent_template_source() -> String {
    "-- 由 @draw/agent-core 的 Lean 4 适配器生成（N5b）。**每次运行都是新的临时文件**，不进仓库树。\n\
     import Mathlib.Analysis.Calculus.Deriv.Slope\n\
     open Filter\n\
     open scoped Topology\n\n\
     set_option maxHeartbeats 400000\n\n\
     theorem draw_tangent_slope_goal {f : ℝ → ℝ} {m x : ℝ} (h : HasDerivAt f m x) :\n\
     \x20   Tendsto (slope f x) (nhdsWithin x {x}ᶜ) (𝓝 m)\n\
     \x20 := by\n\
     \x20 exact hasDerivAt_iff_tendsto_slope.mp h\n\n\
     #print axioms draw_tangent_slope_goal\n"
        .to_string()
}

#[test]
fn accepts_the_tangent_class_template() {
    let inspected = source::inspect_template_source(&tangent_template_source());
    assert!(inspected.is_ok(), "切线/导数那一类的模板产物应当通过形状检查：{inspected:?}");
}

#[test]
fn rejects_an_import_that_is_not_on_the_allow_list() {
    // 换一条**不在**白名单里的 import（哪怕它也是 mathlib 的一部分）⇒ 拒。
    // 这条钉的是"白名单就是白名单"：能用 ≠ 允许执行。
    let mutated = tangent_template_source().replace(
        "import Mathlib.Analysis.Calculus.Deriv.Slope",
        "import Mathlib.Analysis.Calculus.Deriv.Basic",
    );
    let inspected = source::inspect_template_source(&mutated);
    assert!(inspected.is_err(), "表外 import ⇒ 拒");
    assert!(inspected.unwrap_err().contains("import"));
}

#[test]
fn rejects_code_execution_syntax() {
    // 这些词在模板产物里**根本不会出现**，而它们能让 Lean 去干编译之外的事。
    for token in ["#eval", "IO.", "unsafe", "extern", "run_cmd", "elab ", "macro ", "initialize "] {
        let mutated = format!("{}\n{token} something\n", template_source(source::ALLOWED_THEOREM_NAMES[0]));
        let inspected = source::inspect_template_source(&mutated);
        assert!(inspected.is_err(), "「{token}」必须被拒");
        assert!(inspected.unwrap_err().contains(token.trim()), "拒绝理由要点名那个词");
    }
}

#[test]
fn rejects_anything_that_is_not_our_template() {
    // ① 没有生成标记；② 不是我们允许的那条 import；③ 两条 import；④ 别的 `set_option`。
    let base = template_source(source::ALLOWED_THEOREM_NAMES[0]);
    let no_marker = base.replacen("-- 由 @draw/agent-core 的 Lean 4 适配器生成（N5b）。**每次运行都是新的临时文件**，不进仓库树。", "-- 随便写的", 1);
    assert!(source::inspect_template_source(&no_marker).is_err(), "没有生成标记 ⇒ 拒");

    let wide_import = base.replace("import Mathlib.Analysis.InnerProductSpace.Orthogonal", "import Mathlib");
    assert!(source::inspect_template_source(&wide_import).is_err(), "不是允许的那一条 import ⇒ 拒");

    let two_imports = base.replace("set_option maxHeartbeats 400000", "import Mathlib.Tactic\nset_option maxHeartbeats 400000");
    assert!(source::inspect_template_source(&two_imports).is_err(), "两条 import ⇒ 拒");

    let odd_option = base.replace("set_option maxHeartbeats 400000", "set_option maxHeartbeats 400000\nset_option pp.all true");
    assert!(source::inspect_template_source(&odd_option).is_err(), "多一条 set_option ⇒ 拒");
}

#[test]
fn rejects_a_report_about_another_theorem() {
    // **这一条最要紧**：报告必须问**白名单里**的定理名。名字对不上就得不到报告，
    // 而「没有报告」在 TS 侧的判据里是**失败**（不是「没有公理所以通过」）。
    let other = template_source("draw_perpendicular_goal").replace("#print axioms draw_perpendicular_goal", "#print axioms some_other_goal");
    let inspected = source::inspect_template_source(&other);
    assert!(inspected.is_err(), "表外定理名 ⇒ 拒");
    assert!(inspected.unwrap_err().contains("some_other_goal"));

    // 报告整条被删掉 ⇒ 也拒（没有证据不等于没有公理）。
    let missing = template_source(source::ALLOWED_THEOREM_NAMES[0]).replace("#print axioms draw_perpendicular_goal\n", "");
    assert!(source::inspect_template_source(&missing).is_err(), "没有 `#print axioms` ⇒ 拒");
}

#[test]
fn rejects_a_heartbeat_budget_that_makes_the_budget_a_decorative_number() {
    let base = template_source(source::ALLOWED_THEOREM_NAMES[0]);
    for value in ["0", "4000001", "abc"] {
        let mutated = base.replace("set_option maxHeartbeats 400000", &format!("set_option maxHeartbeats {value}"));
        assert!(source::inspect_template_source(&mutated).is_err(), "maxHeartbeats={value} ⇒ 拒");
    }
}

#[test]
fn rejects_an_oversized_file() {
    let mut huge = template_source(source::ALLOWED_THEOREM_NAMES[0]);
    huge.push_str(&"-- x".repeat(100_000));
    let inspected = source::inspect_template_source(&huge);
    assert!(inspected.is_err(), "超大文件 ⇒ 拒");
    assert!(inspected.unwrap_err().contains("太大"));
}

#[test]
fn toolchain_is_configured_not_discovered() {
    // 两个都没配 ⇒ 说清"缺哪一个"，而且理由里要点明**不从 PATH 里找**。
    let missing_both = proof::resolve_configuration(&|_| None, &|_| true).unwrap_err();
    assert!(missing_both.contains(proof::LAKE_ENV) && missing_both.contains(proof::PROJECT_ENV));
    assert!(missing_both.contains("PATH"));

    // 只配了一个 ⇒ 点名缺的那个。
    let only_lake = proof::resolve_configuration(&|name| (name == proof::LAKE_ENV).then(|| "C:/lean/lake.exe".to_string()), &|_| true).unwrap_err();
    assert!(only_lake.contains(proof::PROJECT_ENV));

    // 配了但路径不存在 ⇒ 说清是哪一个不存在（不然人只会看到一句"不可用"）。
    let ghost = proof::resolve_configuration(
        &|name| match name {
            proof::LAKE_ENV => Some("C:/nope/lake.exe".to_string()),
            _ => Some("C:/nope/project".to_string()),
        },
        &|_| false,
    )
    .unwrap_err();
    assert!(ghost.contains("C:/nope/lake.exe"));

    // 配好了 ⇒ 原样交回这两个路径（**不做任何推断**，也不去 PATH 里找替补）。
    let configured = proof::resolve_configuration(
        &|name| match name {
            proof::LAKE_ENV => Some("C:/lean/lake.exe".to_string()),
            _ => Some("C:/repo/proof/lean4".to_string()),
        },
        &|path: &Path| path == Path::new("C:/lean/lake.exe") || path == Path::new("C:/repo/proof/lean4"),
    )
    .expect("配好了就应当 Ok");
    assert_eq!(configured.lake, PathBuf::from("C:/lean/lake.exe"));
    assert_eq!(configured.project_dir, PathBuf::from("C:/repo/proof/lean4"));
}

#[test]
fn tail_keeps_the_end_and_does_not_break_utf8() {
    let short = "abc";
    assert_eq!(proof::tail_of(short, 10), "abc");

    // 多字节字符**不许被切坏**（切坏会让下游 JSON 化失败，而那时人只会看到一句莫名其妙的错）。
    let text = "公理".repeat(50);
    let tail = proof::tail_of(&text, 10);
    assert!(tail.ends_with('理'));
    assert!(tail.contains("已省略"));
}

#[tokio::test]
async fn a_file_that_fails_inspection_is_never_executed() {
    // 形状不对的文本**一个字都不执行**：给一个根本不存在、绝不可能跑起来的 lake 路径，
    // 结果仍然是 `Failed` + "没有执行任何东西"，而不是"起不来"。
    let configuration = proof::LeanConfiguration { lake: PathBuf::from("C:/definitely/not/here/lake.exe"), project_dir: PathBuf::from("C:/definitely/not/here") };
    let outcome = proof::run_lean(&configuration, "theorem x : True := by trivial", 1_000).await;
    assert_eq!(outcome.outcome, proof::LeanOutcome::Failed);
    assert!(outcome.detail.contains("没有执行任何东西"), "应当是形状检查拦下的：{}", outcome.detail);
    // **没有版本串**（没跑起来就不知道版本）—— 下游会因此不产出产物，而不是拿一个猜的版本糊过去。
    assert!(outcome.backend_version.is_none());
}

#[tokio::test]
async fn asking_for_the_version_of_a_toolchain_that_is_not_there_is_none_not_a_guess() {
    // 这一条钉的是"版本串要么来自**真的那个二进制**，要么就是没有"：
    // 起不来 ⇒ `None`（不是 `""`、不是 `"unknown"`、更不是从路径名里猜一个）。
    let configuration = proof::LeanConfiguration { lake: PathBuf::from("C:/definitely/not/here/lake.exe"), project_dir: PathBuf::from("C:/definitely/not/here") };
    let version = proof::lean_version(&configuration, 1_000).await;

    assert!(version.is_none(), "起不来就应当是 None，实际是 {version:?}");
}
