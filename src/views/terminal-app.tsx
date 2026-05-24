import { writeFileSync } from "node:fs"
import type { AxiosResponse } from "axios"
import React, { useEffect, useRef, useState } from "react"
import { Box, Text, render, useInput, useWindowSize } from "ink"
import {
  createEditModeState,
  createAiModeState,
  findSearchMatches,
  focusSearchMatch,
  handleAiModeInput,
  handleQueryModeInput,
  handleEditModeInput,
  handleSearchModeInput,
  handleViewModeInput,
  isAppExitCommand,
  resolveModeCommand,
  serializeEditModeContent,
  type QueryModeState,
  type AiModeState,
  type EditModeState,
  type SearchModeState,
  type ViewModeState,
  TerminalMode,
} from "./key-helpers/index.ts"
import { Ai, buildAiLayout, buildAiMessageLines } from "./ai.tsx"
import {
  getAdaptor,
  type AcpAdaptorConstructor,
  type AcpAdaptorName,
  type CodexAcpPermissionRequest,
} from "../runtime/acp/index.ts"
import {
  buildExpandedDirectoryPaths,
  buildFileTreeEntries,
  readViewFile,
  resolveHighlightedEntry,
  resolveNextFileTreeSelectionIndex,
  resolveParentDirectoryCommand,
  resolveSidebarCommand,
  type OpenViewFile,
} from "../runtime/file-manager/index.ts"
import {
  commandBackgroundColor,
  commandLineHeight,
  defaultHeight,
  defaultWidth,
  editModeRequiresViewFileMessage,
  headerHeight,
  paneGap,
  requestStatsHeight,
} from "./terminal/constants.ts"
import {
  appendAcpResponse,
  findPermissionOptionId,
  formatAcpPermissionMessage,
} from "./terminal/ai-session.ts"
import { formatTerminalContent } from "./terminal/content.ts"
import { resolveEditScroll } from "./terminal/edit-scroll.ts"
import { buildFilePaneLayout } from "./terminal/file-content.tsx"
import { ResponsePane } from "./terminal/response-pane.tsx"
import { Sidebar } from "./terminal/sidebar.tsx"
import { buildTerminalViewport, normalizeLines } from "./terminal/viewport.ts"

export { buildTerminalViewport } from "./terminal/viewport.ts"

export type TerminalAppProps = {
  response?: AxiosResponse
  error?: unknown
  isPending?: boolean
  root?: string
  version?: string
  requestDurationMs?: number
  height?: number
  width?: number
  aiAdaptor?: AcpAdaptorName
  onCommand?: (command: string) => void | Promise<void>
  onExit?: () => void
}

type AcpAdapter = InstanceType<AcpAdaptorConstructor>

const resolveResponsePaneTitle = (mode: TerminalMode): string => {
  if (mode === TerminalMode.View) {
    return "Reviewing"
  }

  if (mode === TerminalMode.Edit) {
    return "Editing"
  }

  if (mode === TerminalMode.Search) {
    return "Searching"
  }

  return "Result"
}

