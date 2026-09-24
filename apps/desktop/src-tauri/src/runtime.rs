//! **桌面运行时自述**（Task 1.1 Step 4）。
//!
//! `DesktopRuntime` 回答的是"我现在跑在什么上面、哪些部件是好的"。
//! 计划对它只有两句要求，但两句都是**安全边界**，不是装饰：
//! - "Return **no secret values** and **no filesystem paths outside the app data root**."
//!
//! 所以这个模块把"谁能进这个结构体"收得很窄：
//! - 只带**版本字符串**与**枚举名**，不带任何配置、密钥、令牌或用户内容；
//! - 唯一允许出现的路径是**应用数据根**，而且只以"目录名 + 是否存在"的形式出现 ——
//!   连它的绝对路径都不出去（绝对路径会暴露用户名，而界面上没有任何地方需要它）。
//!
//! 为什么这些值要在 **Rust 侧**算而不是让前端自己猜：WebView2 版本、应用版本、数据根
//! 都只有原生侧知道真值；前端自己写一份就一定会与实际不符（而"自述与实际不符"正是
//! 排障时最误导人的东西）。
//!
//! 为什么 **不**用 `tauri::AppHandle` 取应用版本：那样这个函数就无法在纯单元测试里跑
//! （要起一个真的 Tauri 应用）。版本由调用方传入，`build_runtime_info` 保持**纯函数**，
//! 于是"不会泄露密钥与路径"这条性质可以被测试直接钉住。

use std::path::Path;

use serde::Serialize;

/// 一台机器上**可能安装**的 WebView2 运行时版本键（三处：64 位、32 位视图、当前用户）。
///
/// Edge WebView2 Evergreen 的固定 GUID 是 `{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}`。
const WEBVIEW2_KEYS: [&str; 3] = [
    r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
    r"SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
    r"SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
];

/// 一个部件的健康状态。
///
/// 用**枚举名**而不是布尔：`"ready"` / `"missing"` / `"not_implemented"` 三态在界面与
/// 日志里都能直接读出来，而 `false` 无法区分"没有"与"还没做" —— 那正是本项目里反复
/// 出现的那类"看起来一样、实际完全不同"的东西。
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DesktopComponentHealth {
    /// 现在就能用。
    Ready,
    /// 这台机器上不存在（例如 WebView2 未安装）。
    Missing,
    /// 计划里有、但还没实现。
    NotImplemented,
}

/// 桌面运行时自述。**字段名与前端 `DesktopRuntime` 一一对应**（`snake_case` → camelCase 由 serde 转换）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopRuntimeInfo {
    /// `windows` / `macos` / `linux`（`std::env::consts::OS`，不是猜的）。
    pub platform: String,
    /// 应用版本，来自 `tauri.conf.json` 的 `version`（由调用方传入）。
    pub app_version: String,
    /// 运行时的**形态**：目前只有 `"webview"`（将来若有本地回环代理，会是别的值）。
    pub runtime: String,
    /// WebView2 版本（Windows）或 `"unknown"`。
    pub webview_version: String,
    /// 应用数据根**目录名**（不含绝对路径）。前端只需要知道"数据放哪一类目录"，不需要知道用户目录。
    pub data_root: String,
    pub secret_store: DesktopComponentHealth,
    pub repository: DesktopComponentHealth,
    pub transport: DesktopComponentHealth,
}

/// 从注册表读 WebView2 版本；读不到就 `"unknown"`。
///
/// 非 Windows 直接返回 `"unknown"` —— 这个函数不假装知道别的平台。
#[cfg(windows)]
pub fn detect_webview2_version() -> String {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    for key in WEBVIEW2_KEYS {
        for root in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
            let Ok(opened) = RegKey::predef(root).open_subkey(key) else { continue };
            let Ok(version) = opened.get_value::<String, _>("pv") else { continue };
            if !version.trim().is_empty() {
                return version;
            }
        }
    }
    "unknown".to_string()
}

#[cfg(not(windows))]
pub fn detect_webview2_version() -> String {
    "unknown".to_string()
}

