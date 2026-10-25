import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"

/** Checkpoints replace the previous complete JSON atomically; credentials are never saved. */
export async function writeSolidReport(filename, report, secrets = []) {
  let text = JSON.stringify(report, null, 2)
  for (const secret of secrets) if (secret) text = text.replaceAll(JSON.stringify(secret).slice(1, -1), "[REDACTED]")
  await mkdir(path.dirname(filename), { recursive: true })
  const temporary = `${filename}.${process.pid}.tmp`
  await writeFile(temporary, `${text}\n`, "utf8")
  await rename(temporary, filename)
}

export async function readSolidReport(filename) {
  return JSON.parse(await readFile(filename, "utf8"))
}
