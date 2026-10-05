#!/usr/bin/env node
/**
 * **N2 feasibility spike：Z3 / NLSAT / WASM / 原生后端评估**（计划 N2 的 "Feasibility spike" 一条；
 * 控制器裁决 R14）。
 *
 * ## 这个脚本是什么，不是什么
 *
 * - **是**一次可重跑的测量：把候选后端真的装到**系统临时目录**里，量许可证、线程/进程模型、
 *   包体、启动时间与超时行为，并逐项打印读数。
 * - **不是**产品的一部分：没有任何生产代码 import 它，它也不改任何 `package.json`
 *   （R14 明令）。装到 `os.tmpdir()` 下是为了"量得出来"，而不是"引入依赖"。
 *
 * ## 两条纪律（R14）
 *
 * 1. **只记真的量到的东西**。量不到就写 `not_measured` **并带上原因**（网络不可达 / 环境没有
 *    Python / 没加 `--install`），绝不拿记忆里的数字顶上。
 * 2. **许可证与线程模型的结论必须指向上游依据**：`license` 字段取自包元数据（npm registry /
 *    PyPI），`licenseSource` 记下是从哪里读到的；线程模型只写**实测到的**那部分
 *    （求解调用阻塞调用线程多少毫秒），其余一概 `not_measured`。
 *
 * ## 用法
 *
 * ```text
 * node scripts/witness-search-backend-spike.mjs            # 只读探测（不下载任何东西）
 * node scripts/witness-search-backend-spike.mjs --install   # 额外装到系统临时目录并实测
 * node scripts/witness-search-backend-spike.mjs --json      # 只输出机器可读的 JSON
 * ```
 *
 * ## 为什么是 `.mjs` 而不是 `.ts`
 *
 * 与 `scripts/agent-eval.mjs` 同一条理由：这个仓库刻意没有 TS 运行器，而
 * `scripts/tsconfig.json` 只检查 `.ts`（`allowJs: false`）。这里的逻辑不需要类型。
 */
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

/** 临时工作区：**在仓库之外**，装的东西不落进 `node_modules`，也不进版本库。 */
const WORK = path.join(tmpdir(), "mc-witness-spike")
/** 仓库根：`npm` 那几条命令必须在仓库里跑（`npm exec vitest` 要找到 workspace 的依赖）。 */
const REPO_ROOT = path.resolve(import.meta.dirname, "..")
const INSTALL = process.argv.includes("--install")
const JSON_ONLY = process.argv.includes("--json")

/** 候选后端的**上游依据**（许可证结论指向这里，而不是我们自己的一句话）。 */
const UPSTREAM = {
  npm: { package: "z3-solver", repository: "https://github.com/Z3Prover/z3", subdir: "src/api/js" },
  pypi: { package: "z3-solver", repository: "https://github.com/Z3Prover/z3", subdir: "src/api/python" }
}

/** 统一记 `not_measured`：**原因必须写清楚**，否则这一项在下一次评估里就变成了空格。 */
function notMeasured(reason) {
  return { measured: false, reason }
}

function measured(value) {
  return { measured: true, value }
}

/** 跑一条命令，返回 stdout/stderr/退出码（不抛异常，失败交给调用方记 `not_measured`）。 */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: options.timeoutMs ?? 600_000, windowsHide: true, cwd: options.cwd, env: options.env ?? process.env })
  return {
    ok: result.status === 0 && result.error === undefined,
    status: result.status,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
    error: result.error === undefined ? null : String(result.error.message)
  }
}

/**
 * 跑一条**命令行**（只有 `z3`/`python` 这类可执行文件用它）。
 *
 * `npm` 在 Windows 上是 `.cmd`，而 Node 18.15 之后 `spawnSync("npm.cmd")` 直接 `EINVAL`；
 * 过一层 `cmd.exe /s /c` 又会在路径带引号时把命令行拆坏。所以 npm 走下面那个
 * `runNpm`（直接 `node <npm-cli.js>`，不经 shell、参数原样传递）。
 */
function runShell(commandLine, options = {}) {
  const isWindows = process.platform === "win32"
  const shell = isWindows ? (process.env.ComSpec ?? "cmd.exe") : "/bin/sh"
  const args = isWindows ? ["/d", "/c", commandLine] : ["-c", commandLine]
  const result = spawnSync(shell, args, { encoding: "utf8", timeout: options.timeoutMs ?? 600_000, windowsHide: true, cwd: options.cwd })
  return {
    ok: result.status === 0 && result.error === undefined,
    status: result.status,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
    error: result.error === undefined ? null : String(result.error.message)
  }
}

