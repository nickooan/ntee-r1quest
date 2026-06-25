# Go / Bubble Tea TUI Migration — Architecture & Refactor Plan

Status: planning. Target: replace the Ink/React TUI with a Go + Bubble Tea TUI,
while keeping the existing TypeScript runtime (anchored by ACP) as a separate
process behind a Unix-domain-socket protocol.

## 1. Decision & rationale

- **ACP is the anchor.** ACP support is mature in TS/JS and weak in Go. As long
  as that holds, the AI runtime must stay TS. Keeping a TS process alive for ACP
  also lets us *avoid* porting the two next-riskiest pieces — the ohm grammar and
  the lmdb cache — so the whole runtime stays TS.
- **The seam is "presentation vs everything else."** Go owns rendering and all
  interactive view logic (and presentation-time filesystem reads). TS owns
  parsing, HTTP execution, cache, config, ACP, and process-to-process IPC.
- **Future-proof either way.** The seam is exactly where a future migration would
  happen. If Go ACP matures, collapse the TS process into Go *behind the same
  client interface* — the Bubble Tea UI does not change. If it never matures, the
  split stays. The Go UI is written once regardless.

## 2. Performance ground rules (why the socket is not a bottleneck)

A UDS moves data at multiple GB/s with microsecond latency. The risks are
**chattiness** and **serialization**, both design choices:

1. **Content crosses the socket at most once.** File content / responses transfer
   on open/execute; the Go side caches and does scroll/viewport/search/edit
   locally. No per-keystroke I/O.
2. **No per-keystroke traffic at all.** File tree, file reads, editor
   suggestions, and clipboard live on the Go side (see split below), so the
   protocol carries only: execute, cache list/clear/record, AI streaming,
   external-event push, and config handshake/reload.
3. **Bulk payloads ship raw.** Length-prefixed framing: small JSON control header
   + raw payload bytes. Never JSON-escape or base64 large blobs.
4. **One persistent, bidirectional connection** with request-id correlation and a
   streaming channel — not the current one-shot connect/send/close pattern.

## 3. Module-by-module split

### Go side — presentation, interactive view logic, presentation-time FS reads

Pure view logic (port to Go; mostly already framework-free):
- `views/terminal/viewport.ts`, `search-matches.ts`, `section-format.ts`,
  `constants.ts`, `content.ts`, `input-suggestions.ts`, `history-content.ts`
- `views/key-helpers/*` (generic-key-actions, query-mode, search-mode,
  view-mode, edit-mode, ai-mode) — already pure `(state, key) -> state`, maps 1:1
  onto Bubble Tea `Update`.
- `views/response.tsx` formatting fns (`formatResponse`, `formatError`, …) — pure.

Rendering (rewrite in Bubble Tea + Lipgloss):
- `views/terminal/*.tsx` (header, pane-title, sidebar, response-pane,
  command-line, command-suggestions, blinking-cursor, file-content, all overlays)
- `views/ai.tsx`, `views/config-generator/index.tsx`
- `views/terminal-app.tsx` — the orchestrator; ~60% is the `useInput` handler
  (becomes Bubble Tea `Update`), ~30% state (a Bubble Tea Model), ~10% JSX.

Go-bound runtime modules (no ohm / ACP / lmdb dependency — safe to port):
- `runtime/app-command/*` — pure mode routing/parsing.
- `runtime/custom-command/index.ts` — pure command expansion.
- `runtime/file-manager/*` — tree build + mtime dir cache, view-file read,
  command/format/path. Presentation-time FS reads; per-keystroke tree.
  *Verified:* imported only by the view layer; the TS execution pipeline does its
  own reads (`semantics.ts` `readFileSync` for `ref`/body files), so moving the
  whole dir to Go causes no duplication and leaves the TS side untouched.
- `runtime/editor-suggestions/*` — per-keystroke; plain regex + fs, no ohm. Needs
  only the custom-suggestions list (pushed from config at startup).
