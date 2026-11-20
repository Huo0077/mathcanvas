// Prevents additional console window on Windows in both debug and release, DO NOT REMOVE!!
#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

fn main() {
    mathcanvas_desktop_lib::run();
}