/** npm 的可执行名（退化路径用）。 */
const NPM = process.platform === "win32" ? "npm.cmd" : "npm"

/**
 * 跑一条 npm 命令。
 *
 * 首选**直接用 node 跑 npm 的 CLI 入口**（`<node>/node_modules/npm/bin/npm-cli.js`）：
 * 不经 shell，所以带空格的路径也能原样传过去（第一版把路径自己加了引号再走 shell，
 * 于是在 `cmd` 里被拆坏成 `npm error code ENOENT`；第二版改成不经 shell 之后，
 * 那对引号又变成了参数的一部分 —— 同一类错误换个原因出现两次，记在这里）。
 */
function runNpm(args, options = {}) {
  const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")
  if (existsSync(npmCli)) return run(process.execPath, [npmCli, ...args], options)
  return runShell([NPM, ...args].join(" "), options)
}

function firstLine(text) {
  return text.split(/\r?\n/).find((line) => line.length > 0) ?? ""
}

/** 从装下来的 `*.dist-info/METADATA` 里读许可证（这是**包自己的元数据**，不是我们的一句话）。 */
function readInstalledLicense(target, distPrefix) {
  let entries
  try {
    entries = readdirSync(target)
  } catch (error) {
    return notMeasured(`读不到安装目录 ${target}：${String(error.message)}`)
  }
  const distInfo = entries.find((entry) => entry.startsWith(distPrefix) && entry.endsWith(".dist-info"))
  if (distInfo === undefined) return notMeasured(`安装目录里没有 ${distPrefix}*.dist-info`)
  try {
    const metadata = readFileSync(path.join(target, distInfo, "METADATA"), "utf8")
    const line = metadata.split(/\r?\n/).find((candidate) => candidate.startsWith("License:"))
    if (line === undefined) return notMeasured(`${distInfo}/METADATA 里没有 License 字段`)
    return measured(`${line.replace("License:", "").trim()}（装下来的 ${distInfo}/METADATA；上游 ${UPSTREAM.pypi.repository} 的 LICENSE.txt）`)
  } catch (error) {
    return notMeasured(`读 ${distInfo}/METADATA 失败：${String(error.message)}`)
  }
}

/** 目录的实际占用（装了多大，而不是下载了多大）。 */
function directoryBytes(target) {
  const result = run(process.execPath, ["-e", `
    const fs = require("node:fs"); const path = require("node:path");
    let total = 0; const walk = (dir) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full); else total += fs.statSync(full).size; } };
    walk(process.argv[1]); console.log(String(total));
  `, target])
  return result.ok ? Number.parseInt(result.stdout, 10) : null
}

// ---------------------------------------------------------------- 环境探测

function probeEnvironment() {
  const facts = { node: process.version, platform: `${process.platform}-${process.arch}`, cpus: undefined, z3OnPath: undefined, python: undefined }
  const cpus = run(process.execPath, ["-e", "console.log(String(require('node:os').cpus().length))"])
  facts.cpus = cpus.ok ? Number.parseInt(cpus.stdout, 10) : null
  // `z3` 命令行（原生分发最常见的形态）：装了没有，是"能不能立刻用原生后端"的第一个事实。
  const which = process.platform === "win32" ? run("where", ["z3"]) : run("which", ["z3"])
  facts.z3OnPath = which.ok ? firstLine(which.stdout) : null
  const python = run("python", ["-c", "import sys; print(sys.version.split()[0])"])
  facts.python = python.ok ? python.stdout : null
  if (facts.python !== null) {
    const hasZ3 = run("python", ["-c", "import z3; print(z3.get_version_string())"])
    facts.pythonZ3 = hasZ3.ok ? hasZ3.stdout : null
  } else {
    facts.pythonZ3 = null
  }
  const pip = run("python", ["-m", "pip", "--version"])
  facts.pip = pip.ok ? firstLine(pip.stdout) : null
  return facts
}

// ---------------------------------------------------------------- npm / WASM

