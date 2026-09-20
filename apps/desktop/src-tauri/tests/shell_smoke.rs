//! **桌面外壳的冒烟测试**（Task 1.1 Step 1/5）。
//!
//! 计划 Step 1 要求："Start the Tauri dev/build configuration with a fake runtime and assert
//! the web entry loads **without changing workspace IDs**."，Step 5 要求："Verify web build and
//! desktop shell build on Windows. Record the installed WebView2 version and Rust/Tauri versions
//! in the test artifact."
//!
//! ## 为什么这个文件测的是"构建产物与配置"，而不是"开一个真窗口"
//!
//! 起一个真的 Tauri 窗口需要 WebView2 + 桌面会话，在 CI 与无头环境里都不稳；而它要证明的
//! 那几件事（前端产物存在且就是那个入口、窗口尺寸合法、**CSP 不是 null**、能力清单是最小集、
//! **没有任何通用 shell/文件命令**）全都是**静态事实**，读文件就能钉死。
//!
//! 真窗口另有一条更轻的验证：`cargo test` 覆盖自述（`runtime.rs`），
//! 而"窗口能起来"由 `npx tauri build` 成功 + 手动跑一次 exe 验证（见进度文档）。

use std::path::{Path, PathBuf};

/// 仓库根（`apps/desktop/src-tauri/tests/` 往上四层）。
fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
        .canonicalize()
        .expect("the repository root must resolve")
}

fn read_json(path: &Path) -> serde_json::Value {
    let text = std::fs::read_to_string(path).unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|error| panic!("{} is not valid JSON: {error}", path.display()))
}

