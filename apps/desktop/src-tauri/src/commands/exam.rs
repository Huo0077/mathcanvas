//! **受闸的四族真题评测入口**（Task 20；2026-10-16，用户选 B：由命令行启动、由系统按下开关）。
//!
//! ## 为什么入口必须放在桌面壳里
//!
//! 这一跑的 provider 解析与密钥借出**只发生在 Rust 侧**（`active_provider_profile` 读配置、
//! `provider_run` 借出密钥并在一次 HTTP 之内用掉）。前端在浏览器里跑不通这条通道 ——
//! 那正是"在命令行里读不到「使用中」那份配置"的原因。
//!
//! ## 为什么不让前端把报告写到任意路径
//!
//! 本模块的第一条纪律与 `lib.rs` 开头那段相同：**只暴露具名 IPC，没有泛型的文件命令**。
//! 所以路径**只从启动参数来**（`--exam-run <报告路径>`），前端拿到的两样东西是：
//!
//! - `exam_run_target`：这次启动**是不是**评测跑、以及报告该写到哪（只读）；
//! - `exam_run_finish`：把报告交回来，由 Rust 写到**启动参数给的那一个路径**，然后退出。
//!
//! 前端**没有**"写任意文件"的能力：它交的是一段文本，路径不由它决定。这条边界与
//! `shell_smoke.rs` 里"没有通用 shell/文件读写出口"是同一条。

use std::path::PathBuf;

/// 启动参数带来的评测目标（`None` = 这次就是普通启动，前端据此什么都不做）。
pub struct ExamRunState {
    pub(crate) target: Option<PathBuf>,
}

impl ExamRunState {
    /// 从命令行参数里读 `--exam-run <路径>`。
    ///
    /// **只认恰好两个词的形式**：`--exam-run` 后面必须跟一个非空路径，否则当作没给
    /// （宁可不开跑，也不要"猜一个路径"——报告写丢比不跑更糟）。
    pub fn from_args<I: IntoIterator<Item = String>>(args: I) -> Self {
        let collected: Vec<String> = args.into_iter().collect();
        let target = collected
            .windows(2)
            .find(|pair| pair[0] == "--exam-run" && !pair[1].trim().is_empty())
            .map(|pair| PathBuf::from(&pair[1]));
        Self { target }
    }
}

/// **这次启动是不是评测跑**：是就把报告路径给前端（前端据此决定要不要跑）。
#[tauri::command]
pub fn exam_run_target(state: tauri::State<'_, ExamRunState>) -> Option<String> {
    state.target.as_ref().map(|path| path.display().to_string())
}

/**
 * **把报告写到启动参数给的那个路径，然后退出**。
 *
 * 退出放在这里（而不是让前端再调一次"退出"）：跑完就是跑完，多一步就多一个
 * "跑完了但窗口还开着"的状态 —— 那种状态正是无人值守的评测跑最容易被误读的样子。
 */
#[tauri::command]
pub fn exam_run_finish(
    app: tauri::AppHandle,
    state: tauri::State<'_, ExamRunState>,
    report: String,
) -> Result<String, String> {
    let target = state
        .target
        .as_ref()
        .ok_or_else(|| "this build was not started with --exam-run, so there is nowhere to write the report".to_string())?;
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            return Err(format!("the report directory {} does not exist", parent.display()));
        }
    }
    std::fs::write(target, report).map_err(|error| format!("cannot write {}: {error}", target.display()))?;
    let written = target.display().to_string();
    app.exit(0);
    Ok(written)
}

#[cfg(test)]
mod tests {
    use super::ExamRunState;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|entry| entry.to_string()).collect()
    }

    #[test]
    fn reads_the_report_path_after_the_flag() {
        let state = ExamRunState::from_args(args(&["mathcanvas-desktop.exe", "--exam-run", "C:/tmp/report.json"]));
        assert_eq!(state.target, Some(std::path::PathBuf::from("C:/tmp/report.json")));
    }

    #[test]
    fn a_plain_launch_has_no_target() {
        assert_eq!(ExamRunState::from_args(args(&["mathcanvas-desktop.exe"])).target, None);
    }

    #[test]
    fn refuses_to_guess_a_path() {
        // 后面没跟路径、或者跟了个空串：都当作**没给**（宁可不开跑，也不要把报告写丢）。
        assert_eq!(ExamRunState::from_args(args(&["mathcanvas-desktop.exe", "--exam-run"])).target, None);
        assert_eq!(ExamRunState::from_args(args(&["mathcanvas-desktop.exe", "--exam-run", "  "])).target, None);
    }
}
