import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react"
import type { SessionUpdate } from "@agentclientprotocol/sdk"
import { createAiModeState, type AiModeState } from "../key-helpers/index.ts"
import { TerminalMode } from "../../runtime/app-command/index.ts"
import {
  listAdaptors,
  type AcpAdaptorName,
  type CodexAcpConversation,
  type CodexAcpPermissionRequest,
  type CodexAcpResponse,
} from "../../runtime/acp/index.ts"
import { appendAcpResponse, findPermissionOptionId } from "./ai-session.ts"
import type {
  RuntimeClient,
  RuntimeEventHandlers,
} from "../../runtime/client/runtime-client.ts"
import type {
  AiSessionStarted,
  AiSessionStopped,
  AiSessionUpdate,
} from "../../runtime/client/types.ts"

// The "AI is thinking" indicator follows real work, not the raw prompt() turn.
// Some agents (e.g. Claude Code launching a background job) leave the prompt
// turn open after replying, so we can't rely on it closing. The indicator stays
// on while the turn is active and the agent is busy — output is streaming, a
// tool call is still in progress, or an update arrived within the quiet window —
// and goes idle only once all of those are false.
const AI_THINKING_QUIET_MS = 3000
const AI_THINKING_TICK_MS = 500
const TERMINAL_TOOL_STATUSES = new Set(["completed", "failed"])

// Decides whether the "AI is thinking" indicator should be on for an active
// turn. Busy = no reply has streamed yet, a tool call is still running, or an
// update arrived within the quiet window. Idle (all false) is the
// background-task case where the prompt turn is left open with nothing happening.
export const shouldShowAiThinking = ({
  hasStreamed,
  inProgressToolCount,
  msSinceLastActivity,
}: {
  hasStreamed: boolean
  inProgressToolCount: number
  msSinceLastActivity: number
}): boolean => {
  return (
    !hasStreamed ||
    inProgressToolCount > 0 ||
    msSinceLastActivity < AI_THINKING_QUIET_MS
  )
}

// Tracks which tool calls are still running so a long foreground task keeps the
// indicator on until its tool actually completes.
export const trackToolStatus = (
  inProgress: Set<string>,
  update: SessionUpdate,
): void => {
  if (update.sessionUpdate === "tool_call") {
    if (update.status && TERMINAL_TOOL_STATUSES.has(update.status)) {
      inProgress.delete(update.toolCallId)
    } else {
      inProgress.add(update.toolCallId)
    }

    return
  }

  if (update.sessionUpdate === "tool_call_update" && update.status) {
    if (TERMINAL_TOOL_STATUSES.has(update.status)) {
      inProgress.delete(update.toolCallId)
    } else {
      inProgress.add(update.toolCallId)
    }
  }
}

type UseAiControllerParams = {
  client: RuntimeClient
  aiAdaptor?: AcpAdaptorName
  setLocalError: Dispatch<SetStateAction<unknown>>
  setMode: Dispatch<SetStateAction<TerminalMode>>
}

