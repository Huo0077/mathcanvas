//! **受限的证明运行**（V2 GREEN 缺口④：桌面侧要有一个"能跑 Lean"的入口，而且它必须是**窄的**）。
//!
//! ## 这一层为什么必须存在，以及为什么必须**窄**
//!
//! Lean 跑不起来的地方是浏览器（要 7.5 GB 的 mathlib 与一个原生工具链），所以"产品能不能自动证明"
//! 最终落在一个**桌面命令**上。但"把一段文本交给编译器执行"本身就是一个**代码执行面** ——
//! Lean 不是计算器：`#eval`、`IO.Process.run`、`@[extern]` 都能让它去干编译之外的事。
//! 所以这条命令**不接受任意 Lean 文件**，它只接受**我们自己的模板生成的那种文件**：
//!
//! 1. **形状必须对得上模板**（`source.rs`：必须带生成标记、恰好一条允许的 `import`、
//!    一条有上限的 `maxHeartbeats`、一条针对**白名单定理名**的 `#print axioms`）；
//! 2. **不许出现能执行代码的语法**（`#eval` / `IO.` / `extern` / `elab` / `macro` …一律拒）；
//! 3. **工具链是"配上去的"，不是"从 PATH 里捡来的"**（下面 `resolve_configuration`）——
//!    从 PATH 捡一个叫 `lake` 的东西，等于让任何能改 PATH 的人决定我们执行什么；
//! 4. **墙钟上限 + 输出上限**：超时杀进程、输出只留尾部（不留半成品证明）。
//!
//! ## 这一层**不做判定**
//!
//! 它只回答"进程怎么结束的"（`outcome` + `exit_code` + stdout/stderr）。**"这条证明算不算成立"
//! 的判定在 TS 侧**（`checkAxiomsReport`：报告里的公理必须全在白名单里）——
//! 判据只有一处，Rust 这边**不复制**一份。所以这里没有 `verified` 这个词：
//! `exit=0` **不等于**证明成立（`sorry` 也是 `exit=0`）。

pub mod source;

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// **默认墙钟上限**：与 TS 侧适配器的默认预算同一个量级（180 s）。
///
/// 注意它**不是**"证明要跑多久"的估计：实测本机热缓存下一次真证明约 68 s，
/// 而**冷缓存的第一趟**会撞上这个上限（要先把 mathlib 的 olean 读进页缓存）。那种情况如实报 `timeout`。
pub const DEFAULT_TIMEOUT_MS: u64 = 180_000;

/// 输出只留尾部这么多**字节**（判据要的 `#print axioms` 那几行在尾部）。
const OUTPUT_TAIL_BYTES: usize = 4_000;

/// 工具链的**配置**（不是"找到的"）。两个环境变量名写在这里，别处不许再写一份。
pub const LAKE_ENV: &str = "DRAW_LEAN_LAKE";
pub const PROJECT_ENV: &str = "DRAW_LEAN_PROJECT";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LeanConfiguration {
    /// `lake` 可执行文件的绝对路径。
    pub lake: PathBuf,
    /// 跑 `lake env lean` 时的工作目录（那个带 `lakefile.toml` 的 Lean 工程）。
    pub project_dir: PathBuf,
}

/// 进程怎么结束的。**没有 `verified`** —— 判定不在这里（见模块头）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LeanOutcome {
    /// 进程正常退出（`exit_code` 是它自己报的）。
    Exited,
    /// 起不来（配置指的文件不存在、没有执行权限…）。
    Failed,
    /// 撞上墙钟上限、已被杀。
    Timeout,
    /// **没有配置工具链** —— 这不是"证不出来"，是"这台机器上没配"。两者对用户意义完全不同。
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LeanRunOutcome {
    pub outcome: LeanOutcome,
    pub exit_code: Option<i32>,
    /// 尾部（最长 `OUTPUT_TAIL_BYTES`），**不是**全文：产物判据只读尾部那几行。
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u64,
    /// 给人看的一句话（缺配置时写清**缺哪一个**）。
    pub detail: String,
}

/// **从环境变量解析配置**（注入 `get` 与 `exists`，所以这条判据可以在任何机器上跑）。
///
/// 缺任何一个 ⇒ `Err(说明缺哪一个)`。**刻意不做 PATH 搜索**：理由写在模块头第 3 条。
pub fn resolve_configuration(
    get: &dyn Fn(&str) -> Option<String>,
    exists: &dyn Fn(&Path) -> bool,
) -> Result<LeanConfiguration, String> {
    let lake = get(LAKE_ENV).filter(|value| !value.trim().is_empty());
    let project = get(PROJECT_ENV).filter(|value| !value.trim().is_empty());
    if lake.is_none() || project.is_none() {
        let missing = match (lake.is_none(), project.is_none()) {
            (true, true) => format!("{LAKE_ENV} 与 {PROJECT_ENV} 都没配"),
            (true, false) => format!("{LAKE_ENV} 没配"),
            _ => format!("{PROJECT_ENV} 没配"),
        };
        return Err(format!(
            "{missing} —— 桌面侧**不从 PATH 里找** Lean（那等于让任何能改 PATH 的人决定我们执行什么）。没配置就不是「证不出来」，而是这台机器上没配。"
        ));
    }
    let (Some(lake), Some(project)) = (lake, project) else {
        unreachable!("上面已判过两个都配了才会走到这里")
    };
    let lake = PathBuf::from(lake);
    if !exists(&lake) {
        return Err(format!("{LAKE_ENV} 指的路径不存在：{}", lake.display()));
    }
    let project_dir = PathBuf::from(project);
    if !exists(&project_dir) {
        return Err(format!("{PROJECT_ENV} 指的目录不存在：{}", project_dir.display()));
    }
    Ok(LeanConfiguration { lake, project_dir })
}

