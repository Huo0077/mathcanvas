//! **受限证明命令的判据**（V2 GREEN 缺口④）。
//!
//! 这里**不需要 Lean、也不需要 mathlib**：被钉住的是"什么文本才允许被执行"与"没配置工具链时怎么答"。
//! 真的去跑一个 Lean 进程是**显式 gated** 的路（要配上 `DRAW_LEAN_LAKE` / `DRAW_LEAN_PROJECT`），
//! 本文件不假装跑过。

use mathcanvas_desktop_lib::proof::{self, source};
use std::path::{Path, PathBuf};

#[derive(serde::Deserialize)]
struct AdmissionFixture {
    name: String,
    source: String,
}

fn admission_fixtures() -> Vec<AdmissionFixture> {
    serde_json::from_str(include_str!("fixtures/lean-admission.json"))
        .expect("generated fixture JSON")
}

fn template_source(theorem: &str) -> String {
    admission_fixtures()
        .into_iter()
        .find(|fixture| {
            fixture
                .source
                .ends_with(&format!("#print axioms {theorem}\n"))
        })
        .expect("every allowed theorem must have a real adapter fixture")
        .source
}

fn tangent_template_source() -> String {
    template_source("draw_tangent_slope_goal")
}

#[test]
fn accepts_a_template_shaped_file() {
    for fixture in admission_fixtures() {
        let inspected = source::inspect_template_source(&fixture.source);
        assert!(
            inspected.is_ok(),
            "real adapter fixture {} must pass: {inspected:?}",
            fixture.name
        );
    }
}

#[test]
fn accepts_the_tangent_class_template() {
    let inspected = source::inspect_template_source(&tangent_template_source());
    assert!(
        inspected.is_ok(),
        "tangent template must pass: {inspected:?}"
    );
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
    for token in [
        "#eval",
        "IO.",
        "unsafe",
        "extern",
        "run_cmd",
        "elab ",
        "macro ",
        "initialize ",
    ] {
        let mutated = format!(
            "{}\n{token} something\n",
            template_source(source::ALLOWED_THEOREM_NAMES[0])
        );
        let inspected = source::inspect_template_source(&mutated);
        assert!(inspected.is_err(), "「{token}」必须被拒");
        assert!(
            inspected.unwrap_err().contains(token.trim()),
            "拒绝理由要点名那个词"
        );
    }
}

#[test]
fn rejects_anything_that_is_not_our_template() {
    // ① 没有生成标记；② 不是我们允许的那条 import；③ 两条 import；④ 别的 `set_option`。
    let base = template_source(source::ALLOWED_THEOREM_NAMES[0]);
    let no_marker = base.replacen("-- 由 @draw/agent-core 的 Lean 4 适配器生成（N5b）。**每次运行都是新的临时文件**，不进仓库树。", "-- 随便写的", 1);
    assert!(
        source::inspect_template_source(&no_marker).is_err(),
        "没有生成标记 ⇒ 拒"
    );

    let wide_import = base.replace(
        "import Mathlib.Analysis.InnerProductSpace.Orthogonal",
        "import Mathlib",
    );
    assert!(
        source::inspect_template_source(&wide_import).is_err(),
        "不是允许的那一条 import ⇒ 拒"
    );

    let two_imports = base.replace(
        "set_option maxHeartbeats 400000",
        "import Mathlib.Tactic\nset_option maxHeartbeats 400000",
    );
    assert!(
        source::inspect_template_source(&two_imports).is_err(),
        "两条 import ⇒ 拒"
    );

    let odd_option = base.replace(
        "set_option maxHeartbeats 400000",
        "set_option maxHeartbeats 400000\nset_option pp.all true",
    );
    assert!(
        source::inspect_template_source(&odd_option).is_err(),
        "多一条 set_option ⇒ 拒"
    );
}

#[test]
fn rejects_a_report_about_another_theorem() {
    // **这一条最要紧**：报告必须问**白名单里**的定理名。名字对不上就得不到报告，
    // 而「没有报告」在 TS 侧的判据里是**失败**（不是「没有公理所以通过」）。
    let other = template_source("draw_perpendicular_goal").replace(
        "#print axioms draw_perpendicular_goal",
        "#print axioms some_other_goal",
    );
    let inspected = source::inspect_template_source(&other);
    assert!(inspected.is_err(), "表外定理名 ⇒ 拒");
    assert!(inspected.unwrap_err().contains("some_other_goal"));

    // 报告整条被删掉 ⇒ 也拒（没有证据不等于没有公理）。
    let missing = template_source(source::ALLOWED_THEOREM_NAMES[0])
        .replace("#print axioms draw_perpendicular_goal\n", "");
    assert!(
        source::inspect_template_source(&missing).is_err(),
        "没有 `#print axioms` ⇒ 拒"
    );
}