/** 从 npm registry 读元数据（许可证与包体的**上游来源**）。 */
function npmMetadata() {
  const result = runNpm(["view", "z3-solver", "version", "license", "repository.url", "dist.unpackedSize", "dist.fileCount", "dependencies", "--json"], { timeoutMs: 120_000, cwd: REPO_ROOT })
  if (!result.ok) return { metadata: notMeasured(`npm view 失败：${firstLine(result.stderr) || result.error || `exit ${String(result.status)}`}`) }
  try {
    const parsed = JSON.parse(result.stdout)
    const read = Array.isArray(parsed) ? parsed[0] : parsed
    return {
      metadata: measured({
        version: read.version,
        license: read.license,
        // 注意：`npm view` 对**带点的字段**原样保留主键（`"dist.unpackedSize"`），
        // 不 nest 成 `dist.unpackedSize`。第一版按后者读，于是包体那一项静默变成 undefined。
        repository: read["repository.url"] ?? read.repository,
        unpackedSizeBytes: read["dist.unpackedSize"],
        fileCount: read["dist.fileCount"],
        runtimeDependencies: read.dependencies ?? {}
      }),
      source: `npm view z3-solver（registry 元数据）`
    }
  } catch (error) {
    return { metadata: notMeasured(`npm view 的输出不是 JSON：${String(error.message)}`) }
  }
}

/** 在子进程里量 WASM 后端：启动时间、首次非线性检查、NLSAT 可用性、超时行为、阻塞时长。 */
function measureWasmBackend(entry) {
  const script = path.join(WORK, "measure-wasm.cjs")
  writeFileSync(script, `
const mod = require(process.argv[2]);
const out = { initMs: null, version: null, firstCheckMs: null, firstResult: null, nlsat: null, budget: null, blockedMainThreadMs: null };
(async () => {
  const t0 = Date.now();
  const ctx = await mod.init();
  out.initMs = Date.now() - t0;
  out.version = ctx.getVersionString();
  const Z3 = new ctx.Context("spike");
  const { Real, Solver, Tactic, Goal } = Z3;
  const x = Real.const("x"), y = Real.const("y");
  // 同一个非线性系统分别用"宽松预算"与"1ms 预算"各跑一次：后者是超时行为的**实测**。
  const wide = new Solver(); wide.add(x.mul(x).add(y.mul(y)).eq(1), x.gt(0), y.gt(0));
  const t1 = Date.now(); const first = await wide.check(); out.firstCheckMs = Date.now() - t1; out.firstResult = String(first);
  const tight = new Solver(); tight.set("timeout", 1); tight.add(x.mul(x).add(y.mul(y)).eq(1), x.gt(0), y.gt(0));
  const t2 = Date.now(); const tightResult = await tight.check(); out.budget = { budgetMs: 1, result: String(tightResult), ms: Date.now() - t2 };
  // 阻塞：整个求解是同步调用，量它占住调用线程多久（这就是"线程模型"里我们**实测**到的那部分）。
  const blocking = new Solver(); blocking.add(x.mul(x).add(y.mul(y)).eq(1), x.gt(1));
  const t3 = Date.now(); await blocking.check(); out.blockedMainThreadMs = Date.now() - t3;
  try {
    const tactic = new Tactic("qfnra-nlsat");
    const goal = new Goal(); goal.add(x.mul(x).add(y.mul(y)).eq(1));
    const t4 = Date.now(); const applied = await tactic.apply(goal);
    out.nlsat = { available: true, ms: Date.now() - t4, subgoals: applied.length };
  } catch (error) { out.nlsat = { available: false, reason: String((error && error.message) || error) }; }
  console.log("SPIKE_JSON " + JSON.stringify(out));
})().catch((error) => { console.log("SPIKE_JSON " + JSON.stringify({ failed: String((error && error.message) || error) })); });
`)
  const result = run(process.execPath, [script, entry], { timeoutMs: 600_000 })
  const line = result.stdout.split(/\r?\n/).find((candidate) => candidate.startsWith("SPIKE_JSON "))
  if (!line) return { runtime: notMeasured(`子进程没有给出读数：${firstLine(result.stderr) || result.error || "no output"}`) }
  const parsed = JSON.parse(line.slice("SPIKE_JSON ".length))
  if (parsed.failed !== undefined) return { runtime: notMeasured(`WASM 后端跑不通：${parsed.failed}`) }
  return { runtime: measured(parsed) }
}