- `runtime/clipboard.ts` — platform subprocess; *verified* imported only by
  `terminal-app.tsx`. In Go: `os/exec` (same pbcopy/wl-copy/xclip/xsel cascade) or
  a native lib (`atotto/clipboard`). Keeps clipboard content local.

Consequence: with file-manager + clipboard + editor-suggestions all Go-local, the
socket protocol carries **zero filesystem reads** — the TS runtime reads files
only internally during request execution.
- Pure layout helpers extracted from `ai.tsx` (`buildAiLayout`,
  `buildAiMessageLines`).

### TS side — behind the socket (the anchors + IPC)

- `compiler/*` — **ohm grammars + semantics. Anchor #1.**
- `runtime/acp/*` — adapters + conversation-manager. **Anchor #2 (ACP).**
- `runtime/cache/*` — lmdb. **Anchor #3.**
- `runtime/request.ts` — axios HTTP execution (pairs with the parser pipeline).
- `runtime/cli-command.ts` — parse → execute → cache → external-event orchestrator.
- `runtime/config.ts` — yaml + home config (authoritative; pushed to Go at startup).
- `runtime/external-event/index.ts` — runtime-to-runtime UDS server; pushes events
  to Go as a notification frame.
- `runtime/startup.ts`, `claude-plugin.ts`, `version.ts`.

## 3.1 Invariant: TS runtime never modifies request files

**The TS runtime is read-only on the request root. Go is the sole writer of
`.nts`/`.ntd` files.** The runtime *executes* requests (reads `.nts`/`.ntd`,
makes HTTP calls), it never edits them.

*Verified against current code* — the only write to a request file is the
edit-mode save at `terminal-app.tsx:911` (`writeFileSync(openViewFile.path, …)`),
which lives in the view layer and moves to Go with file-manager/edit mode. Every
other write in the runtime targets its own infrastructure, never the request
root: `config.ts` (home config), `external-event` (socket file), `cache/` (lmdb),
`acp-debug` (log). `semantics.ts` reads request files with `readFileSync` only.

Enforced by:
1. **No write-file method on the `RuntimeClient` protocol** — there is no RPC by
   which the TUI can ask the runtime to modify a request file. Saves are Go-local.
2. **Guard test** — assert nothing under `src/runtime/` or `src/compiler/` writes
   (`writeFile*`/`appendFile`/`createWriteStream`) to a path under the request
   root.

## 3.2 Repository layout

Monorepo (same repo — the protocol binds the halves; co-locating prevents
version skew). Go gets its own module root in a top-level dir, separate from the
npm-owned root and the TS-owned `src/`.

```
ntee-r1quest/
  index.ts          # TS entry (eventually runtime-only)
  src/              # TS runtime — compiler, runtime/*, ACP, cache (views move out)
  dist/             # TS build output
  tui/              # Go module root
    go.mod
    cmd/r1q-tui/main.go
    internal/{model,view,filemanager,suggestions,clipboard,rpc}
  proto/            # language-agnostic protocol spec + shared golden fixtures
  docs/
```

- `tsconfig.build.json` already includes only `index.ts` + `src/**/*`, so `tui/`
  is excluded from tsc/jest automatically.
- Add `.prettierignore` (skip `tui/`) and `.gitignore` (Go build artifacts).
- `proto/` is a first-class artifact: both the TS `SocketRuntimeServer` and the
  Go client validate against the same fixtures so the two views can't drift.
- Later (Phase D/E): once views leave `src/`, `src/` is runtime-only and may be
  renamed — not now.

## 4. The socket protocol — bidirectional JSON-RPC 2.0

**Transport:** one persistent UDS connection. **Framing:** LSP-style
`Content-Length: N\r\n\r\n<json>` (ndjson is an acceptable simpler alternative,
since `JSON.stringify` output is single-line). **Protocol:** JSON-RPC 2.0,
**bidirectional** — the runtime calls *back* into Go (permission prompts, session
updates, external events), mirroring the ACP framing the runtime already speaks.

