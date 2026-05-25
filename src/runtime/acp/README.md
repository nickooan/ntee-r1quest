# ACP Runtime

```text
Terminal UI
  |
  | new CodexAcpAdapter / ClaudeCodeAcpAdapter
  v
ACP Adapter
  |-- run()
  |     | spawn provider ACP binary
  |     | initialize ACP connection
  |     ` create ACP session
  |
  |-- write(prompt)
  |     | create conversation record
  |     | send session/prompt request
  |     ` mark conversation completed / failed when prompt resolves
  |
  |-- write(permission)
  |     ` resolve the pending permission request
  |
  |<-- sessionUpdate notifications
  |     | record update on active conversation
  |     ` call onResponse({ sessionId, update })
  |
  |<-- requestPermission requests
  |     | call onPermissionRequest(request)
  |     ` wait for write({ type: "permission", ... }) if not answered
  v
Agent ACP Process
  | Codex: @zed-industries/codex-acp
  | Claude: @agentclientprotocol/claude-agent-acp
```

## Files

- `codex-adapt.ts` starts and talks to the Codex ACP process.
- `claude-code-adapt.ts` starts and talks to the Claude Code ACP process.
- `conversation-manager.ts` tracks prompt conversations shared by both adapters.
- `index.ts` exports adapter classes, constructors, and public types.

## Adapter Lifecycle

Adapters expose the same public API so the UI can switch providers through
`getAdaptor()` without changing prompt, permission, or lifecycle code.

`run()` starts the provider ACP binary with `node`, creates an
`ndJsonStream`, initializes the ACP connection, and creates a new ACP session.
Concurrent startup calls share `runPromise`, so rapid prompt submission does not
spawn duplicate agent processes.

`stop()` cancels any pending permission request, kills the child process, clears
the connection/session references, and resets the active conversation pointer.

## Sending Input

`write()` accepts either a prompt or a permission decision.

```ts
await adapter.write("inspect this request")

await adapter.write({
  type: "permission",
  decision: {
    type: "selected",
    optionId: "approved",
  },
})
```

For prompt input, the adapter trims the text, ensures the ACP session exists,
creates a conversation record, then calls `connection.prompt()` with a generated
ACP `messageId`. The prompt promise resolves when the agent finishes that ACP
turn. Multiple prompts are allowed to be sent while an earlier prompt is still
running; they are not serialized behind a local queue.

For permission input, the adapter resolves the currently pending ACP permission
request. If no permission request is pending, `write()` rejects.

## Receiving Output

Agent output arrives through ACP `sessionUpdate` notifications. The adapter does
two things for each update:

1. Records the update on the active conversation through `AcpConversationManager`.
2. Calls `onResponse({ sessionId, update })` so the UI can render assistant
   chunks, tool calls, plans, and other ACP updates.

The UI should treat `onResponse` as the streaming display path. Conversation
records are trace/debug state, not the primary rendering path.

## Permissions

When the agent asks for permission, ACP calls `requestPermission`.

The adapter first calls `onPermissionRequest(request)`.

- If that callback returns a decision, the adapter immediately converts it into
  an ACP permission response.
- If it returns `void`, the adapter stores the request and waits until the UI
  later calls `write({ type: "permission", decision })`.

Stopping the adapter cancels any unresolved permission request.

## Conversation Manager

`AcpConversationManager` owns prompt conversation bookkeeping:

```text
Adapter.sendPrompt(text)
  |
  | createConversation(sessionId, text)
  v
Conversation Manager
  |
  | generate UUID
  | store id, sessionId, prompt
  | set status: pending
  | initialize timestamps and updates
  | set activeConversationId
  | emit onConversationUpdate(snapshot)
  v
Adapter sends connection.prompt({
  sessionId,
  messageId: conversation.id,
  prompt,
})


ACP sessionUpdate
  |
  | recordConversationUpdate(update)
  v
Conversation Manager
  |
  | find active pending conversation
  | append update
  | refresh updatedAt
  | emit onConversationUpdate(snapshot)


Prompt promise resolves                 Prompt promise rejects
  |                                      |
  | completeConversation(id, response)   | failConversation(id, error)
  v                                      v
Conversation Manager                    Conversation Manager
  |                                      |
  | set status: completed                | set status: failed
  | store response                       | store error
  | store acknowledgedMessageId          | set completedAt
  | set completedAt / updatedAt          | set updatedAt
  | choose next pending active id        | choose next pending active id
  | emit onConversationUpdate(snapshot)  | emit onConversationUpdate(snapshot)
```

- creates a conversation id with `randomUUID()`
- stores prompt text, session id, timestamps, updates, status, response, and
  error
- exposes `promptConversations`
- exposes `unfinishedPromptConversations`
- records ACP session updates on the active pending conversation
- marks conversations `completed` or `failed`
- emits isolated snapshot copies through `onConversationUpdate`

The manager tracks the latest active pending conversation. When that conversation
finishes, it falls back to the most recently created pending conversation. This
matters when a user sends another prompt while an earlier prompt is still
running.

Conversation data is intentionally provider-neutral. Both Codex and Claude
adapters alias the shared `AcpConversation` type to provider-specific public
names such as `CodexAcpConversation` and `ClaudeCodeAcpConversation`.

## UI Pending State

The visible `AI is thinking` animation is controlled by UI state around
`write(prompt)`, not directly by the conversation manager. ACP conversation
records can remain pending for provider-specific reasons, especially around
tools or long-lived processes, so they are useful for tracing but are not a
clean user-facing pending signal.
