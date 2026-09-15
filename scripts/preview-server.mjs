import path from "node:path"
import { preview } from "vite"

const root = path.resolve(process.cwd(), "apps/web")
const outDir = path.resolve(process.cwd(), "build-check/mathcanvas-current")
const server = await preview({
  root,
  configFile: false,
  build: { outDir },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true }
})

const close = async () => {
  await server.close()
  process.exit(0)
}

process.once("SIGINT", close)
process.once("SIGTERM", close)