Envelope:
- request: `{ "jsonrpc":"2.0", "id":N, "method":"…", "params":{…} }`
- success: `{ "jsonrpc":"2.0", "id":N, "result":{…} }`
- error:   `{ "jsonrpc":"2.0", "id":N, "error":{ "code":-32000, "message":"…", "data":{ "kind":"…" } } }`
- notification (no id): `{ "jsonrpc":"2.0", "method":"…", "params":{…} }`

Error codes: reserve `-32700…-32600` for protocol errors; `-32000`+ for app
errors discriminated by `data.kind`.

### Go → Runtime (requests)

| method | params | result |
|---|---|---|
| `getConfig` / `reload` | — | `{ root, aiAdaptor, customCommands, version }` |
| `execute` | `{ command, env? }` | `{ status, statusText, headers, body, durationMs }` |
| `recordInput` | `{ command }` | *(notification — no id)* |
| `cache/listAiSessions` | — | `{ sessions }` |
| `cache/listApiEndpoints` | — | `{ endpoints }` |
| `cache/listTraceCalls` | `{ traceId? }` | `{ calls }` |
| `cache/clear` | — | `{ ok:true }` |
| `ai/start` | `{ adaptor }` | `{ sessionId }` |
| `ai/resume` | `{ sessionId }` | `{ ok:true }` |
| `ai/prompt` | `{ sessionId, text }` | `{ ok:true }` *(reply streams via notifications)* |
| `ai/cancel` | `{ sessionId }` | `{ ok:true }` |

### Runtime → Go (server-initiated)

| method | kind | params | response |
|---|---|---|---|
| `ai/sessionUpdate` | notification | `{ sessionId, update }` (ACP `SessionUpdate`, pass-through) | — |
| `externalEvent` | notification | `{ ntsPath, ntsFile, time, responseContent, traceId? }` | — |
| `ai/requestPermission` | **request** | `{ sessionId, requestId, toolCall, options }` | Go replies `{ optionId }` |

Note what is **absent**: `readViewFile`, file-tree, editor-suggestions, and
clipboard — all Go-local, so zero per-keystroke socket traffic. The only
non-trivial payload is the `execute` response body.

**Large-body escape hatch (default off):** if a response body exceeds a
threshold, `execute` returns `{ …, bodyRef:"/tmp/r1q-<id>.body" }` instead of
inline `body`; Go reads it locally (same machine/filesystem). Start with inline;
add only if large responses prove common.

The `params`/`result` shapes above *are* the `RuntimeClient` interface + DTOs
(Task #1) and the `proto/` fixtures — one contract, three consumers (TS facade,
TS socket server/client, Go client).

## 4.1 Hand-rolled JSON-RPC library (both languages) — DONE

Neither stack ships a usable JSON-RPC 2.0 transport (Node has none; Go stdlib's
`net/rpc/jsonrpc` is 1.0). The ACP SDK already hand-rolls its own, so we do the
same: a tiny, dependency-free, method-agnostic transport on each side, so the
wire format stays ours and the `proto/` fixtures are the single source of truth.
A lib can be swapped in later behind the same boundary if needed.

Both implementations are generic (envelope + framing + correlation + dispatch);
they know nothing about the §4 methods. Both are **bidirectional** — one
`Conn`/`Connection` is client and server at once over a single duplex stream
(UDS socket, child-process stdio, or an in-memory pipe in tests).

**TypeScript — `src/runtime/jsonrpc/`**
- `messages.ts` — envelope types, `JsonRpcErrorCode`, `RpcError`, type guards.
- `framing.ts` — `encodeMessage()` + `FrameDecoder` (handles split/coalesced chunks).
- `connection.ts` — `JsonRpcConnection(stream, handler?)`: `request()`, `notify()`,
  `onRequest()`, `close()`; rejects in-flight requests on close.
- `index.ts` — barrel. `jsonrpc.test.ts` — framing + loopback round-trip tests.