/// 组装自述。
///
/// ## 为什么三个健康字段都是**传进来的**
///
/// 这个函数要保持**纯函数**（同样的输入给同样的输出），而"某个部件到底可不可用"
/// 要么需要碰系统凭据管理器、要么需要一个能被替换的探针。传进来之后，
/// `ready` / `not_implemented` 两条路径都能被测试直接钉住 —— 而不是只能测其中一条。
///
/// ## 一处被这一批修掉的**过时自述**（2026-09-21）
///
/// 在 `repository` 与 `transport` 落地之前，这两个字段是**写死** `not_implemented` 的
/// （当时的注释写着"这两个仍是后续任务的落点"）。它们落地之后没人回来改，
/// 于是自述开始说谎 —— 而这条线上"自述不许猜"是被测过的性质（见下面的用例）。
/// 现在三个字段都如实来自托管状态的实况。
///
/// `data_root` 只接受**目录名**：调用方传进来的如果是绝对路径，这里会取它的最后一段。
/// 这样做是刻意的 —— 即便某天有人图省事把绝对路径传进来，"绝对路径不出边界"这条性质
/// 也不会被破坏（会有一条测试专门盯它）。
pub fn build_runtime_info(app_version: &str, data_root: &Path, secret_store_ready: bool, repository_ready: bool, transport_ready: bool) -> DesktopRuntimeInfo {
    let data_root_name = data_root
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "unknown".to_string());

    let health = |ready: bool| if ready { DesktopComponentHealth::Ready } else { DesktopComponentHealth::NotImplemented };

    DesktopRuntimeInfo {
        platform: std::env::consts::OS.to_string(),
        app_version: app_version.to_string(),
        runtime: "webview".to_string(),
        webview_version: detect_webview2_version(),
        data_root: data_root_name,
        // 密钥库的状态**如实报告**：Windows 凭据管理器可用 → `ready`；
        // 退到内存后端 → `not_implemented`（界面据此告诉用户"这次会话有效，重启要重填"）。
        // 把它们压成一个布尔是刻意的：界面**不需要**知道用的是哪个库，
        // 只需要知道"关掉应用之后还在不在"。
        secret_store: health(secret_store_ready),
        repository: health(repository_ready),
        transport: health(transport_ready),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_the_platform_and_the_requested_version_instead_of_guessing_them() {
        let info = build_runtime_info("0.1.0", Path::new("/home/someone/.mathcanvas"), true, false, false);

        // 平台来自 `std::env::consts::OS`，版本来自调用方 —— 两样都不是这里的字面量。
        assert_eq!(info.platform, std::env::consts::OS);
        assert_eq!(info.app_version, "0.1.0");
        assert_eq!(info.runtime, "webview");
    }

    /// **唯一允许出现的路径**是应用数据根，而且只以**最后一段目录名**出现。
    ///
    /// 路径刻意用 `join` 拼，而不是写 `Path::new(r"C:\Users\...")`：反斜杠在 **Linux 上不是
    /// 分隔符**，那样的字面量在那边只有**一段**，`file_name()` 会返回整串 —— 于是
    /// "只留最后一段"这条断言在 Linux 上必红，而在 Windows 上（本机）一直是绿的。
    /// 这正是 2026-09-25 首次 CI 里 `rust` 作业红掉的原因（cargo 退出码 101）。
    /// `join` 在两边各按自己的分隔符拼出多段路径，测的还是同一件事。
    #[test]
    fn never_leaks_a_filesystem_path_beyond_the_data_root_directory_name() {
        let data_root = Path::new("C:").join("Users").join("someone").join("AppData").join("Roaming").join("com.mathcanvas.app");
        let info = build_runtime_info("0.1.0", &data_root, true, false, false);
        let json = serde_json::to_string(&info).expect("serialize");

        assert_eq!(info.data_root, "com.mathcanvas.app");
        assert!(!json.contains("Users"), "the absolute path leaked: {json}");
        assert!(!json.contains("AppData"), "the absolute path leaked: {json}");
        assert!(!json.contains("someone"), "the user name leaked: {json}");
    }

    /// 三部件各自**如实**报告自己：输入是假就 `not_implemented`，是真就 `ready`。
    ///
    /// ## 这一条在 2026-09-21 改过语义（记下来）
    ///
    /// 原先它断言的是"G1 完成之前三部件必须都说还没实现，不许声称可用"。
    /// 那是一条**会过期的断言**：部件落地之后它要么被删掉，要么（更糟）留着 ——
    /// 而这一次正是"留着"导致了自述说谎：`repository` 与 `transport` 实现完
    /// 却没人回来改那两个写死的字段。
    ///
    /// 现在它测的是那条**不会过期**的性质：三个字段**各自**跟着自己的输入走，
    /// 一个就绪不代表别的也就绪，全就绪时三个都 `ready`。
    #[test]
    fn reports_each_component_from_its_own_input_and_never_guesses() {
        let none = build_runtime_info("0.1.0", Path::new("/tmp/app"), false, false, false);

        assert_eq!(none.secret_store, DesktopComponentHealth::NotImplemented);
        assert_eq!(none.repository, DesktopComponentHealth::NotImplemented);
        assert_eq!(none.transport, DesktopComponentHealth::NotImplemented);

        // **一个部件就绪不代表别的也就绪。**
        let only_secrets = build_runtime_info("0.1.0", Path::new("/tmp/app"), true, false, false);
        assert_eq!(only_secrets.secret_store, DesktopComponentHealth::Ready);
        assert_eq!(only_secrets.repository, DesktopComponentHealth::NotImplemented);
        assert_eq!(only_secrets.transport, DesktopComponentHealth::NotImplemented);

        // "可用却说不可用"与"不可用却说可用"都是自述失真：前者让界面一直提醒用户
        // "重启要重填"（而实际能存住），后者让用户在重启后才发现密钥没了。
        let all = build_runtime_info("0.1.0", Path::new("/tmp/app"), true, true, true);
        assert_eq!(all.secret_store, DesktopComponentHealth::Ready);
        assert_eq!(all.repository, DesktopComponentHealth::Ready);
        assert_eq!(all.transport, DesktopComponentHealth::Ready);

        // 而它们**各自**都能单独翻转 —— 仓储可用、代理起不来是常见的一种组合。
        let no_proxy = build_runtime_info("0.1.0", Path::new("/tmp/app"), true, true, false);
        assert_eq!(no_proxy.repository, DesktopComponentHealth::Ready);
        assert_eq!(no_proxy.transport, DesktopComponentHealth::NotImplemented);
    }

    /// 自述里**只有**这些字段，而且每个值都是版本串、状态枚举或目录名。
    ///
    /// ## 这条用例的第一版是错的（记下来）
    ///
    /// 第一版拿 `json.contains("secret")` 之类的**子串**去扫，结果被自家字段名
    /// `secretStore` 判红 —— 那条断言无法区分"名字里有 secret 的**状态字段**"与
    /// "真的装着密钥的字段"。一条永远会红的断言等于没有断言，所以改成两条能真正区分的检查：
    /// 1. **字段集合闭集**（白名单之外多一个字段就红）；
    /// 2. **值里没有密钥的形状**（没有 `sk-` 前缀、没有长随机串、没有 Authorization 之类）。
    #[test]
    fn carries_only_version_strings_status_enums_and_a_directory_name() {
        let info = build_runtime_info("0.1.0", Path::new("/tmp/app"), false, false, false);
        let value: serde_json::Value = serde_json::to_value(&info).expect("serialize");
        let object = value.as_object().expect("an object");

        let allowed = ["platform", "appVersion", "runtime", "webviewVersion", "dataRoot", "secretStore", "repository", "transport"];
        for key in object.keys() {
            assert!(allowed.contains(&key.as_str()), "unexpected field `{key}` in the runtime info");
        }

        // 值里不许出现密钥的形状。长随机串（32 位以上无空格的 token）是真实密钥最常见的形态。
        let long_random = regex_like_long_random(&value.to_string());
        assert!(!long_random, "a value looks like a secret token: {}", value);
        for prefix in ["sk-", "ghp_", "Authorization", "Bearer "] {
            assert!(!value.to_string().contains(prefix), "a value looks like a credential ({prefix}): {value}");
        }
    }

    /// 不用正则库：判"有没有一段 32 位以上的、由字母数字和 `-` `_` 组成的无空格串"。
    fn regex_like_long_random(text: &str) -> bool {
        let mut run = 0usize;
        for character in text.chars() {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                run += 1;
                if run >= 32 {
                    return true;
                }
            } else {
                run = 0;
            }
        }
        false
    }

    /// 前端拿到的键名是 camelCase（与 `apps/web/src/services/desktopRuntime.ts` 的接口一致）。
    #[test]
    fn serialises_with_the_camel_case_keys_the_web_layer_expects() {
        let info = build_runtime_info("0.1.0", Path::new("/tmp/app"), false, false, false);
        let value: serde_json::Value = serde_json::to_value(&info).expect("serialize");

        for key in ["platform", "appVersion", "runtime", "webviewVersion", "dataRoot", "secretStore", "repository", "transport"] {
            assert!(value.get(key).is_some(), "missing key {key} in {value}");
        }
    }
}
