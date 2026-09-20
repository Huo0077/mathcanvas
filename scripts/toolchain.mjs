#!/usr/bin/env node
/**
 * **给 Rust / Node 工具链补 PATH 的统一入口**。
 *
 * ## 为什么需要它（三个真实踩到的坑，都是环境问题而不是代码问题）
 *
 * 1. **cargo 找不到**：Rust 是 `winget install Rustlang.Rustup` 装的，它把
 *    `%USERPROFILE%\.cargo\bin` 只写进**用户级 PATH**。于是"安装 Rust 之前就开着的进程"
 *    看不到 `cargo`，`tauri build` 会失败在 `failed to run 'cargo metadata' …: program not found`。
 * 2. **npm 找不到**：Tauri 的 `beforeBuildCommand` 会去起 `npm`。而 `npm` 与 `node` 同目录
 *    （`D:\nodejs\npm.cmd`），那个目录**不一定在子进程的 PATH 里** —— 实测报
 *    `'npm' is not recognized as an internal or external command`。
 * 3. **npx 不可靠**：第一版包装用 `npx tauri`，同样报 `'npx' is not recognized`。
 *
 * 三个坑的成因是同一个：**父进程的 PATH 不等于子进程的 PATH**。所以只做一件事 ——
 * 在**子进程的环境**里，把 `node` 所在目录与 `cargo` 的 bin 目录补到最前面，
 * 然后直接执行入口文件（不经 shell、不依赖 `node_modules/.bin` 的布局）。
 *
 * 它**不装东西、不改全局环境、不改用户的 shell 配置**，只影响这一次子进程。
 *
 * 用法：
 * ```
 * node scripts/toolchain.mjs tauri build --no-bundle
 * node scripts/toolchain.mjs cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
 * ```
 */
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { homedir } from "node:os"
import { delimiter, dirname, join } from "node:path"

const require = createRequire(import.meta.url)

/** `node` 所在目录（`npm` / `npx` 与它同级，所以补它一个就够）。 */
function nodeBinDir() {
  return dirname(process.execPath)
}

/** cargo 的 bin 目录。找不到返回 `null` —— 不猜别的位置。 */
function cargoBinDir() {
  const candidates = [
    process.env.CARGO_HOME ? join(process.env.CARGO_HOME, "bin") : null,
    join(homedir(), ".cargo", "bin")
  ].filter(Boolean)
  const extension = process.platform === "win32" ? ".exe" : ""
  return candidates.find((directory) => existsSync(join(directory, `cargo${extension}`))) ?? null
}

function withToolchainPath() {
  const additions = [nodeBinDir(), cargoBinDir()].filter(Boolean)
  const current = (process.env.PATH ?? "").split(delimiter)
  const missing = additions.filter((directory) => !current.includes(directory))
  // 顺序：新增的在前 —— 保证用的是刚装好的那一份，而不是别处另一份。
  return { PATH: [...missing, ...current].join(delimiter) }
}

/** Tauri CLI 的入口（`@tauri-apps/cli` 的 `bin.tauri`）。 */
function tauriEntry() {
  try {
    return join(dirname(require.resolve("@tauri-apps/cli/package.json")), "tauri.js")
  } catch {
    return null
  }
}

const [mode, ...rest] = process.argv.slice(2)
const env = { ...process.env, ...withToolchainPath() }

if (mode === "cargo") {
  const cargo = cargoBinDir()
  if (!cargo) {
    console.error("[toolchain] 找不到 cargo。安装：winget install --id Rustlang.Rustup --exact")
    console.error("           装完请重开一个终端（winget 写的是用户级 PATH）。")
    process.exit(127)
  }
  const extension = process.platform === "win32" ? ".exe" : ""
  const result = spawnSync(join(cargo, `cargo${extension}`), rest, { stdio: "inherit", env })
  process.exit(result.status ?? 1)
}

if (mode === "tauri") {
  const entry = tauriEntry()
  if (!entry) {
    console.error("[toolchain] 找不到 @tauri-apps/cli。请在仓库根执行 `npm install`。")
    process.exit(127)
  }
  const result = spawnSync(process.execPath, [entry, ...rest], { stdio: "inherit", env })
  process.exit(result.status ?? 1)
}

console.error(`[toolchain] 未知模式 '${mode ?? ""}'。用法：node scripts/toolchain.mjs <tauri|cargo> <args…>`)
process.exit(2)
