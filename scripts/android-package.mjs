#!/usr/bin/env node
/**
 * Cross-platform local Android APK packager (Windows/Linux/macOS).
 *
 * Solves two Windows local-dev friction points without touching CI's `tauri android build`:
 * 1. Auto-detects JAVA_HOME (including Android Studio JBR), ANDROID_HOME, and NDK 27+ LTS.
 * 2. Copies compiled `libmathcanvas_desktop_lib.so` into `jniLibs/<abi>/` directly instead
 *    of creating symlinks (which require Windows Developer Mode / SeCreateSymbolicLinkPrivilege),
 *    then runs Gradle and zipalign + apksigner so the output APK is directly installable.
 *
 * Usage:
 *   node scripts/android-package.mjs [--arch arm64|x86_64] [--debug] [--skip-web] [--skip-rust]
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, "..");
const desktopDir = join(repoRoot, "apps/desktop");
const tauriDir = join(desktopDir, "src-tauri");
const androidDir = join(tauriDir, "gen/android");

const args = new Set(process.argv.slice(2));
const archArgIndex = process.argv.indexOf("--arch");
const arch = archArgIndex >= 0 ? process.argv[archArgIndex + 1] : "arm64";
const isDebug = args.has("--debug");
const skipWeb = args.has("--skip-web");
const skipRust = args.has("--skip-rust");

const ARCH_MAP = {
  arm64: {
    rustTarget: "aarch64-linux-android",
    abi: "arm64-v8a",
    clangPrefix: "aarch64-linux-android24",
    gradleArch: "Arm64",
    envTarget: "AARCH64_LINUX_ANDROID",
    ccEnvTarget: "aarch64_linux_android",
  },
  x86_64: {
    rustTarget: "x86_64-linux-android",
    abi: "x86_64",
    clangPrefix: "x86_64-linux-android24",
    gradleArch: "X86_64",
    envTarget: "X86_64_LINUX_ANDROID",
    ccEnvTarget: "x86_64_linux_android",
  },
};

const spec = ARCH_MAP[arch];
if (!spec) {
  console.error(`[android-package] Unsupported --arch '${arch}'. Use 'arm64' or 'x86_64'.`);
  process.exit(2);
}

function firstExisting(candidates) {
  return candidates.find((p) => p && existsSync(p)) ?? null;
}

function resolveJavaHome() {
  const win = process.platform === "win32";
  const javaBin = win ? "bin/java.exe" : "bin/java";
  const candidates = [
    process.env.JAVA_HOME,
    "D:/Android Studio/jbr",
    "C:/Program Files/Android/Android Studio/jbr",
    "C:/Program Files/Eclipse Adoptium/jdk-17",
    "/usr/lib/jvm/temurin-17-jdk-amd64",
  ];
  for (const dir of candidates) {
    if (dir && existsSync(join(dir, javaBin))) return dir;
  }
  return null;
}

function resolveAndroidSdk() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Android/Sdk") : null,
    join(homedir(), "Android/Sdk"),
    join(homedir(), "Library/Android/sdk"),
    "/usr/local/lib/android/sdk",
  ];
  return firstExisting(candidates);
}

function resolveNdk(sdk) {
  if (process.env.NDK_HOME && existsSync(process.env.NDK_HOME)) return process.env.NDK_HOME;
  const ndkRoot = join(sdk, "ndk");
  if (!existsSync(ndkRoot)) return null;
  const versions = readdirSync(ndkRoot).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const preferred = versions.filter((v) => /^(27|28)\./.test(v)).at(-1) ?? versions.at(-1);
  return preferred ? join(ndkRoot, preferred) : null;
}

function resolveBuildTools(sdk) {
  const root = join(sdk, "build-tools");
  if (!existsSync(root)) return null;
  const versions = readdirSync(root).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const latest = versions.at(-1);
  return latest ? join(root, latest) : null;
}

function runStep(label, command, commandArgs, options = {}) {
  console.log(`\n[android-package] ${label}`);
  const result = spawnSync(command, commandArgs, {
    stdio: "inherit",
    shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(command),
    ...options,
  });
  if (result.error) {
    console.error(`[android-package] Failed to launch ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[android-package] Step failed with exit code ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

const javaHome = resolveJavaHome();
const sdk = resolveAndroidSdk();
const ndk = sdk ? resolveNdk(sdk) : null;
const buildTools = sdk ? resolveBuildTools(sdk) : null;

if (!javaHome || !sdk || !ndk) {
  console.error("[android-package] Missing Android toolchain prerequisites:");
  console.error(`  JAVA_HOME   = ${javaHome ?? "(not found)"}`);
  console.error(`  ANDROID_HOME= ${sdk ?? "(not found)"}`);
  console.error(`  NDK_HOME    = ${ndk ?? "(not found)"}`);
  process.exit(1);
}

const win = process.platform === "win32";
const hostTag = win ? "windows-x86_64" : process.platform === "darwin" ? "darwin-x86_64" : "linux-x86_64";
const llvmBin = join(ndk, "toolchains/llvm/prebuilt", hostTag, "bin");
const clangExt = win ? ".cmd" : "";
const exeExt = win ? ".exe" : "";
const npmBin = win ? "npm.cmd" : "npm";
const cargoBin = firstExisting([
  process.env.CARGO_HOME ? join(process.env.CARGO_HOME, `bin/cargo${exeExt}`) : null,
  join(homedir(), `.cargo/bin/cargo${exeExt}`),
]) ?? "cargo";

const env = {
  ...process.env,
  JAVA_HOME: javaHome,
  ANDROID_HOME: sdk,
  ANDROID_SDK_ROOT: sdk,
  NDK_HOME: ndk,
  ANDROID_NDK_HOME: ndk,
  [`CC_${spec.ccEnvTarget}`]: join(llvmBin, `${spec.clangPrefix}-clang${clangExt}`),
  [`CXX_${spec.ccEnvTarget}`]: join(llvmBin, `${spec.clangPrefix}-clang++${clangExt}`),
  [`AR_${spec.ccEnvTarget}`]: join(llvmBin, `llvm-ar${exeExt}`),
  [`RANLIB_${spec.ccEnvTarget}`]: join(llvmBin, `llvm-ranlib${exeExt}`),
  [`CARGO_TARGET_${spec.envTarget}_LINKER`]: join(llvmBin, `${spec.clangPrefix}-clang${clangExt}`),
  PATH: [
    dirname(process.execPath),
    join(javaHome, "bin"),
    join(sdk, "platform-tools"),
    llvmBin,
    dirname(cargoBin),
    process.env.PATH ?? "",
  ].join(delimiter),
};

if (!skipWeb) {
  runStep("Build web frontend (@draw/web)", npmBin, ["run", "build", "--workspace", "@draw/web"], { cwd: repoRoot, env });
}

if (!existsSync(join(androidDir, "app/src/main/AndroidManifest.xml"))) {
  runStep("Initialize Tauri Android project", npmBin, ["run", "android:init", "--workspace", "@draw/desktop"], { cwd: repoRoot, env });
} else {
  runStep("Apply Android post-init patches", process.execPath, [join(repoRoot, "scripts/android-post-init.mjs")], { cwd: repoRoot, env });
}

const profile = isDebug ? "debug" : "release";
if (!skipRust) {
  const cargoArgs = ["build", "--target", spec.rustTarget, "--lib", "--features", "tauri/custom-protocol"];
  if (!isDebug) {
    cargoArgs.push("--release");
  }
  runStep(`Compile Rust native library (${spec.rustTarget}, ${profile})`, cargoBin, cargoArgs, { cwd: tauriDir, env });
}

const builtSo = join(tauriDir, "target", spec.rustTarget, profile, "libmathcanvas_desktop_lib.so");
if (!existsSync(builtSo)) {
  console.error(`[android-package] Expected native library not found at ${builtSo}`);
  process.exit(1);
}

const jniTargetDir = join(androidDir, "app/src/main/jniLibs", spec.abi);
mkdirSync(jniTargetDir, { recursive: true });
copyFileSync(builtSo, join(jniTargetDir, "libmathcanvas_desktop_lib.so"));
console.log(`[android-package] Copied ${builtSo} -> ${jniTargetDir}`);

const gradlew = join(androidDir, win ? "gradlew.bat" : "gradlew");
const buildVariant = isDebug ? "Debug" : "Release";
runStep(
  `Assemble Android APK (${spec.gradleArch}${buildVariant})`,
  gradlew,
  [`assemble${spec.gradleArch}${buildVariant}`, "-x", `rustBuild${spec.gradleArch}${buildVariant}`],
  { cwd: androidDir, env }
);

const apkOutDir = join(androidDir, "app/build/outputs/apk", arch, profile);
const apks = existsSync(apkOutDir) ? readdirSync(apkOutDir).filter((f) => f.endsWith(".apk")) : [];
const rawApkName = apks.find((f) => f.includes(arch)) ?? apks[0];
if (!rawApkName) {
  console.error(`[android-package] No APK found under ${apkOutDir}`);
  process.exit(1);
}
const rawApk = join(apkOutDir, rawApkName);
const distDir = join(tauriDir, "target/android-apk");
mkdirSync(distDir, { recursive: true });
const finalName = `MathCanvas-android-${arch}${isDebug ? "-debug" : ""}.apk`;
const finalApk = join(distDir, finalName);

if (rawApk.endsWith("-unsigned.apk")) {
  if (!buildTools) {
    console.error("[android-package] Cannot sign unsigned APK: Android build-tools not found.");
    process.exit(1);
  }
  const debugKeystore = join(homedir(), ".android/debug.keystore");
  if (!existsSync(debugKeystore)) {
    mkdirSync(dirname(debugKeystore), { recursive: true });
    runStep(
      "Generate local debug signing keystore",
      join(javaHome, `bin/keytool${exeExt}`),
      [
        "-genkeypair", "-v",
        "-keystore", debugKeystore,
        "-storepass", "android",
        "-alias", "androiddebugkey",
        "-keypass", "android",
        "-keyalg", "RSA",
        "-keysize", "2048",
        "-validity", "10000",
        "-dname", "CN=MathCanvas Dev,O=MathCanvas,C=CN",
      ],
      { cwd: repoRoot, env }
    );
  }
  const alignedApk = join(distDir, `${finalName}.aligned.tmp`);
  runStep("Zipalign release APK", join(buildTools, `zipalign${exeExt}`), ["-f", "-p", "4", rawApk, alignedApk], { cwd: repoRoot, env });
  runStep(
    "Sign release APK with local keystore",
    join(buildTools, `apksigner${win ? ".bat" : ""}`),
    ["sign", "--ks", debugKeystore, "--ks-pass", "pass:android", "--key-pass", "pass:android", "--out", finalApk, alignedApk],
    { cwd: repoRoot, env }
  );
  rmSync(alignedApk, { force: true });
} else {
  copyFileSync(rawApk, finalApk);
}

console.log(`\n[android-package] Ready APK: ${finalApk}`);