/// 只留**尾部**若干字节（按字符边界切，别把 UTF-8 切坏）。
pub fn tail_of(text: &str, max_bytes: usize) -> String {
    if text.len() <= max_bytes {
        return text.to_string();
    }
    let mut start = text.len() - max_bytes;
    while start < text.len() && !text.is_char_boundary(start) {
        start += 1;
    }
    format!("…（前 {} 字节已省略）\n{}", start, &text[start..])
}

fn temp_file_path() -> PathBuf {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!("draw-lean4-{}-{stamp}.lean", std::process::id()))
}

/// **跑一次**：先查形状（`source::inspect_template_source`），再起进程。
///
/// 形状不对 ⇒ `Failed`（**不执行任何东西**）。配置没配好 ⇒ `Unavailable`（`run_lean` 的调用方
/// 应当先用 `resolve_configuration` 决定这件事；这里再兜一次是为了没有"跳过检查直接跑"的路）。
pub async fn run_lean(configuration: &LeanConfiguration, source: &str, timeout_ms: u64) -> LeanRunOutcome {
    if let Err(reason) = source::inspect_template_source(source) {
        return LeanRunOutcome {
            outcome: LeanOutcome::Failed,
            exit_code: None,
            stdout: String::new(),
            stderr: String::new(),
            duration_ms: 0,
            detail: format!("生成的命题文件没有通过模板形状检查（**没有执行任何东西**）：{reason}"),
        };
    }

    let file = temp_file_path();
    if let Err(error) = std::fs::write(&file, source) {
        return LeanRunOutcome {
            outcome: LeanOutcome::Failed,
            exit_code: None,
            stdout: String::new(),
            stderr: String::new(),
            duration_ms: 0,
            detail: format!("临时命题文件写不出来：{error}"),
        };
    }

    let started = Instant::now();
    let outcome = spawn_and_wait(configuration, &file, timeout_ms, started).await;
    // 无论什么结局都清掉临时文件（那个目录里只有我们写的这一个文件）。
    let _ = std::fs::remove_file(&file);
    outcome
}

async fn spawn_and_wait(configuration: &LeanConfiguration, file: &Path, timeout_ms: u64, started: Instant) -> LeanRunOutcome {
    let mut command = tokio::process::Command::new(&configuration.lake);
    // **固定 argv**：`lake env lean <临时文件>`。没有 shell、没有可拼接的参数。
    command.arg("env").arg("lean").arg(file);
    command.current_dir(&configuration.project_dir);
    command.stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped());
    command.kill_on_drop(true);

    let child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            return LeanRunOutcome {
                outcome: LeanOutcome::Failed,
                exit_code: None,
                stdout: String::new(),
                stderr: String::new(),
                duration_ms: started.elapsed().as_millis() as u64,
                detail: format!("起不来：{}（{}）", configuration.lake.display(), error),
            }
        }
    };

    match tokio::time::timeout(Duration::from_millis(timeout_ms.max(1)), child.wait_with_output()).await {
        Err(_) => LeanRunOutcome {
            outcome: LeanOutcome::Timeout,
            exit_code: None,
            stdout: String::new(),
            stderr: String::new(),
            duration_ms: started.elapsed().as_millis() as u64,
            detail: format!("进程级墙钟超时（{timeout_ms} ms）：已杀进程，**不返回半成品证明**。"),
        },
        Ok(Err(error)) => LeanRunOutcome {
            outcome: LeanOutcome::Failed,
            exit_code: None,
            stdout: String::new(),
            stderr: String::new(),
            duration_ms: started.elapsed().as_millis() as u64,
            detail: format!("等进程结束时出错：{error}"),
        },
        Ok(Ok(output)) => LeanRunOutcome {
            outcome: LeanOutcome::Exited,
            exit_code: output.status.code(),
            stdout: tail_of(&String::from_utf8_lossy(&output.stdout), OUTPUT_TAIL_BYTES),
            stderr: tail_of(&String::from_utf8_lossy(&output.stderr), OUTPUT_TAIL_BYTES),
            duration_ms: started.elapsed().as_millis() as u64,
            detail: "进程跑完了。**这还不是判定** —— 「证明成没成立」看 TS 侧对 `#print axioms` 报告的判据（`exit=0` 连 `sorry` 都满足）。".to_string(),
        },
    }
}