// Owns AI *view* state (messages, conversations, permission overlay, thinking
// indicator) and drives turns through `client.ai`. The adapter lifecycle lives
// in the runtime client now; this hook consumes the client's events (returned
// as `aiEventHandlers` for the parent to register via `client.subscribe`).
export const useAiController = ({
  client,
  aiAdaptor,
  setLocalError,
  setMode,
}: UseAiControllerParams) => {
  const [aiModeState, setAiModeState] =
    useState<AiModeState>(createAiModeState())
  const [isAiPending, setIsAiPending] = useState(false)
  const [isAiOffline, setIsAiOffline] = useState(false)
  // True once a session has been started for this run. Drives whether the next
  // @ai is a first-time start (offer the session picker) or a reuse.
  const [isAiActive, setIsAiActive] = useState(false)
  const [aiConversations, setAiConversations] = useState<
    CodexAcpConversation[]
  >([])
  const [aiPermissionRequest, setAiPermissionRequest] =
    useState<CodexAcpPermissionRequest>()
  const [isAiThinking, setIsAiThinking] = useState(false)
  const lastAiActivityRef = useRef(0)
  const aiHasStreamedRef = useRef(false)
  const inProgressToolsRef = useRef<Set<string>>(new Set())

  // While a prompt turn is open, re-evaluate whether the agent is still busy.
  useEffect(() => {
    if (!isAiPending) {
      setIsAiThinking(false)
      return
    }

    const evaluate = () => {
      setIsAiThinking(
        shouldShowAiThinking({
          hasStreamed: aiHasStreamedRef.current,
          inProgressToolCount: inProgressToolsRef.current.size,
          msSinceLastActivity: Date.now() - lastAiActivityRef.current,
        }),
      )
    }

    evaluate()
    const interval = setInterval(evaluate, AI_THINKING_TICK_MS)

    return () => {
      clearInterval(interval)
    }
  }, [isAiPending])

  // Stop the agent when the app exits or this hook unmounts.
  useEffect(() => {
    const stop = () => {
      client.ai.stop()
    }

    process.once("exit", stop)

    return () => {
      process.off("exit", stop)
      stop()
    }
  }, [client])

  // ── Event handlers (registered by the parent via client.subscribe) ──────────

  const handleSessionUpdate = useCallback((event: AiSessionUpdate) => {
    // Record streaming activity so the thinking indicator follows real work.
    lastAiActivityRef.current = Date.now()
    aiHasStreamedRef.current = true

    const response = event as CodexAcpResponse

    trackToolStatus(inProgressToolsRef.current, response.update)
    setAiModeState((currentState) => appendAcpResponse(currentState, response))
  }, [])

  const handleConversationUpdate = useCallback((conversation: unknown) => {
    const next = conversation as CodexAcpConversation

    setAiConversations((currentConversations) => {
      const existingIndex = currentConversations.findIndex(
        (currentConversation) => currentConversation.id === next.id,
      )

      if (existingIndex === -1) {
        return [...currentConversations, next]
      }

      return currentConversations.map((currentConversation, index) =>
        index === existingIndex ? next : currentConversation,
      )
    })
  }, [])

  const handlePermissionRequest = useCallback((request: unknown) => {
    setAiPermissionRequest(request as CodexAcpPermissionRequest)
  }, [])

  const handleSessionStarted = useCallback(({ resumed }: AiSessionStarted) => {
    setIsAiOffline(false)
    setIsAiActive(true)

    // When resuming, drop a divider after the replayed history so the user can
    // see what came from the past. Skip when there was nothing to replay.
    if (!resumed) {
      return
    }

    setAiModeState((currentState) => {
      const lastMessage = currentState.messages.at(-1)

      if (
        currentState.messages.length === 0 ||
        lastMessage?.role === "divider"
      ) {
        return currentState
      }

      return {
        ...currentState,
        messages: [...currentState.messages, { role: "divider", content: "" }],
      }
    })
  }, [])

  const handleSessionStopped = useCallback(
    ({ error }: AiSessionStopped) => {
      setIsAiPending(false)
      setIsAiOffline(true)
      setIsAiActive(false)
      setAiConversations([])
      setAiPermissionRequest(undefined)

      if (error !== undefined) {
        setLocalError(error)
      }
    },
    [setLocalError],
  )

  const handleSessionError = useCallback(
    (error: unknown) => {
      setLocalError(error)
      setIsAiPending(false)
    },
    [setLocalError],
  )

  const aiEventHandlers = useMemo<RuntimeEventHandlers>(
    () => ({
      onSessionUpdate: handleSessionUpdate,
      onConversationUpdate: handleConversationUpdate,
      onPermissionRequest: handlePermissionRequest,
      onSessionStarted: handleSessionStarted,
      onSessionStopped: handleSessionStopped,
      onSessionError: handleSessionError,
    }),
    [
      handleSessionUpdate,
      handleConversationUpdate,
      handlePermissionRequest,
      handleSessionStarted,
      handleSessionStopped,
      handleSessionError,
    ],
  )

  // ── Actions ─────────────────────────────────────────────────────────────────

  // resumeSessionId resumes an existing agent session; omit it to start fresh.
  const startAiMode = (resumeSessionId?: string) => {
    if (!aiAdaptor) {
      const supportedAdaptors = listAdaptors().join(" or -ai ")

      setLocalError(
        new Error(
          `AI agent undeclared. Update .r1qconfig.yaml with an "ai" value or start the app with -ai ${supportedAdaptors}.`,
        ),
      )
      return
    }

    // A live session just reopens the pane.
    if (isAiActive) {
      setAiModeState((currentState) => ({ ...currentState, scrollY: 0 }))
      setMode(TerminalMode.Ai)
      return
    }

    setAiModeState((currentState) => ({ ...currentState, scrollY: 0 }))
    setAiPermissionRequest(undefined)
    setAiConversations([])
    setIsAiPending(false)
    setIsAiOffline(false)
    setIsAiActive(true)
    setLocalError(undefined)
    setMode(TerminalMode.Ai)

    void client.ai
      .start({ adaptor: aiAdaptor, resumeSessionId })
      .catch((error: unknown) => {
        setLocalError(error)
      })
  }

  const closeAiMode = () => {
    setMode(TerminalMode.Query)
  }

  const stopAiMode = () => {
    client.ai.stop()
  }

  const resetAiMode = () => {
    client.ai.stop()
    setAiModeState(createAiModeState())
    setIsAiPending(false)
    setIsAiOffline(false)
    setIsAiActive(false)
    setAiConversations([])
    setAiPermissionRequest(undefined)
  }

  const respondToAiPermission = (decision: "allow" | "reject") => {
    if (!aiPermissionRequest) {
      return
    }

    const optionId = findPermissionOptionId(aiPermissionRequest, decision)

    if (!optionId) {
      setLocalError(new Error(`No ${decision} permission option is available.`))
      return
    }

    setAiPermissionRequest(undefined)
    void client.ai
      .respondPermission({ type: "selected", optionId })
      .catch((error: unknown) => {
        setLocalError(error)
      })
  }

  const writeAiInput = (input: string) => {
    setIsAiPending(true)
    // Reset per-turn activity so the thinking indicator reflects this prompt.
    lastAiActivityRef.current = Date.now()
    aiHasStreamedRef.current = false
    inProgressToolsRef.current = new Set()
    setIsAiThinking(true)

    void client.ai
      .prompt(input)
      .then(() => {
        setIsAiPending(false)
      })
      .catch((error: unknown) => {
        setIsAiPending(false)
        setLocalError(error)
      })
  }

  return {
    aiModeState,
    setAiModeState,
    isAiPending,
    isAiThinking,
    isAiOffline,
    isAiActive,
    aiConversations,
    aiPermissionRequest,
    aiEventHandlers,
    startAiMode,
    closeAiMode,
    stopAiMode,
    resetAiMode,
    respondToAiPermission,
    writeAiInput,
  }
}
