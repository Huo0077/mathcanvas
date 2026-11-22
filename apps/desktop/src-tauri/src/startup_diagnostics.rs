//! 桌面壳启动诊断与异常保护。
//!
//! Windows GUI 进程（`windows_subsystem = "windows"`）在无控制台时若发生启动失败或 panic，
//! 默认会无声退出（用户表现为"闪退"）。本模块在崩溃或初始化失败时写入本地 `crash.log`，
//! 并在 Windows 上弹出明确错误提示，便于定位而非无提示闪退。

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

fn crash_log_path() -> PathBuf {
    #[cfg(target_os = "windows")]
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        return PathBuf::from(local_app_data).join("MathCanvas").join("crash.log");
    }
    if let Some(xdg) = std::env::var_os("XDG_DATA_HOME") {
        return PathBuf::from(xdg).join("MathCanvas").join("crash.log");
    }
    if let Some(home) = std::env::var_os("HOME") {
        return PathBuf::from(home).join(".mathcanvas").join("crash.log");
    }
    std::env::temp_dir().join("mathcanvas-crash.log")
}

pub fn append_crash_log(kind: &str, message: &str) {
    log::error!("[MathCanvas][{kind}] {message}");
    let path = crash_log_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs());
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(file, "[{timestamp}] [{kind}] {message}");
    }
}

pub fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let location = info
            .location()
            .map(|loc| format!("{}:{}:{}", loc.file(), loc.line(), loc.column()))
            .unwrap_or_else(|| "unknown".to_string());
        let payload = if let Some(text) = info.payload().downcast_ref::<&str>() {
            (*text).to_string()
        } else if let Some(text) = info.payload().downcast_ref::<String>() {
            text.clone()
        } else {
            "non-string panic payload".to_string()
        };
        append_crash_log("panic", &format!("at {location}: {payload}"));
        previous(info);
    }));
}

#[cfg(target_os = "windows")]
fn show_windows_error_dialog(title: &str, body: &str) {
    #[link(name = "user32")]
    extern "system" {
        fn MessageBoxW(hwnd: isize, text: *const u16, caption: *const u16, utype: u32) -> i32;
    }
    let title_wide: Vec<u16> = title.encode_utf16().chain(std::iter::once(0)).collect();
    let body_wide: Vec<u16> = body.encode_utf16().chain(std::iter::once(0)).collect();
    const MB_OK_ERROR: u32 = 0x0000_0010;
    // SAFETY: 传入以 0 结尾的有效 UTF-16 只读缓冲区，hwnd=0 为系统模态提示框。
    unsafe {
        MessageBoxW(0, body_wide.as_ptr(), title_wide.as_ptr(), MB_OK_ERROR);
    }
}

pub fn report_fatal_startup_error(detail: &str) {
    append_crash_log("startup_error", detail);
    eprintln!("[MathCanvas] fatal startup error: {detail}");
    #[cfg(target_os = "windows")]
    {
        let log_path = crash_log_path();
        let message = format!(
            "MathCanvas 桌面端启动失败。\n\n原因：{detail}\n\n诊断日志：{}\n建议关闭后台残留的 MathCanvas 进程后重试。",
            log_path.display()
        );
        show_windows_error_dialog("MathCanvas 启动异常", &message);
    }
}