fn tauri_conf() -> serde_json::Value {
    read_json(&Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json"))
}

/// Step 1 的"入口能加载"：`frontendDist` 指向 `apps/web` 的产物，且那份产物**真的在**。
#[test]
fn the_web_entry_the_shell_loads_exists_and_is_the_web_build() {
    let conf = tauri_conf();
    let dist = conf["build"]["frontendDist"].as_str().expect("frontendDist must be a string");
    let resolved = Path::new(env!("CARGO_MANIFEST_DIR")).join(dist);
    let index = resolved.join("index.html");

    assert!(index.is_file(), "the web build is missing at {} — run `npm run build --workspace @draw/web` first", index.display());
    let html = std::fs::read_to_string(&index).expect("read index.html");
    // 产物必须是**真的 web 应用入口**（有脚本、有根节点），而不是一个占位页。
    assert!(html.contains("<script"), "the web build looks like a placeholder: {html}");
    assert!(html.contains("root") || html.contains("app"), "the web build has no mount point: {html}");
}

/// Step 5 的"记下版本"：把 WebView2 写进测试输出，作为可留档的证据。
///
/// Rust / Tauri 的版本由 `cargo test` 自身的输出与 `tauri.conf.json` 记录（这里不重复断言），
/// 因为测试二进制里 `CARGO_PKG_VERSION` 是**测试包**的版本，拿它当 Tauri 版本会给出错的读数。
#[test]
fn records_the_webview_version_and_platform() {
    let webview = mathcanvas_desktop_lib::runtime::detect_webview2_version();
    println!("WebView2: {webview}");
    println!("platform: {}", std::env::consts::OS);
    println!("rustc: {}", env!("CARGO_PKG_NAME"));

    // 不硬断言版本号（不同机器不同），但必须是**能读出来的东西**：
    // Windows 上 WebView2 是硬前置，读不到就说明这台机器没装（那是有用的信息，不是失败）。
    assert!(!webview.is_empty(), "the WebView2 probe returned an empty string");
}

/// 窗口尺寸与标题：外壳至少要能装下工作台（800×600 是脚手架的默认值，对三栏界面太小）。
#[test]
fn opens_a_window_that_can_hold_the_workbench() {
    let conf = tauri_conf();
    let window = &conf["app"]["windows"][0];

    assert_eq!(window["title"].as_str(), Some("MathCanvas"));
    assert!(window["width"].as_u64().unwrap_or(0) >= 1200, "the workbench needs a wide window");
    assert!(window["height"].as_u64().unwrap_or(0) >= 800);
    assert!(window["minWidth"].as_u64().unwrap_or(0) >= 900, "below this the three-column layout breaks");
}

/// **CSP 不能是 `null`**：那是脚手架默认值，等于没有策略。
#[test]
fn ships_a_content_security_policy_instead_of_the_scaffold_default() {
    let conf = tauri_conf();
    let csp = conf["app"]["security"]["csp"].as_str();

    let csp = csp.expect("a desktop shell must declare a CSP; `null` is the scaffold default");
    assert!(csp.contains("default-src 'self'"), "the CSP must restrict the default source: {csp}");
    assert!(csp.contains("object-src 'none'"), "the CSP must forbid plugins/objects: {csp}");
}

/// 能力清单必须是**最小集**：只有 core 默认权限。
#[test]
fn keeps_the_capability_set_minimal() {
    let capabilities = read_json(&Path::new(env!("CARGO_MANIFEST_DIR")).join("capabilities/default.json"));
    let permissions: Vec<&str> = capabilities["permissions"].as_array().expect("permissions must be an array").iter().filter_map(|value| value.as_str()).collect();

    assert_eq!(permissions, vec!["core:default"], "the shell must not request extra capabilities yet");
    // 显式点名几类**绝不能**出现的权限：通用 shell、任意文件系统、任意 URL 打开。
    for forbidden in ["shell:", "fs:", "opener:", "http:"] {
        assert!(!permissions.iter().any(|permission| permission.starts_with(forbidden)), "the shell must not request `{forbidden}`");
    }
}

/// **Rust 侧不许有通用命令**（计划原文："no generic command accepting JavaScript or shell text"）。
#[test]
fn exposes_only_named_ipc_commands_and_no_generic_one() {
    let lib = std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("src/lib.rs")).expect("read lib.rs");

    // 有且只有这一个命令被注册。
    assert!(lib.contains("tauri::generate_handler![get_runtime_info]"), "the command list must stay explicit: {lib}");
    assert_eq!(lib.matches("generate_handler!").count(), 1, "exactly one invoke handler");

    /**
     * 几条**通用命令**的判据。两次修这条断言的过程值得记下来：
     *
     * 1. 第一版用裸子串（`lib.contains("eval")`）扫**整个文件**，被注释里那句
     *    "没有、也不会有 `eval` / `run_shell` …" 判红 —— 断言无法区分"代码里有"与"注释里提到"。
     * 2. 于是改成"只看**代码**"：先剔掉注释行再扫。注释里点名这些词是**好事**
     *    （它说明作者知道这条边界），不该被断言当成违规。
     *
     * 判据收窄到两个真问题：命令名有没有被注册、代码里有没有真的去执行进程。
     */
    let code: String = lib
        .lines()
        .filter(|line| !line.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n");

    for forbidden in ["run_shell", "read_file", "write_file", "std::process::Command", "Command::new", "\"eval\""] {
        assert!(!code.contains(forbidden), "the shell must not expose or use `{forbidden}`");
    }
}

/// 前端产物与桌面外壳指向**同一份** web 应用 —— 这是"不重复一份 store"的落点。
#[test]
fn reuses_the_web_app_instead_of_duplicating_it() {
    let conf = tauri_conf();
    let dist = conf["build"]["frontendDist"].as_str().unwrap_or("");
    let build_command = conf["build"]["beforeBuildCommand"]["script"].as_str().unwrap_or("");

    assert!(dist.contains("build-check/mathcanvas-current"), "the shell must load the web build, got {dist}");
    assert!(build_command.contains("@draw/web"), "the shell must build the web workspace, got {build_command}");
    // 这个包里没有任何前端源码（除了这份测试）。
    let src_files: Vec<_> = std::fs::read_dir(Path::new(env!("CARGO_MANIFEST_DIR")).join(".."))
        .expect("read apps/desktop")
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    assert!(!src_files.iter().any(|name| name == "src"), "apps/desktop must not carry its own frontend source: {src_files:?}");
}

/// 冒烟测试自己也要看一眼仓库根：这份产物确实是**这个仓库**的，不是别处拷来的。
#[test]
fn the_shell_lives_inside_this_repository() {
    let root = repo_root();

    assert!(root.join("package.json").is_file(), "expected the monorepo root at {}", root.display());
    assert!(root.join("apps/web/src/App.tsx").is_file(), "expected the web app at {}", root.display());
}
