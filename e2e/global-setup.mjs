import path from "node:path"
import { rm } from "node:fs/promises"
import { build, preview } from "vite"

/**
 * e2e 必须验证**当前工作区**的代码。
 *
 * 之前的 setup 直接 `preview()` 一个可写的构建目录（`build-check/mathcanvas-current`），
 * 于是 suite 实际跑的是该目录里上一次构建的产物——实测本机那份是几天前（9/14）的 bundle，
 * 因此"Playwright 全绿"与当前源码无关，`test:e2e` 里那次 `build` 产出的 `apps/web/dist` 根本没被用到。
 *
 * 现在先按 `apps/web` 自己的 vite 配置**重新构建**到这个目录，再起 preview：
 * e2e 与用户在 127.0.0.1:4175 上手工验收的预览看的是同一份当前产物（刷新页面即可生效）。
 */
export default async function globalSetup() {
  const root = path.resolve(process.cwd(), "apps/web")
  const outDir = path.resolve(process.cwd(), "build-check/mathcanvas-current")
  await rm(outDir, { recursive: true, force: true })
  await build({ root, build: { outDir, emptyOutDir: true }, logLevel: "warn" })
  const server = await preview({
    root,
    build: { outDir },
    preview: { host: "127.0.0.1", port: 4173, strictPort: true }
  })

  return async () => {
    await server.close()
  }
}