#[test]
fn rejects_a_heartbeat_budget_that_makes_the_budget_a_decorative_number() {
    let base = template_source(source::ALLOWED_THEOREM_NAMES[0]);
    for value in ["0", "4000001", "abc"] {
        let mutated = base.replace(
            "set_option maxHeartbeats 400000",
            &format!("set_option maxHeartbeats {value}"),
        );
        assert!(
            source::inspect_template_source(&mutated).is_err(),
            "maxHeartbeats={value} ⇒ 拒"
        );
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
    let only_lake = proof::resolve_configuration(
        &|name| (name == proof::LAKE_ENV).then(|| "C:/lean/lake.exe".to_string()),
        &|_| true,
    )
    .unwrap_err();
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
        &|path: &Path| {
            path == Path::new("C:/lean/lake.exe") || path == Path::new("C:/repo/proof/lean4")
        },
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
    let configuration = proof::LeanConfiguration {
        lake: PathBuf::from("C:/definitely/not/here/lake.exe"),
        project_dir: PathBuf::from("C:/definitely/not/here"),
    };
    let outcome = proof::run_lean(&configuration, "theorem x : True := by trivial", 1_000).await;
    assert_eq!(outcome.outcome, proof::LeanOutcome::Failed);
    assert!(
        outcome.detail.contains("没有执行任何东西"),
        "应当是形状检查拦下的：{}",
        outcome.detail
    );
    // **没有版本串**（没跑起来就不知道版本）—— 下游会因此不产出产物，而不是拿一个猜的版本糊过去。
    assert!(outcome.backend_version.is_none());
}

#[tokio::test]
async fn asking_for_the_version_of_a_toolchain_that_is_not_there_is_none_not_a_guess() {
    // 这一条钉的是"版本串要么来自**真的那个二进制**，要么就是没有"：
    // 起不来 ⇒ `None`（不是 `""`、不是 `"unknown"`、更不是从路径名里猜一个）。
    let configuration = proof::LeanConfiguration {
        lake: PathBuf::from("C:/definitely/not/here/lake.exe"),
        project_dir: PathBuf::from("C:/definitely/not/here"),
    };
    let version = proof::lean_version(&configuration, 1_000).await;

    assert!(version.is_none(), "起不来就应当是 None，实际是 {version:?}");
}

// Nonexecuting mutations: these only exercise admission, never a Lean payload.
#[test]
fn rejects_extra_commands_even_without_blacklisted_words() {
    let base = tangent_template_source();
    for command in [
        "def unrelated : Nat := 1",
        "#check Nat",
        "axiom unrelated : True",
        "namespace Extra",
        "attribute [simp] Nat.add_comm",
    ] {
        for mutated in [
            format!("{base}\n{command}\n"),
            base.replace(
                "theorem draw_tangent",
                &format!("{command}\ntheorem draw_tangent"),
            ),
        ] {
            assert!(
                source::inspect_template_source(&mutated).is_err(),
                "extra command must be rejected: {command}"
            );
        }
    }
}

#[test]
fn rejects_substituted_statements_and_mismatched_template_classes() {
    let base = tangent_template_source();
    let weakened = base.replace(
        "theorem draw_tangent_slope_goal {f : ℝ → ℝ} {m x : ℝ} (h : HasDerivAt f m x) :\n    Tendsto (slope f x) (nhdsWithin x {x}ᶜ) (𝓝 m)",
        "theorem draw_tangent_slope_goal : True"
    ).replace("exact hasDerivAt_iff_tendsto_slope.mp h", "trivial");
    assert_ne!(base, weakened);
    assert!(
        source::inspect_template_source(&weakened).is_err(),
        "a familiar name must not admit a different statement"
    );
    assert!(source::inspect_template_source(&base.replace(
        "#print axioms draw_tangent_slope_goal",
        "#print axioms draw_perpendicular_goal"
    ))
    .is_err());
    assert!(source::inspect_template_source(&base.replace(
        "import Mathlib.Analysis.Calculus.Deriv.Slope",
        "import Mathlib.Analysis.InnerProductSpace.Orthogonal"
    ))
    .is_err());
}

#[test]
fn rejects_comment_wrapping_and_unbounded_proof_syntax() {
    let base = tangent_template_source();
    for mutated in [
        format!("/- {base} -/"),
        base.replacen("-- 由", "由", 1),
        base.replace(
            "exact hasDerivAt_iff_tendsto_slope.mp h",
            "first | exact hasDerivAt_iff_tendsto_slope.mp h | trivial",
        ),
        base.replace(
            "exact hasDerivAt_iff_tendsto_slope.mp h",
            "exact (by trivial)",
        ),
    ] {
        assert!(
            source::inspect_template_source(&mutated).is_err(),
            "non-template syntax must fail closed"
        );
    }
}

#[tokio::test]
async fn extra_commands_fail_before_any_process_or_temp_file() {
    let configuration = proof::LeanConfiguration {
        lake: PathBuf::from("C:/definitely/not/here/lake.exe"),
        project_dir: PathBuf::from("C:/definitely/not/here"),
    };
    let outcome = proof::run_lean(
        &configuration,
        &format!("{}\ndef unrelated : Nat := 1\n", tangent_template_source()),
        1_000,
    )
    .await;
    assert_eq!(outcome.outcome, proof::LeanOutcome::Failed);
    assert!(
        outcome.detail.contains("没有执行任何东西"),
        "must reject at admission: {}",
        outcome.detail
    );
    assert_eq!(outcome.exit_code, None);
    assert_eq!(outcome.duration_ms, 0);
    assert!(outcome.stdout.is_empty() && outcome.stderr.is_empty());
    assert!(outcome.backend_version.is_none());
}

#[test]
fn accepts_only_supported_model_strategies_without_claiming_their_provenance() {
    let model_body = tangent_template_source().replace(
        "exact hasDerivAt_iff_tendsto_slope.mp h",
        "simpa using hasDerivAt_iff_tendsto_slope.mp h",
    );
    assert!(source::inspect_template_source(&model_body).is_ok());
    assert!(source::inspect_template_source(&model_body.replace(".mp h", ".mpr h")).is_err());
}

#[test]
fn rejects_template_drift_in_every_class() {
    for fixture in admission_fixtures() {
        let base = &fixture.source;
        let theorem = base
            .lines()
            .find(|line| line.starts_with("theorem "))
            .unwrap();
        for mutated in [
            base.replace(theorem, &format!("{theorem} extra")),
            base.replace("  := by", "  := by\n  exact unrelated"),
            base.replace("  := by", "  := by\n  /- hidden -/"),
            base.replace(
                "set_option maxHeartbeats 400000",
                "namespace Extra\nset_option maxHeartbeats 400000",
            ),
            format!("{base}\n#print axioms draw_tangent_slope_goal\n"),
        ] {
            assert!(
                source::inspect_template_source(&mutated).is_err(),
                "{} must reject extra syntax",
                fixture.name
            );
        }
        // Comments/CRLF/blank lines need not be byte-identical to be safe.
        let formatted = base
            .replace("  := by", "-- harmless whole-line comment\n  := by")
            .replace('\n', "\r\n");
        assert!(
            source::inspect_template_source(&formatted).is_ok(),
            "{} CRLF/comment",
            fixture.name
        );
    }
}

#[test]
fn proof_points_and_repeated_statement_points_must_keep_the_same_bindings() {
    let base = template_source("draw_perpendicular_goal");
    let changed_proof = base.replace("using hu (D - B) hv", "using hu (B - D) hv");
    assert_ne!(base, changed_proof);
    assert!(source::inspect_template_source(&changed_proof).is_err());
    let changed_conclusion =
        base.replace("inner ℝ (A - P) (D - B) = 0", "inner ℝ (A - P) (B - D) = 0");
    assert_ne!(base, changed_conclusion);
    assert!(source::inspect_template_source(&changed_conclusion).is_err());
    let unbound_point = base.replace("(D : E)", "(Z : E)");
    assert_ne!(base, unbound_point);
    assert!(source::inspect_template_source(&unbound_point).is_err());
}

/// Explicit local smoke: no discovery, downloads, updates, or fabricated proof verdict.
/// The TypeScript axioms checker remains the single mathematical adjudicator.
#[tokio::test]
#[ignore = "requires explicit DRAW_LEAN_LAKE and DRAW_LEAN_PROJECT with an already cached mathlib"]
async fn real_configured_templates_execute_through_desktop_runner() {
    let configuration = proof::resolve_configuration(
        &|key| std::env::var(key).ok(),
        &|path| path.exists(),
    ).expect("configure the existing trusted pinned toolchain/project explicitly; this test never installs them");
    for (index, fixture) in admission_fixtures().into_iter().take(4).enumerate() {
        let timeout_ms = if index == 0 { 900_000 } else { 300_000 };
        let outcome = proof::run_lean(&configuration, &fixture.source, timeout_ms).await;
        println!(
            "REAL_LEAN {} {}",
            fixture.name,
            serde_json::to_string(&outcome).unwrap()
        );
        assert_eq!(
            outcome.outcome,
            proof::LeanOutcome::Exited,
            "{}: {}",
            fixture.name,
            outcome.detail
        );
        assert_eq!(
            outcome.exit_code,
            Some(0),
            "{}: {}",
            fixture.name,
            outcome.stdout
        );
        assert!(outcome
            .backend_version
            .as_deref()
            .is_some_and(|version| version.starts_with("Lean (version ")));
        let report = fixture
            .source
            .lines()
            .find_map(|line| line.strip_prefix("#print axioms "))
            .unwrap();
        assert!(
            outcome.stdout.contains(report),
            "{}: missing raw axioms report",
            fixture.name
        );
    }
}