function measureNpmBackend() {
  const metadata = npmMetadata()
  const backend = { id: "z3-solver (npm, WASM)", kind: "wasm", license: notMeasured("需要 npm 元数据"), threadModel: notMeasured("需要 --install（线程模型只写实测到的那部分：求解调用占住调用线程多久）"), packageSizeBytes: notMeasured("需要 npm 元数据或 --install"), startupMs: notMeasured("需要 --install"), timeoutBehaviour: notMeasured("需要 --install"), nlsat: notMeasured("需要 --install"), notes: [] }
  if (metadata.metadata.measured) {
    const value = metadata.metadata.value
    backend.license = measured(`${value.license}（${metadata.source}；上游 ${UPSTREAM.npm.repository} 的 LICENSE.txt）`)
    backend.packageSizeBytes = measured({ unpackedBytes: value.unpackedSizeBytes, fileCount: value.fileCount, note: "registry 报的**解包后**大小" })
    backend.version = value.version
    backend.runtimeDependencies = value.runtimeDependencies
  } else {
    backend.license = metadata.metadata
    // 元数据拿不到时，包体这一项也得说清"为什么没有"，而不是留一句"见 metadata"。
    backend.packageSizeBytes = metadata.metadata
  }
  if (!INSTALL) {
    backend.notes.push("未加 `--install`：包体/启动/超时三项都没量（这是有意的 —— 只读探测不下载任何东西）。")
    return backend
  }
  const prefix = path.join(WORK, "npm")
  rmSync(prefix, { recursive: true, force: true })
  mkdirSync(prefix, { recursive: true })
  // `cwd` 刻意放在临时目录里：在仓库里跑 `npm install` 有碰到 workspace 清单的风险，
  // 而 R14 明令**不许给任何 package.json 加依赖**（`--no-save` 只是第二道保险）。
  const installed = runNpm(["install", "--prefix", prefix, "--no-package-lock", "--no-save", "z3-solver@5.2.0"], { timeoutMs: 900_000, cwd: WORK })
  if (!installed.ok) {
    backend.packageSizeBytes = notMeasured(`npm install 失败：${firstLine(installed.stderr) || installed.error}`)
    return backend
  }
  const modules = path.join(prefix, "node_modules")
  const bytes = directoryBytes(modules)
  if (bytes !== null) backend.packageSizeBytes = measured({ installedBytes: bytes, path: "os.tmpdir()/mc-witness-spike/npm/node_modules", note: "实测安装占用" })
  const entry = path.join(modules, "z3-solver", "build", "node.js")
  if (!existsSync(entry)) {
    backend.notes.push(`安装后没有找到入口 ${entry}`)
    return backend
  }
  const wasmBytes = (() => {
    try {
      return statSync(path.join(modules, "z3-solver", "build", "z3-built.wasm")).size
    } catch { return null }
  })()
  if (wasmBytes !== null) backend.wasmBytes = measured(wasmBytes)
  const runtime = measureWasmBackend(entry)
  if (runtime.runtime.measured) {
    const value = runtime.runtime.value
    backend.version = value.version ?? backend.version
    backend.startupMs = measured({ requireAndInitMs: value.initMs, measurement: "require() + init()（同一进程内一次冷启动）" })
    backend.timeoutBehaviour = measured({ budgetMs: value.budget?.budgetMs, result: value.budget?.result, wallMs: value.budget?.ms, note: "`Solver.set(\"timeout\", 1)` 下同一个非线性系统的结论" })
    backend.firstNonlinearCheck = measured({ result: value.firstResult, wallMs: value.firstCheckMs })
    backend.threadModel = measured(`同进程、同线程：求解是**同步**调用，实测占住调用线程 ${String(value.blockedMainThreadMs)} ms（期间事件循环不前进）。自带运行时依赖 ${JSON.stringify(backend.runtimeDependencies ?? {})}，其中 async-mutex 是 JS 侧的串行化。`)
    backend.nlsat = measured(value.nlsat)
  } else {
    backend.startupMs = runtime.runtime
    backend.timeoutBehaviour = runtime.runtime
    backend.threadModel = runtime.runtime
  }
  return backend
}

// ---------------------------------------------------------------- PyPI / 原生

