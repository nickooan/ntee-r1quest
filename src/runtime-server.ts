// Headless runtime server entrypoint. The Go/Bubble-Tea TUI spawns this and
// talks to it over a Unix-domain socket (plan §5, Phase D5):
//
//   node dist/src/runtime-server.js --socket /tmp/r1q.sock -r ./example [-ai claude]
//
// It hosts an InProcessRuntimeClient behind a SocketRuntimeServer and prints a
// single "ready" line on stdout once listening, so the parent can proceed.

import { resolveRuntimeConfig } from "./runtime/cli-command.ts"
import {
  InProcessRuntimeClient,
  SocketRuntimeServer,
} from "./runtime/client/index.ts"

const args = process.argv.slice(2)

// Pull `--socket <path>` out; the rest (-r, -ai, ...) is the normal CLI config.
let socketPath: string | undefined
const configArgs: string[] = []

for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "--socket") {
    socketPath = args[index + 1]
    index += 1
    continue
  }
  configArgs.push(args[index] as string)
}

if (!socketPath) {
  process.stderr.write("runtime-server: missing --socket <path>\n")
  process.exit(1)
}

const config = resolveRuntimeConfig(configArgs)
const client = new InProcessRuntimeClient(configArgs, config)
const server = new SocketRuntimeServer(client, socketPath)

await server.listen()
process.stdout.write("ready\n")

let shuttingDown = false
const shutdown = async () => {
  if (shuttingDown) {
    return
  }
  shuttingDown = true
  await server.close()
  process.exit(0)
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