export const TerminalApp = ({
  response,
  error,
  isPending = false,
  root,
  version,
  requestDurationMs,
  height: fixedHeight,
  width: fixedWidth,
  aiAdaptor = "codex",
  onCommand,
  onExit = () => {
    process.exit(0)
  },
}: TerminalAppProps) => {
  const { columns, rows } = useWindowSize()
  const [frameIndex, setFrameIndex] = useState(0)
  const [isCursorVisible, setIsCursorVisible] = useState(true)
  const [mode, setMode] = useState(TerminalMode.Query)
  const [queryModeState, setQueryModeState] = useState<QueryModeState>({
    scrollX: 0,
    scrollY: 0,
    command: "",
    commandCursorX: 0,
  })
  const [searchModeState, setSearchModeState] = useState<SearchModeState>({
    scrollX: 0,
    scrollY: 0,
    input: "",
    inputCursorX: 0,
    query: "",
    focusedMatchIndex: 0,
  })
  const [viewModeState, setViewModeState] = useState<ViewModeState>({
    command: "",
    commandCursorX: 0,
    scrollX: 0,
    scrollY: 0,
  })
  const [aiModeState, setAiModeState] =
    useState<AiModeState>(createAiModeState())
  const [isAiPending, setIsAiPending] = useState(false)
  const [aiPermissionRequest, setAiPermissionRequest] =
    useState<CodexAcpPermissionRequest>()
  const [editModeState, setEditModeState] = useState<EditModeState | null>(null)
  const [openViewFile, setOpenViewFile] = useState<OpenViewFile | null>(null)
  const [localError, setLocalError] = useState<unknown>()
  const [selectedCommand, setSelectedCommand] = useState("")
  const [keyboardSelectedCommand, setKeyboardSelectedCommand] = useState("")
  const aiAdapterRef = useRef<AcpAdapter | undefined>(undefined)
  const height = fixedHeight ?? rows ?? defaultHeight
  const width = fixedWidth ?? columns ?? defaultWidth
  const commandInput =
    mode === TerminalMode.View || mode === TerminalMode.Edit
      ? viewModeState.command
      : queryModeState.command
  const sidebarCommand = resolveSidebarCommand(commandInput, selectedCommand)
  const highlightedSidebarCommand = keyboardSelectedCommand || sidebarCommand
  const expandedPathsForInput = buildExpandedDirectoryPaths(sidebarCommand)
  const fileTreeEntries = buildFileTreeEntries(root, expandedPathsForInput)
  const sidebarWidth = Math.min(
    Math.max(12, Math.floor(width / 4)),
    Math.max(1, width - paneGap - 3),
  )
  const responsePaneWidth = Math.max(3, width - sidebarWidth - paneGap)
  const responseContentWidth = Math.max(1, responsePaneWidth - 2)
  const viewHeight = Math.max(
    1,
    height - headerHeight - requestStatsHeight - commandLineHeight,
  )
  const responseContentHeight = Math.max(1, viewHeight - 2)
  const highlightedEntryIndex = resolveHighlightedEntry(
    fileTreeEntries,
    highlightedSidebarCommand,
  )
  const responseContent = formatTerminalContent({
    response,
    error: localError ?? error,
    isPending,
    frameIndex,
  })
  const openFileContent =
    openViewFile && mode === TerminalMode.Edit && editModeState
      ? serializeEditModeContent(editModeState)
      : openViewFile?.content
  const content = openFileContent ?? responseContent
  const contentLines = normalizeLines(content)
  const filePaneLayout = openViewFile
    ? buildFilePaneLayout(responsePaneWidth, viewHeight, contentLines.length)
    : null
  const activeContentWidth =
    filePaneLayout?.contentWidth ?? responseContentWidth
  const activeContentHeight =
    filePaneLayout?.contentHeight ?? responseContentHeight
  const activeMaxLineWidth = contentLines.reduce(
    (currentMax, line) => Math.max(currentMax, line.length),
    0,
  )
  const activeMaxScrollX = Math.max(0, activeMaxLineWidth - activeContentWidth)
  const activeMaxScrollY = Math.max(
    0,
    contentLines.length - activeContentHeight,
  )
  const contentScrollX =
    mode === TerminalMode.Search
      ? searchModeState.scrollX
      : openViewFile
        ? viewModeState.scrollX
        : queryModeState.scrollX
  const contentScrollY =
    mode === TerminalMode.Search
      ? searchModeState.scrollY
      : openViewFile
        ? viewModeState.scrollY
        : queryModeState.scrollY
  const viewport = buildTerminalViewport(
    content,
    responseContentWidth,
    responseContentHeight,
    contentScrollX,
    contentScrollY,
  )
  const searchMatches =
    mode === TerminalMode.Search
      ? findSearchMatches(content, searchModeState.query)
      : []
  const inputValue =
    mode === TerminalMode.Search
      ? searchModeState.input
      : mode === TerminalMode.Ai
        ? aiModeState.input
        : mode === TerminalMode.Edit
          ? (editModeState?.input ?? "")
          : mode === TerminalMode.View
            ? viewModeState.command
            : queryModeState.command
  const commandInputCursorX = Math.min(
    Math.max(
      mode === TerminalMode.Edit
        ? (editModeState?.inputCursorX ?? inputValue.length)
        : mode === TerminalMode.Ai
          ? aiModeState.inputCursorX
          : mode === TerminalMode.Search
            ? (searchModeState.inputCursorX ?? inputValue.length)
            : mode === TerminalMode.View
              ? (viewModeState.commandCursorX ?? inputValue.length)
              : mode === TerminalMode.Query
                ? (queryModeState.commandCursorX ?? inputValue.length)
                : inputValue.length,
      0,
    ),
    inputValue.length,
  )
  const inputBeforeCursor = inputValue.slice(0, commandInputCursorX)
  const inputAfterCursor = inputValue.slice(commandInputCursorX)
  const promptValue = `@${mode} >`
  const aiLayout = buildAiLayout(width, height)
  const aiMessageLineCount =
    buildAiMessageLines(aiModeState.messages, aiLayout.contentWidth).length +
    (isAiPending ? 1 : 0)
  const aiMaxScrollY = Math.max(0, aiMessageLineCount - aiLayout.contentHeight)

  useEffect(() => {
    if (!isPending && !isAiPending) {
      return
    }

    const interval = setInterval(() => {
      setFrameIndex((currentFrameIndex) => currentFrameIndex + 1)
    }, 250)

    return () => {
      clearInterval(interval)
    }
  }, [isAiPending, isPending])

  useEffect(() => {
    const interval = setInterval(() => {
      setIsCursorVisible((currentValue) => !currentValue)
    }, 500)

    return () => {
      clearInterval(interval)
    }
  }, [])

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
    if (aiAdapterRef.current) {
      setAiModeState((currentState) => ({
        ...currentState,
        scrollY: 0,
      }))
      setMode(TerminalMode.Ai)
      return
    }

    const Adaptor = getAdaptor(aiAdaptor)
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
      },
      onExit: () => {
        if (aiAdapterRef.current !== adapter) {
          return
        }

        aiAdapterRef.current = undefined
        setAiPermissionRequest(undefined)
        setIsAiPending(false)
        setMode(TerminalMode.Query)
      },
    })

    aiAdapterRef.current = adapter
    setAiModeState((currentState) => ({
      ...currentState,
      scrollY: 0,
    }))
    setAiPermissionRequest(undefined)
    setIsAiPending(false)
    setLocalError(undefined)
    setMode(TerminalMode.Ai)

    void adapter.run().catch((error: unknown) => {
      if (aiAdapterRef.current !== adapter) {
        return
      }

      setLocalError(error)
    })
  }

  const closeAiMode = () => {
    setMode(TerminalMode.Query)
  }

  const stopAiMode = () => {
    aiAdapterRef.current?.stop()
  }

  const exitApp = () => {
    stopAiMode()
    onExit()
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

  const moveSidebarSelection = (direction: -1 | 1): boolean => {
    if (fileTreeEntries.length === 0) {
      return false
    }

    const nextIndex = resolveNextFileTreeSelectionIndex(
      fileTreeEntries,
      highlightedEntryIndex,
      direction,
    )
    const nextEntry = fileTreeEntries[nextIndex]

    if (!nextEntry) {
      return false
    }

    setKeyboardSelectedCommand(nextEntry.commandValue)

    return true
  }

  const moveToParentDirectory = (): boolean => {
    const currentCommand = viewModeState.command || selectedCommand
    const parentCommand = resolveParentDirectoryCommand(currentCommand)

    if (parentCommand === undefined) {
      return false
    }

    setKeyboardSelectedCommand("")
    setSelectedCommand(parentCommand)
    setViewModeState({
      ...viewModeState,
      command: parentCommand,
      commandCursorX: parentCommand.length,
      scrollX: 0,
      scrollY: 0,
    })

    return true
  }

  const moveQueryToParentDirectory = (): boolean => {
    const currentCommand = queryModeState.command || selectedCommand
    const parentCommand = resolveParentDirectoryCommand(currentCommand)

    if (parentCommand === undefined) {
      return false
    }

    setKeyboardSelectedCommand("")
    setSelectedCommand(parentCommand)
    setQueryModeState({
      ...queryModeState,
      command: parentCommand,
      commandCursorX: parentCommand.length,
    })

    return true
  }

  useInput((input, key) => {
    if (mode === TerminalMode.Ai) {
      if (key.escape) {
        closeAiMode()
        return
      }

      if (aiPermissionRequest) {
        const normalizedInput = input.toLowerCase()

        if (normalizedInput === "y" || key.return) {
          respondToAiPermission("allow")
          return
        }

        if (normalizedInput === "n") {
          respondToAiPermission("reject")
          return
        }

        return
      }

      const submittedInput = key.return ? aiModeState.input.trim() : ""
      const result = handleAiModeInput(input, key, aiModeState, {
        maxScrollY: aiMaxScrollY,
      })

      if (result.shouldExitAi) {
        closeAiMode()
        return
      }

      setAiModeState(result.state)

      if (result.shouldExitApp) {
        exitApp()
        return
      }

      if (submittedInput) {
        setIsAiPending(true)
        const writePromise = aiAdapterRef.current?.write(submittedInput)

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

      return
    }

    if (
      openViewFile &&
      (mode === TerminalMode.View || mode === TerminalMode.Edit)
    ) {
      if (mode === TerminalMode.Edit && editModeState) {
        const result = handleEditModeInput(input, key, editModeState)

        if (result.shouldSave) {
          const nextContent = serializeEditModeContent(result.state)

          try {
            writeFileSync(openViewFile.path, nextContent)
            setOpenViewFile({
              ...openViewFile,
              content: nextContent,
            })
            setLocalError(undefined)
          } catch (error) {
            setLocalError(error)
          }
        }

        if (result.shouldExitEdit) {
          setMode(TerminalMode.View)
          setEditModeState(null)
          setViewModeState({
            ...viewModeState,
            command: "",
            scrollX: 0,
            scrollY: 0,
          })
          return
        }

        const nextScroll = resolveEditScroll(
          result.state,
          responsePaneWidth,
          viewHeight,
        )

        setEditModeState(result.state)
        setViewModeState({
          ...viewModeState,
          command: "",
          scrollX: nextScroll.scrollX,
          scrollY: nextScroll.scrollY,
        })
        return
      }

      if (key.escape) {
        if (moveToParentDirectory()) {
          return
        }

        setOpenViewFile(null)
        setViewModeState({
          ...viewModeState,
          command: "",
          scrollX: 0,
          scrollY: 0,
        })
        return
      }

      const isModeCommandInput = viewModeState.command.trim().startsWith("@")
      const isViewCommandInput =
        viewModeState.command.trim() !== "" && !isModeCommandInput
      const isKeyboardSelectionInput =
        viewModeState.command.trim() === "" && keyboardSelectedCommand !== ""
      const highlightedEntry =
        isViewCommandInput || isKeyboardSelectionInput
          ? fileTreeEntries[highlightedEntryIndex]
          : undefined

      if (!isModeCommandInput && highlightedEntry && key.return) {
        setKeyboardSelectedCommand("")

        if (highlightedEntry.type === "directory") {
          setSelectedCommand(highlightedEntry.commandValue)
          setViewModeState({
            ...viewModeState,
            command: highlightedEntry.commandValue,
            commandCursorX: highlightedEntry.commandValue.length,
          })
          return
        }

        const nextOpenViewFile = readViewFile(root, highlightedEntry)

        if (nextOpenViewFile) {
          setSelectedCommand(highlightedEntry.commandValue)
          setEditModeState(null)
          setViewModeState({
            command: "",
            commandCursorX: 0,
            scrollX: 0,
            scrollY: 0,
          })
          setOpenViewFile(nextOpenViewFile)
        }

        return
      }

      const viewLines = openViewFile.content.split("\n")
      const viewLayout = buildFilePaneLayout(
        responsePaneWidth,
        viewHeight,
        viewLines.length,
      )
      const maxLineWidth = viewLines.reduce(
        (currentMax, line) => Math.max(currentMax, line.length),
        0,
      )
      const result = handleViewModeInput(input, key, viewModeState, {
        maxScrollX: Math.max(0, maxLineWidth - viewLayout.contentWidth),
        maxScrollY: Math.max(0, viewLines.length - viewLayout.contentHeight),
        viewHeight: viewLayout.contentHeight,
      })

      if (result.fileTreeSelectionDirection) {
        moveSidebarSelection(result.fileTreeSelectionDirection)
        return
      }

      if (result.shouldMoveToParentDirectory) {
        if (moveToParentDirectory()) {
          return
        }
      }

      setKeyboardSelectedCommand("")

      const nextMode =
        result.selectedCommand === undefined
          ? null
          : resolveModeCommand(result.selectedCommand)

      if (
        result.selectedCommand !== undefined &&
        isAppExitCommand(result.selectedCommand)
      ) {
        exitApp()
        return
      }

      if (nextMode === TerminalMode.Edit) {
        if (mode === TerminalMode.View) {
          setMode(TerminalMode.Edit)
          setEditModeState(createEditModeState(openViewFile.content))
          setLocalError(undefined)
        }

        setViewModeState({
          ...result.state,
          command: "",
        })
        return
      }

      if (nextMode === TerminalMode.Query) {
        setMode(TerminalMode.Query)
        setOpenViewFile(null)
        setEditModeState(null)
        setViewModeState({
          command: "",
          scrollX: 0,
          scrollY: 0,
        })
        return
      }

      if (nextMode === TerminalMode.Search) {
        setMode(TerminalMode.Search)
        setSearchModeState({
          scrollX: result.state.scrollX,
          scrollY: result.state.scrollY,
          input: "",
          query: "",
          focusedMatchIndex: 0,
        })
        setViewModeState({
          ...result.state,
          command: "",
        })
        return
      }

      if (nextMode === TerminalMode.Ai) {
        startAiMode()
        setViewModeState({
          ...result.state,
          command: "",
        })
        return
      }

      if (nextMode === TerminalMode.View) {
        setMode(TerminalMode.View)
        setViewModeState({
          ...result.state,
          command: "",
        })
        return
      }

      setViewModeState(result.state)
      return
    }

    if (mode === TerminalMode.Search) {
      const limits = {
        maxScrollX: activeMaxScrollX,
        maxScrollY: activeMaxScrollY,
        viewWidth: activeContentWidth,
        viewHeight: activeContentHeight,
      }
      const result = handleSearchModeInput(
        input,
        key,
        searchModeState,
        limits,
        searchMatches,
      )
      const nextMode =
        result.submittedQuery === undefined
          ? null
          : resolveModeCommand(result.submittedQuery)

      if (
        result.submittedQuery !== undefined &&
        isAppExitCommand(result.submittedQuery)
      ) {
        exitApp()
        return
      }

      if (nextMode === TerminalMode.Query) {
        setMode(TerminalMode.Query)
        setOpenViewFile(null)
        setEditModeState(null)
        setQueryModeState({
          ...queryModeState,
          scrollX: result.state.scrollX,
          scrollY: result.state.scrollY,
        })
        setSearchModeState({
          scrollX: result.state.scrollX,
          scrollY: result.state.scrollY,
          input: "",
          query: "",
          focusedMatchIndex: 0,
        })
        return
      }

      if (nextMode === TerminalMode.View) {
        setMode(TerminalMode.View)
        setViewModeState({
          command: "",
          scrollX: openViewFile ? result.state.scrollX : 0,
          scrollY: openViewFile ? result.state.scrollY : 0,
        })
        setSearchModeState({
          scrollX: result.state.scrollX,
          scrollY: result.state.scrollY,
          input: "",
          query: "",
          focusedMatchIndex: 0,
        })
        return
      }

      if (nextMode === TerminalMode.Ai) {
        startAiMode()
        setSearchModeState({
          ...result.state,
          input: "",
          query: "",
          focusedMatchIndex: 0,
        })
        return
      }

      if (nextMode === TerminalMode.Edit) {
        if (openViewFile) {
          const focusedMatch = searchMatches[searchModeState.focusedMatchIndex]
          const nextEditModeState = {
            ...createEditModeState(openViewFile.content),
            cursorX: focusedMatch?.start ?? result.state.scrollX,
            cursorY: focusedMatch?.lineIndex ?? result.state.scrollY,
          }

          setMode(TerminalMode.Edit)
          setEditModeState(nextEditModeState)
          setViewModeState({
            command: "",
            scrollX: result.state.scrollX,
            scrollY: result.state.scrollY,
          })
          setSearchModeState({
            ...result.state,
            input: "",
            query: "",
            focusedMatchIndex: 0,
          })
          setLocalError(undefined)
          return
        }

        setLocalError(new Error(editModeRequiresViewFileMessage))
        setSearchModeState({
          ...result.state,
          input: "",
          query: "",
          focusedMatchIndex: 0,
        })
        return
      }

      const nextMatches = findSearchMatches(content, result.state.query)
      const nextState =
        result.submittedQuery === undefined
          ? result.state
          : focusSearchMatch(result.state, limits, nextMatches, 0)

      setSearchModeState(nextState)
      return
    }

    if (mode === TerminalMode.View) {
      const isModeCommandInput = viewModeState.command.trim().startsWith("@")
      const isViewCommandInput =
        viewModeState.command.trim() !== "" && !isModeCommandInput
      const isKeyboardSelectionInput =
        viewModeState.command.trim() === "" && keyboardSelectedCommand !== ""
      const highlightedEntry =
        isViewCommandInput || isKeyboardSelectionInput
          ? fileTreeEntries[highlightedEntryIndex]
          : undefined

      if (!isModeCommandInput && highlightedEntry && key.return) {
        setKeyboardSelectedCommand("")

        if (highlightedEntry.type === "directory") {
          setSelectedCommand(highlightedEntry.commandValue)
          setViewModeState({
            ...viewModeState,
            command: highlightedEntry.commandValue,
            commandCursorX: highlightedEntry.commandValue.length,
          })
          return
        }

        const nextOpenViewFile = readViewFile(root, highlightedEntry)

        if (nextOpenViewFile) {
          setSelectedCommand(highlightedEntry.commandValue)
          setEditModeState(null)
          setViewModeState({
            command: "",
            scrollX: 0,
            scrollY: 0,
          })
          setOpenViewFile(nextOpenViewFile)
        }

        return
      }

      const result = handleViewModeInput(input, key, viewModeState)

      if (result.fileTreeSelectionDirection) {
        moveSidebarSelection(result.fileTreeSelectionDirection)
        return
      }

      if (result.shouldMoveToParentDirectory) {
        if (moveToParentDirectory()) {
          return
        }
      }

      setKeyboardSelectedCommand("")

      const nextMode =
        result.selectedCommand === undefined
          ? null
          : resolveModeCommand(result.selectedCommand)

      if (
        result.selectedCommand !== undefined &&
        isAppExitCommand(result.selectedCommand)
      ) {
        exitApp()
        return
      }

      if (nextMode === TerminalMode.Query) {
        setMode(TerminalMode.Query)
        setViewModeState({
          command: "",
          scrollX: 0,
          scrollY: 0,
        })
        return
      }

      if (nextMode === TerminalMode.Search) {
        setMode(TerminalMode.Search)
        setSearchModeState({
          scrollX: queryModeState.scrollX,
          scrollY: queryModeState.scrollY,
          input: "",
          query: "",
          focusedMatchIndex: 0,
        })
        setViewModeState({
          command: "",
          scrollX: 0,
          scrollY: 0,
        })
        return
      }

      if (nextMode === TerminalMode.Ai) {
        startAiMode()
        setViewModeState({
          command: "",
          scrollX: 0,
          scrollY: 0,
        })
        return
      }

      if (nextMode === TerminalMode.View) {
        setViewModeState({
          command: "",
          scrollX: 0,
          scrollY: 0,
        })
        return
      }

      if (nextMode === TerminalMode.Edit) {
        setLocalError(new Error(editModeRequiresViewFileMessage))
        setViewModeState({
          command: "",
          scrollX: 0,
          scrollY: 0,
        })
        return
      }

      setViewModeState(result.state)
      return
    }

    const isModeCommandInput = queryModeState.command.trim().startsWith("@")
    const isQueryCommandInput =
      queryModeState.command.trim() !== "" && !isModeCommandInput
    const isKeyboardSelectionInput =
      queryModeState.command.trim() === "" && keyboardSelectedCommand !== ""
    const highlightedEntry =
      isQueryCommandInput || isKeyboardSelectionInput
        ? fileTreeEntries[highlightedEntryIndex]
        : undefined

    if (!isModeCommandInput && highlightedEntry && key.return) {
      setKeyboardSelectedCommand("")

      if (highlightedEntry.type === "directory") {
        setSelectedCommand(highlightedEntry.commandValue)
        setQueryModeState({
          ...queryModeState,
          command: highlightedEntry.commandValue,
          commandCursorX: highlightedEntry.commandValue.length,
        })
        return
      }

      if (highlightedEntry.type === "request") {
        setSelectedCommand(highlightedEntry.commandValue)
        setQueryModeState({
          ...queryModeState,
          command: "",
        })
        onCommand?.(highlightedEntry.commandValue)
        return
      }

      setSelectedCommand(highlightedEntry.commandValue)
      setQueryModeState({
        ...queryModeState,
        command: highlightedEntry.commandValue,
        commandCursorX: highlightedEntry.commandValue.length,
      })
      return
    }

    const result = handleQueryModeInput(input, key, queryModeState, {
      maxScrollX: viewport.maxScrollX,
      maxScrollY: viewport.maxScrollY,
      viewHeight: responseContentHeight,
    })

    if (result.fileTreeSelectionDirection) {
      moveSidebarSelection(result.fileTreeSelectionDirection)
      return
    }

    if (result.shouldMoveToParentDirectory) {
      if (moveQueryToParentDirectory()) {
        return
      }
    }

    setKeyboardSelectedCommand("")

    const nextMode =
      result.command === undefined ? null : resolveModeCommand(result.command)

    if (result.command !== undefined && isAppExitCommand(result.command)) {
      exitApp()
      return
    }

    if (nextMode === TerminalMode.Search) {
      setMode(TerminalMode.Search)
      setSearchModeState({
        scrollX: result.state.scrollX,
        scrollY: result.state.scrollY,
        input: "",
        query: "",
        focusedMatchIndex: 0,
      })
      setQueryModeState(result.state)
      return
    }

    if (nextMode === TerminalMode.View) {
      setMode(TerminalMode.View)
      setViewModeState({
        command: "",
        scrollX: 0,
        scrollY: 0,
      })
      setQueryModeState(result.state)
      return
    }

    if (nextMode === TerminalMode.Ai) {
      startAiMode()
      setQueryModeState(result.state)
      return
    }

    if (nextMode === TerminalMode.Edit) {
      setLocalError(new Error(editModeRequiresViewFileMessage))
      setQueryModeState(result.state)
      return
    }

    setQueryModeState(result.state)

    if (result.command !== undefined && nextMode === null) {
      if (result.command.trim()) {
        setSelectedCommand(result.command)
      }
      setLocalError(undefined)
      onCommand?.(result.command)
    }
  })

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      position="relative"
    >
      <Box flexDirection="column" width={width} height={headerHeight}>
        <Text bold>{">_ Ntee R1quest"}</Text>
        {version && <Text color="#006400">{`ver: ${version}`}</Text>}
      </Box>
      <Box width={width} height={requestStatsHeight}>
        <Text>{`◷ Time Spend ${requestDurationMs ?? 0} ms,`}</Text>
      </Box>
      <Box width={width} height={viewHeight} columnGap={paneGap}>
        <Sidebar
          entries={fileTreeEntries}
          highlightedIndex={highlightedEntryIndex}
          width={sidebarWidth}
          height={viewHeight}
        />
        <ResponsePane
          title={resolveResponsePaneTitle(mode)}
          contentLines={contentLines}
          viewport={viewport}
          searchMatches={searchMatches}
          focusedMatchIndex={searchModeState.focusedMatchIndex}
          width={responsePaneWidth}
          height={viewHeight}
          fileContent={
            openViewFile && openFileContent
              ? {
                  fileName: openViewFile.fileName,
                  content: openFileContent,
                  scrollX: contentScrollX,
                  scrollY: contentScrollY,
                  isEditing: mode === TerminalMode.Edit,
                  cursorX: editModeState?.cursorX,
                  cursorY: editModeState?.cursorY,
                  input: editModeState?.input,
                  isSavePromptOpen: editModeState?.isSavePromptOpen,
                  selectedSaveAction: editModeState?.selectedSaveAction,
                }
              : undefined
          }
        />
      </Box>
      <Box
        width={width}
        height={commandLineHeight}
        backgroundColor={commandBackgroundColor}
      >
        <Text backgroundColor={commandBackgroundColor}>{promptValue}</Text>
        <Text backgroundColor={commandBackgroundColor}>
          {inputBeforeCursor}
        </Text>
        <Text bold backgroundColor={commandBackgroundColor}>
          {isCursorVisible ? "_" : " "}
        </Text>
        <Text backgroundColor={commandBackgroundColor}>{inputAfterCursor}</Text>
      </Box>
      {mode === TerminalMode.Ai && (
        <Ai
          width={width}
          height={height}
          input={aiModeState.input}
          inputCursorX={aiModeState.inputCursorX}
          isCursorVisible={isCursorVisible}
          messages={aiModeState.messages}
          scrollY={aiModeState.scrollY}
          isPending={isAiPending}
          pendingFrameIndex={frameIndex}
          permissionMessage={
            aiPermissionRequest
              ? formatAcpPermissionMessage(aiPermissionRequest)
              : undefined
          }
        />
      )}
    </Box>
  )
}

export const displayTerminalApp = (props: TerminalAppProps) => {
  return render(<TerminalApp {...props} />)
}
