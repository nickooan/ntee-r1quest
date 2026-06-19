import { appendFileSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { getHomeConfigDirectory } from "../config.ts"

/**
 * Opt-in ACP diagnostic log. Disabled unless `R1QUEST_ACP_DEBUG` is set:
 *
 * - `R1QUEST_ACP_DEBUG=1` (or `true`) writes to
 *   `~/.ntee-r1quest/acp-debug.log`.
 * - `R1QUEST_ACP_DEBUG=/path/to/file.log` writes to that path.
 *
 * Logging is best-effort and never throws — it must not affect the app. The
 * file path is resolved per call so the env var can be toggled without a
 * restart.
 */
const resolveDebugPath = (): string | undefined => {
  const value = process.env.R1QUEST_ACP_DEBUG?.trim()

  if (!value) {
    return undefined
  }

  if (value === "1" || value.toLowerCase() === "true") {
    return join(getHomeConfigDirectory(), "acp-debug.log")
  }

  return value
}

const safeStringify = (data: unknown): string => {
  try {
    return JSON.stringify(data)
  } catch {
    return String(data)
  }
}

export const isAcpDebugEnabled = (): boolean => resolveDebugPath() !== undefined

export const logAcpDebug = (label: string, data?: unknown): void => {
  const path = resolveDebugPath()

  if (!path) {
    return
  }

  try {
    mkdirSync(dirname(path), { recursive: true })

    const time = new Date().toISOString()
    const payload = data === undefined ? "" : ` ${safeStringify(data)}`

    appendFileSync(path, `${time} ${label}${payload}\n`)
  } catch {
    // Never let diagnostic logging break the app.
  }
}
