import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react"
import type { SessionUpdate } from "@agentclientprotocol/sdk"
import { createAiModeState, type AiModeState } from "../key-helpers/index.ts"
import { TerminalMode } from "../../runtime/app-command/index.ts"
import {
  getAdaptor,
  listAdaptors,
  type AcpAdaptorConstructor,
  type AcpAdaptorName,
  type CodexAcpConversation,
  type CodexAcpPermissionRequest,
} from "../../runtime/acp/index.ts"
import { appendAcpResponse, findPermissionOptionId } from "./ai-session.ts"

type AcpAdapter = InstanceType<AcpAdaptorConstructor>

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
  aiAdaptor?: AcpAdaptorName
  root?: string
  setLocalError: Dispatch<SetStateAction<unknown>>
  setMode: Dispatch<SetStateAction<TerminalMode>>
}

export const useAiController = ({
  aiAdaptor,
  root,
  setLocalError,
  setMode,
}: UseAiControllerParams) => {
  const [aiModeState, setAiModeState] =
    useState<AiModeState>(createAiModeState())
  const [isAiPending, setIsAiPending] = useState(false)
  const [isAiOffline, setIsAiOffline] = useState(false)
  const [aiConversations, setAiConversations] = useState<
    CodexAcpConversation[]
  >([])
  const [aiPermissionRequest, setAiPermissionRequest] =
    useState<CodexAcpPermissionRequest>()
  const aiAdapterRef = useRef<AcpAdapter | undefined>(undefined)
  const [isAiThinking, setIsAiThinking] = useState(false)
  const lastAiActivityRef = useRef(0)
  const aiHasStreamedRef = useRef(false)
  const inProgressToolsRef = useRef<Set<string>>(new Set())

  // While a prompt turn is open, re-evaluate whether the agent is still busy.
  // Going idle requires: a reply has streamed, no tool call is in progress, and
  // no update arrived within AI_THINKING_QUIET_MS (the background-task case).
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

  useEffect(() => {
    const stopAiAdapter = () => {
      const adapter = aiAdapterRef.current

      aiAdapterRef.current = undefined
      adapter?.stop()
    }

    process.once("exit", stopAiAdapter)

    return () => {
      process.off("exit", stopAiAdapter)
      stopAiAdapter()
    }
  }, [])

  const startAiMode = () => {
    if (!aiAdaptor) {
      const supportedAdaptors = listAdaptors().join(" or -ai ")

      setLocalError(
        new Error(
          `AI agent undeclared. Update .r1qconfig.yaml with an "ai" value or start the app with -ai ${supportedAdaptors}.`,
        ),
      )
      return
    }

    if (aiAdapterRef.current) {
      setAiModeState((currentState) => ({
        ...currentState,
        scrollY: 0,
      }))
      setMode(TerminalMode.Ai)
      return
    }

    const Adaptor = getAdaptor(aiAdaptor)
    let isAdapterReady = false
    const adapter = new Adaptor({
      cwd: root ?? process.cwd(),
      onResponse: (response) => {
        if (aiAdapterRef.current !== adapter) {
          return
        }

        // Record streaming activity so the thinking indicator follows real work.
        lastAiActivityRef.current = Date.now()
        aiHasStreamedRef.current = true
        trackToolStatus(inProgressToolsRef.current, response.update)
        setIsAiThinking(true)

        setAiModeState((currentState) => {
          return appendAcpResponse(currentState, response)
        })
      },
      onConversationUpdate: (conversation) => {
        if (aiAdapterRef.current !== adapter) {
          return
        }

        setAiConversations((currentConversations) => {
          const existingIndex = currentConversations.findIndex(
            (currentConversation) => {
              return currentConversation.id === conversation.id
            },
          )

          if (existingIndex === -1) {
            return [...currentConversations, conversation]
          }

          return currentConversations.map((currentConversation, index) => {
            return index === existingIndex ? conversation : currentConversation
          })
        })
      },
      onPermissionRequest: (request) => {
        if (aiAdapterRef.current !== adapter) {
          return
        }

        setAiPermissionRequest(request)
      },
      onError: (error) => {
        if (aiAdapterRef.current !== adapter) {
          return
        }

        setLocalError(error)
        setIsAiPending(false)

        if (!isAdapterReady) {
          aiAdapterRef.current = undefined
          adapter.stop()
          setAiPermissionRequest(undefined)
          setAiConversations([])
          setIsAiOffline(true)
        }
      },
      onExit: () => {
        if (aiAdapterRef.current !== adapter) {
          return
        }

        aiAdapterRef.current = undefined
        setAiPermissionRequest(undefined)
        setAiConversations([])
        setIsAiPending(false)
        setIsAiOffline(true)
      },
    })

    aiAdapterRef.current = adapter
    setIsAiOffline(false)
    setAiModeState((currentState) => ({
      ...currentState,
      scrollY: 0,
    }))
    setAiPermissionRequest(undefined)
    setAiConversations([])
    setIsAiPending(false)
    setLocalError(undefined)
    setMode(TerminalMode.Ai)

    void adapter
      .run()
      .then(() => {
        if (aiAdapterRef.current === adapter) {
          isAdapterReady = true
          setIsAiOffline(false)
        }
      })
      .catch((error: unknown) => {
        if (aiAdapterRef.current !== adapter) {
          return
        }

        aiAdapterRef.current = undefined
        adapter.stop()
        setAiPermissionRequest(undefined)
        setAiConversations([])
        setIsAiPending(false)
        setIsAiOffline(true)
        setLocalError(error)
      })
  }

  const closeAiMode = () => {
    setMode(TerminalMode.Query)
  }

  const stopAiMode = () => {
    aiAdapterRef.current?.stop()
  }

  const resetAiMode = () => {
    const adapter = aiAdapterRef.current

    aiAdapterRef.current = undefined
    adapter?.stop()
    setAiModeState(createAiModeState())
    setIsAiPending(false)
    setIsAiOffline(false)
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
    void aiAdapterRef.current
      ?.write({
        type: "permission",
        decision: {
          type: "selected",
          optionId,
        },
      })
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

    const writePromise = aiAdapterRef.current?.write(input)

    if (!writePromise) {
      setIsAiPending(false)
      return
    }

    void writePromise
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
    aiConversations,
    aiPermissionRequest,
    startAiMode,
    closeAiMode,
    stopAiMode,
    resetAiMode,
    respondToAiPermission,
    writeAiInput,
  }
}
