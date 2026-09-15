import path from "node:path"
import { preview } from "vite"

export default async function globalSetup() {
  const root = path.resolve(process.cwd(), "apps/web")
  const outDir = path.resolve(process.cwd(), "build-check/mathcanvas-current")
  const server = await preview({
    root,
    configFile: false,
    build: { outDir },
    preview: { host: "127.0.0.1", port: 4173, strictPort: true }
  })

  return async () => {
    await server.close()
  }
}
