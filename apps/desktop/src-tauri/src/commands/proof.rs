//! **受限的证明运行命令**（V2 GREEN 缺口④）。
//!
//! 逻辑在 `crate::proof`（那里写清了"为什么必须窄"）。这一层只做三件事：
//! 解析配置（**不从 PATH 里找**）、把请求交给 `proof::run_lean`、把结果原样交回前端。
//!
//! **它不是通用命令**：不接受任意 Lean 文件（形状检查在跑之前）、不接受 shell 文本、
//! 不接受可执行文件路径 —— 跑什么由 `DRAW_LEAN_LAKE` / `DRAW_LEAN_PROJECT` 决定，不由请求决定。

use crate::proof::{self, LeanOutcome, LeanRunOutcome};

/// **跑一次受限的 Lean 检查**。
///
/// `timeout_ms` 由调用方给（前端有它自己的预算），但**上限**在这里再夹一次（10 分钟）——
/// 前端传一个巨大的数不该能把进程永远挂着。
#[tauri::command]
pub async fn check_lean_proof(source: String, timeout_ms: Option<u64>) -> Result<LeanRunOutcome, String> {
    let configuration = match proof::resolve_configuration(&|name| std::env::var(name).ok(), &|path| path.exists()) {
        Ok(configuration) => configuration,
        Err(reason) => {
            // **"没配置"不是错误，是一种结局**：前端要能把它与"证不出来"分开显示。
            return Ok(LeanRunOutcome {
                outcome: LeanOutcome::Unavailable,
                exit_code: None,
                stdout: String::new(),
                stderr: String::new(),
                duration_ms: 0,
                detail: reason,
            });
        }
    };
    let budget = timeout_ms.unwrap_or(proof::DEFAULT_TIMEOUT_MS).min(600_000);
    Ok(proof::run_lean(&configuration, &source, budget).await)
}

/// 让"这台机器上配没配工具链"这件事**可以被前端问一次**（免得它先跑一次才知道）。
#[tauri::command]
pub fn lean_proof_availability() -> Result<LeanRunOutcome, String> {
    match proof::resolve_configuration(&|name| std::env::var(name).ok(), &|path| path.exists()) {
        Ok(configuration) => Ok(LeanRunOutcome {
            outcome: LeanOutcome::Unavailable,
            exit_code: None,
            stdout: String::new(),
            stderr: String::new(),
            duration_ms: 0,
            detail: format!(
                "配好了：lake={}、工程={}。**配好不等于能证出来** —— 真的跑一次才知道（而且冷缓存的第一次会撞超时）。工具链版本与 mathlib revision 的固定仍属「默认启用前」那批审查。",
                configuration.lake.display(),
                configuration.project_dir.display()
            ),
        }),
        Err(reason) => Ok(LeanRunOutcome {
            outcome: LeanOutcome::Unavailable,
            exit_code: None,
            stdout: String::new(),
            stderr: String::new(),
            duration_ms: 0,
            detail: reason,
        }),
    }
}