/** 在子进程里量原生后端（PyPI 轮子里是编译好的 libz3）。 */
function measureNativeBackend(target) {
  const script = path.join(WORK, "measure-native.py")
  writeFileSync(script, `
import json, time
out = {}
t0 = time.perf_counter()
import z3
out["importMs"] = (time.perf_counter() - t0) * 1000
out["version"] = z3.get_version_string()
x, y = z3.Reals("x y")
wide = z3.Solver(); wide.add(x * x + y * y == 1, x > 0, y > 0)
t1 = time.perf_counter(); first = wide.check(); out["firstCheckMs"] = (time.perf_counter() - t1) * 1000; out["firstResult"] = str(first)
tight = z3.Solver(); tight.set("timeout", 1); tight.add(x * x + y * y == 1, x > 0, y > 0)
t2 = time.perf_counter(); tight_result = tight.check(); out["budget"] = {"budgetMs": 1, "result": str(tight_result), "ms": (time.perf_counter() - t2) * 1000}
blocking = z3.Solver(); blocking.add(x * x + y * y == 1, x > 1)
t3 = time.perf_counter(); blocking.check(); out["blockedThreadMs"] = (time.perf_counter() - t3) * 1000
try:
    tactic = z3.Tactic("qfnra-nlsat")
    goal = z3.Goal(); goal.add(x * x + y * y == 1)
    t4 = time.perf_counter(); applied = tactic(goal)
    out["nlsat"] = {"available": True, "ms": (time.perf_counter() - t4) * 1000, "subgoals": len(applied)}
except Exception as error:
    out["nlsat"] = {"available": False, "reason": str(error)}
print("SPIKE_JSON " + json.dumps(out))
`)
  // `--target` 装出来的包不在默认 `sys.path` 上：子进程必须显式带上它，
  // 否则 `import z3` 会 ImportError（第一版就是这么失败的）。
  const result = run("python", [script], { timeoutMs: 600_000, env: { ...process.env, PYTHONPATH: target } })
  const line = result.stdout.split(/\r?\n/).find((candidate) => candidate.startsWith("SPIKE_JSON "))
  if (!line) return notMeasured(`Python 子进程没有给出读数：${firstLine(result.stderr) || result.error || "no output"}`)
  return measured(JSON.parse(line.slice("SPIKE_JSON ".length)))
}

function measurePypiBackend(environment) {
  const backend = { id: "z3-solver (PyPI, 原生 libz3)", kind: "native", license: notMeasured("需要 --install（从装下来的 *.dist-info/METADATA 读）"), threadModel: notMeasured("需要 --install（线程模型只写实测到的那部分：求解调用占住调用线程多久）"), packageSizeBytes: notMeasured("需要 --install"), startupMs: notMeasured("需要 --install"), timeoutBehaviour: notMeasured("需要 --install"), nlsat: notMeasured("需要 --install"), notes: [] }
  if (environment.python === null) {
    const reason = "环境里没有 `python`：原生那一路这条路量不到。"
    backend.license = notMeasured(reason)
    backend.notes.push(reason)
    return backend
  }
  if (!INSTALL) {
    backend.notes.push("未加 `--install`：许可证/包体/启动/超时四项都没量。")
    return backend
  }
  const target = path.join(WORK, "py")
  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
  const installed = run("python", ["-m", "pip", "install", "--disable-pip-version-check", "--target", target, "z3-solver"], { timeoutMs: 900_000 })
  if (!installed.ok) {
    const reason = `pip install 失败：${firstLine(installed.stderr) || installed.error}`
    backend.license = notMeasured(reason)
    backend.packageSizeBytes = notMeasured(reason)
    backend.notes.push(reason)
    return backend
  }
  const bytes = directoryBytes(target)
  if (bytes !== null) backend.packageSizeBytes = measured({ installedBytes: bytes, path: "os.tmpdir()/mc-witness-spike/py", note: "实测安装占用" })
  /**
   * 许可证从**装下来的元数据**里读（`*.dist-info/METADATA` 的 `License:`），
   * 不用 `pip show` —— `--target` 装出来的包对 `pip show` 是不可见的（实测
   * "Package(s) not found"），那条路会把一个能读到的字段记成没量到。
   */
  backend.license = readInstalledLicense(target, "z3_solver")
  const runtime = measureNativeBackend(target)
  if (runtime.measured) {
    const value = runtime.value
    backend.version = value.version
    backend.startupMs = measured({ importMs: value.importMs, measurement: "`import z3`（同一进程内一次冷启动；轮子里带的是编译好的 libz3）" })
    backend.timeoutBehaviour = measured({ budgetMs: value.budget?.budgetMs, result: value.budget?.result, wallMs: value.budget?.ms, note: "`Solver.set(\"timeout\", 1)` 下同一个非线性系统的结论" })
    backend.firstNonlinearCheck = measured({ result: value.firstResult, wallMs: value.firstCheckMs })
    backend.threadModel = measured(`同进程、同线程：CPython 里求解是**同步**调用，实测占住调用线程 ${value.blockedThreadMs.toFixed(1)} ms；Z3 自身的并行（threads 参数）本脚本没有测，故不作结论。`)
    backend.nlsat = measured(value.nlsat)
  } else {
    backend.startupMs = runtime
    backend.timeoutBehaviour = runtime
    backend.threadModel = runtime
  }
  return backend
}

