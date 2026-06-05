import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react"
import {
  createAiModeState,
  TerminalMode,
  type AiModeState,
} from "../key-helpers/index.ts"
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
    isAiOffline,
    aiConversations,
    aiPermissionRequest,
    startAiMode,
    closeAiMode,
    stopAiMode,
    respondToAiPermission,
    writeAiInput,
  }
}