**Go — `tui/internal/jsonrpc/`** (module `…/tui`, stdlib-only)
- `messages.go` — `Message`, `Error`, code constants.
- `framing.go` — `writeMessage()` / `readMessage()` over `bufio.Reader`.
- `connection.go` — `NewConn(rw, handler)`: `Request(ctx,…)`, `Notify()`, `Close()`;
  fails pending requests on shutdown. `connection_test.go` — `net.Pipe` tests.

Shared wire shape (must stay identical):
- request `{jsonrpc,id,method,params}`, notification `{jsonrpc,method,params}`,
  response `{jsonrpc,id,result|error}`; kind inferred by field presence
  (response = no `method`; request vs notification = `id` present or not).
- framing: `Content-Length: N\r\n\r\n<utf8 json>`.

Next: the Phase C `SocketRuntimeServer`/`SocketRuntimeClient` are thin layers
*on top* of these — register a `RuntimeClient` method table as the handler.

## 5. Refactor plan (do this in the current TS project first)

The goal of the first phases is to make the eventual Go split **mechanical** by
introducing and proving the seam *inside* the existing TS app, with no behavior
change. Existing `test/` + `example/` golden files must stay green throughout.

### Phase A — Introduce a `RuntimeClient` facade (in-process, no behavior change)
1. Define a `RuntimeClient` interface (the §4 surface) + DTO types in
   `src/runtime/client/` — the protocol contract.
2. Implement `InProcessRuntimeClient` that calls existing runtime fns directly.
3. Refactor `terminal-app.tsx` + controllers (`ai-controller`,
   `use-terminal-view`, `edit-suggestions`, `file-navigation`) to depend ONLY on
   the client for anchor-side calls; drop direct `../runtime/acp|cache|
   external-event|clipboard` imports from the view layer.
4. Inject the client from `index.ts` (`CommandApp`) via prop/context.

### Phase B — Reorganize modules by destination side
1. Ensure every Go-bound pure module imports neither React nor an anchor module.
2. Extract pure logic embedded in `.tsx` (file-content syntax highlighting,
   ai.tsx layout/line-building) into pure `.ts` modules so they port independently.

### Phase C — Make the client transport-swappable (prove the protocol in TS)
0. *(done)* Hand-rolled JSON-RPC transport in both languages — see §4.1.
1. Specify the wire protocol (framing, correlation, streaming) — see §4 / §4.1.
2. Implement `SocketRuntimeServer` (TS) wrapping `InProcessRuntimeClient` over UDS,
   registering the `RuntimeClient` method table as the `JsonRpcConnection` handler.
3. Implement `SocketRuntimeClient` (TS) and run the TUI against it from a second
   process — proves the protocol end-to-end before any Go exists.

### Phase D — Build the Go TUI against the proven protocol
1. Spike the riskless-but-bulky ports: pure-view-logic + Go-bound runtime.
2. Rewrite rendering in Bubble Tea / Lipgloss; key-helpers become `Update`.
3. Implement the Go `SocketRuntimeClient`; spawn + supervise the TS runtime server.

### Phase E — Cutover
1. Port/extend tests; benchmark startup + render.
2. Switch the `r1q` / `ntee-r1quest` bin to the Go binary (Node still needed only
   for the runtime process + npm ACP agents).

## 6. Risk register

| Risk | Mitigation |
|---|---|
| ohm grammar — N/A (stays TS) | anchor keeps it in TS |
| ACP in Go — N/A (stays TS) | anchor keeps it in TS |
| Protocol chattiness / large-file transfer | §2 ground rules; Go owns FS reads |
| Two-process lifecycle (startup, crash, stale socket) | Go supervises TS child; reuse stale-socket unlink from external-event |
| AI streaming → Bubble Tea async | model `sessionUpdate` push frames as `tea.Msg` |
| Behavior drift during refactor | Phases A–C keep TS app working; golden tests green |