// ---------------------------------------------------------------- 输出

function printTable(environment, backends, reference) {
  console.log("== N2 见证搜索后端 spike（R14）==")
  console.log(`环境：node ${environment.node} / ${environment.platform} / ${String(environment.cpus)} cpus / python=${String(environment.python)} / pip=${environment.pip === null ? "none" : "yes"}`)
  console.log(`PATH 上的 z3：${environment.z3OnPath ?? "没有"}；python 里的 z3：${environment.pythonZ3 ?? "没有"}`)
  console.log("")
  for (const backend of backends) {
    console.log(`--- ${backend.id} ---`)
    for (const [label, field] of [["许可证", backend.license], ["包体", backend.packageSizeBytes], ["启动", backend.startupMs], ["线程模型", backend.threadModel], ["超时行为", backend.timeoutBehaviour], ["NLSAT", backend.nlsat]]) {
      console.log(`  ${label}：${field === undefined ? "not_measured（本项不适用）" : field.measured ? JSON.stringify(field.value) : `not_measured（${field.reason}）`}`)
    }
    if (backend.notes.length > 0) for (const note of backend.notes) console.log(`  注：${note}`)
  }
  console.log("")
  console.log("== 我们已经有的（对照，不必引入任何后端）==")
  console.log(JSON.stringify(reference, null, 2))
}

/** 参照物：现在这条搜索路径自己就是后端，量一下它，免得"评估外部后端"变成没有基准的数字。 */
function measureCurrentSearch() {
  const started = Date.now()
  const build = runNpm(["exec", "--", "vitest", "run", "packages/agent-core/src/solver/witnessSearch.test.ts", "--maxWorkers=1"], { timeoutMs: 900_000, cwd: REPO_ROOT })
  return {
    what: "packages/agent-core/src/solver/witnessSearch.test.ts（2b 的搜索器全量用例）",
    ok: build.ok,
    wallMs: Date.now() - started,
    note: "这是**测试套件**的墙钟，不等于单次搜索耗时；单次搜索的实测读数在 task-2b-report.md §8.7（池子上界 13、各候选一次 compilePlan + verify 约 20ms 量级）。"
  }
}

function main() {
  mkdirSync(WORK, { recursive: true })
  const environment = probeEnvironment()
  const backends = [measureNpmBackend(), measurePypiBackend(environment)]
  const reference = INSTALL ? measureCurrentSearch() : { what: "not_measured（未加 --install 时连测试都不跑，保持只读探测的语义）" }
  const report = {
    generatedAt: new Date().toISOString(),
    goal: "N2 的 Feasibility spike：Z3 / NLSAT / WASM / 原生作为**可选**后端（R14：不加依赖、不接产品）",
    environment,
    workDirectory: WORK,
    installRequested: INSTALL,
    backends,
    currentSearchReference: reference,
    notWired: "本脚本不被任何生产代码 import；没有向任何 package.json 添加依赖。"
  }
  if (JSON_ONLY) console.log(JSON.stringify(report, null, 2))
  else printTable(environment, backends, reference)
  return report
}

const report = main()
/** 任何一项都没量到时**如实**用退出码说出来（0 = 至少许可证或运行时有读数）。 */
const anythingMeasured = report.backends.some((backend) => backend.packageSizeBytes.measured || backend.startupMs.measured)
process.exitCode = anythingMeasured ? 0 : 1
