import { writeFileSync } from "node:fs"
import type { AxiosResponse } from "axios"
import { useEffect, useMemo, useState } from "react"
import { Box, Text, render, useInput, useWindowSize } from "ink"
import {
  findSearchMatches,
  focusSearchMatch,
  handleAiModeInput,
  handleQueryModeInput,
  handleEditModeInput,
  handleSearchModeInput,
  handleViewModeInput,
  isQuickSwitchKey,
  serializeEditModeContent,
  type QueryModeState,
  type EditModeState,
  type AiModeState,
  type SearchModeState,
  type ViewModeState,
} from "./key-helpers/index.ts"
import {
  resolveQuickSwitchMode,
  resolveAppInputCommand,
  TerminalMode,
} from "../runtime/app-command/index.ts"
import { Ai, buildAiLayout, buildAiMessageLines } from "./ai.tsx"
import type { AcpAdaptorName } from "../runtime/acp/index.ts"
import {
  buildExternalEventCommand,
  startExternalEventListener,
  type ExternalEventListener,
  type ExternalRequestEvent,
} from "../runtime/external-event/index.ts"
import {
  buildExpandedDirectoryPaths,
  buildFileTreeEntries,
  readViewFile,
  resolveHighlightedEntry,
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
import { formatAcpPermissionMessage } from "./terminal/ai-session.ts"
import { BlinkingCursor } from "./terminal/blinking-cursor.tsx"
import { useAiController } from "./terminal/ai-controller.ts"
import { formatTerminalContent } from "./terminal/content.ts"
import { resolveEditScroll } from "./terminal/edit-scroll.ts"
import { useEditSuggestions } from "./terminal/edit-suggestions.ts"
import { buildFilePaneLayout } from "./terminal/file-content.tsx"
import { useFileNavigation } from "./terminal/file-navigation.ts"
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
  externalEventSocket?: string
  height?: number
  width?: number
  aiAdaptor?: AcpAdaptorName
  onCommand?: (command: string) => void | Promise<void>
  onReload?: () => void
  onExit?: () => void
}

type InputStateByMode = {
  aiModeState: AiModeState
  editModeState: EditModeState | null
  queryModeState: QueryModeState
  searchModeState: SearchModeState
  viewModeState: ViewModeState
}

const cursorBlinkIdleMs = 30_000

const createQueryModeState = (): QueryModeState => ({
  scrollX: 0,
  scrollY: 0,
  command: "",
  commandCursorX: 0,
})

const createSearchModeState = (): SearchModeState => ({
  scrollX: 0,
  scrollY: 0,
  input: "",
  inputCursorX: 0,
  query: "",
  focusedMatchIndex: 0,
})

const createViewModeState = (): ViewModeState => ({
  command: "",
  commandCursorX: 0,
  scrollX: 0,
  scrollY: 0,
})

const resolveInputValue = (
  mode: TerminalMode,
  states: InputStateByMode,
): string => {
  if (mode === TerminalMode.Search) {
    return states.searchModeState.input
  }

  if (mode === TerminalMode.Ai) {
    return states.aiModeState.input
  }

  if (mode === TerminalMode.Edit) {
    return states.editModeState?.input ?? ""
  }

  if (mode === TerminalMode.View) {
    return states.viewModeState.command
  }

  return states.queryModeState.command
}

const resolveInputCursorX = (
  mode: TerminalMode,
  inputLength: number,
  states: InputStateByMode,
): number => {
  let cursorX = inputLength

  if (mode === TerminalMode.Edit) {
    cursorX = states.editModeState?.inputCursorX ?? inputLength
  } else if (mode === TerminalMode.Ai) {
    cursorX = states.aiModeState.inputCursorX
  } else if (mode === TerminalMode.Search) {
    cursorX = states.searchModeState.inputCursorX ?? inputLength
  } else if (mode === TerminalMode.View) {
    cursorX = states.viewModeState.commandCursorX ?? inputLength
  } else if (mode === TerminalMode.Query) {
    cursorX = states.queryModeState.commandCursorX ?? inputLength
  }

  return Math.min(Math.max(cursorX, 0), inputLength)
}

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
  externalEventSocket,
  height: fixedHeight,
  width: fixedWidth,
  aiAdaptor,
  onCommand,
  onReload,
  onExit = () => {
    process.exit(0)
  },
}: TerminalAppProps) => {
  const { columns, rows } = useWindowSize()
  const [frameIndex, setFrameIndex] = useState(0)
  const [isCursorBlinkActive, setIsCursorBlinkActive] = useState(true)
  const [cursorActivityId, setCursorActivityId] = useState(0)
  const [mode, setMode] = useState(TerminalMode.Query)
  const [queryModeState, setQueryModeState] =
    useState<QueryModeState>(createQueryModeState)
  const [searchModeState, setSearchModeState] = useState<SearchModeState>(
    createSearchModeState,
  )
  const [viewModeState, setViewModeState] =
    useState<ViewModeState>(createViewModeState)
  const [editModeState, setEditModeState] = useState<EditModeState | null>(null)
  const [openViewFile, setOpenViewFile] = useState<OpenViewFile | null>(null)
  const [localError, setLocalError] = useState<unknown>()
  const [externalEvent, setExternalEvent] =
    useState<ExternalRequestEvent | null>(null)
  const [selectedCommand, setSelectedCommand] = useState("")
  const [keyboardSelectedCommand, setKeyboardSelectedCommand] = useState("")
  const {
    aiModeState,
    setAiModeState,
    isAiPending,
    isAiOffline,
    aiPermissionRequest,
    startAiMode,
    closeAiMode,
    stopAiMode,
    resetAiMode,
    respondToAiPermission,
    writeAiInput,
  } = useAiController({
    aiAdaptor,
    root,
    setLocalError,
    setMode,
  })
  const height = fixedHeight ?? rows ?? defaultHeight
  const width = fixedWidth ?? columns ?? defaultWidth
  const commandInput =
    mode === TerminalMode.View || mode === TerminalMode.Edit
      ? viewModeState.command
      : queryModeState.command
  const sidebarCommand = resolveSidebarCommand(commandInput, selectedCommand)
  const highlightedSidebarCommand = keyboardSelectedCommand || sidebarCommand
  const expandedPathsForInput = useMemo(
    () => buildExpandedDirectoryPaths(sidebarCommand),
    [sidebarCommand],
  )
  const fileTreeEntries = useMemo(
    () => buildFileTreeEntries(root, expandedPathsForInput),
    [expandedPathsForInput, root],
  )
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
  const externalContent = externalEvent?.responseContent
  const responseContent = useMemo(
    () =>
      formatTerminalContent({
        response,
        error: localError ?? error,
        externalContent,
        isPending,
        frameIndex,
      }),
    [response, localError, error, externalContent, isPending, frameIndex],
  )
  const openFileContent =
    openViewFile && mode === TerminalMode.Edit && editModeState
      ? serializeEditModeContent(editModeState)
      : openViewFile?.content
  const content = openFileContent ?? responseContent
  const contentLines = useMemo(() => normalizeLines(content), [content])
  const filePaneLayout = openViewFile
    ? buildFilePaneLayout(responsePaneWidth, viewHeight, contentLines.length)
    : null
  const activeContentWidth =
    filePaneLayout?.contentWidth ?? responseContentWidth
  const activeContentHeight =
    filePaneLayout?.contentHeight ?? responseContentHeight
  const activeMaxLineWidth = useMemo(
    () =>
      contentLines.reduce(
        (currentMax, line) => Math.max(currentMax, line.length),
        0,
      ),
    [contentLines],
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
  const viewport = useMemo(
    () =>
      buildTerminalViewport(
        content,
        responseContentWidth,
        responseContentHeight,
        contentScrollX,
        contentScrollY,
      ),
    [
      content,
      responseContentWidth,
      responseContentHeight,
      contentScrollX,
      contentScrollY,
    ],
  )
  const searchMatches = useMemo(
    () =>
      mode === TerminalMode.Search
        ? findSearchMatches(content, searchModeState.query)
        : [],
    [mode, content, searchModeState.query],
  )
  const inputStates = {
    aiModeState,
    editModeState,
    queryModeState,
    searchModeState,
    viewModeState,
  }
  const inputValue = resolveInputValue(mode, inputStates)
  const commandInputCursorX = resolveInputCursorX(
    mode,
    inputValue.length,
    inputStates,
  )
  const inputBeforeCursor = inputValue.slice(0, commandInputCursorX)
  const inputAfterCursor = inputValue.slice(commandInputCursorX)
  const promptValue = `@${mode} >`
  const aiLayout = useMemo(() => buildAiLayout(width, height), [width, height])
  const aiMessageLineCount = useMemo(
    () =>
      mode === TerminalMode.Ai
        ? buildAiMessageLines(aiModeState.messages, aiLayout.contentWidth)
            .length + (isAiPending || isAiOffline ? 1 : 0)
        : 0,
    [
      mode,
      aiModeState.messages,
      aiLayout.contentWidth,
      isAiPending,
      isAiOffline,
    ],
  )
  const aiMaxScrollY = Math.max(0, aiMessageLineCount - aiLayout.contentHeight)
  const {
    activeEditSuggestionItems,
    createEditModeForOpenFile,
    preloadEditSuggestions,
    rebuildEditSuggestions,
  } = useEditSuggestions({
    mode,
    editModeState,
    openViewFile,
    setEditModeState,
  })
  const {
    moveSidebarSelection,
    moveToParentDirectory,
    moveQueryToParentDirectory,
  } = useFileNavigation({
    fileTreeEntries,
    highlightedEntryIndex,
    selectedCommand,
    queryModeState,
    viewModeState,
    setKeyboardSelectedCommand,
    setSelectedCommand,
    setQueryModeState,
    setViewModeState,
  })

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
    if (!isCursorBlinkActive || isPending || isAiPending) {
      return
    }

    const timeout = setTimeout(() => {
      setIsCursorBlinkActive(false)
    }, cursorBlinkIdleMs)

    return () => {
      clearTimeout(timeout)
    }
  }, [cursorActivityId, isAiPending, isCursorBlinkActive, isPending])

  useEffect(() => {
    if (!externalEventSocket) {
      return
    }

    const handleError = (nextError: unknown) => {
      setExternalEvent(null)
      setOpenViewFile(null)
      setEditModeState(null)
      setLocalError(nextError)
      setMode((currentMode) =>
        currentMode === TerminalMode.Ai ? currentMode : TerminalMode.Query,
      )
    }

    let listener: ExternalEventListener | undefined

    try {
      listener = startExternalEventListener(
        externalEventSocket,
        (event) => {
          const command = buildExternalEventCommand(event)

          setExternalEvent(event)
          setLocalError(undefined)
          setOpenViewFile(null)
          setEditModeState(null)
          setSelectedCommand(command)
          setKeyboardSelectedCommand("")
          setQueryModeState((currentState) => ({
            ...currentState,
            command: "",
            commandCursorX: 0,
            scrollX: 0,
            scrollY: 0,
          }))
          setViewModeState({
            command: "",
            commandCursorX: 0,
            scrollX: 0,
            scrollY: 0,
          })
          setSearchModeState((currentState) => ({
            ...currentState,
            scrollX: 0,
            scrollY: 0,
            input: "",
            inputCursorX: 0,
            query: "",
            focusedMatchIndex: 0,
          }))
          setMode((currentMode) =>
            currentMode === TerminalMode.Ai ? currentMode : TerminalMode.Query,
          )
        },
        handleError,
      )
    } catch (error) {
      handleError(error)
    }

    return () => {
      void listener?.close()
    }
  }, [externalEventSocket])

  const exitApp = () => {
    stopAiMode()
    onExit()
  }

  const resetTerminalState = () => {
    resetAiMode()
    setFrameIndex(0)
    setIsCursorBlinkActive(true)
    setCursorActivityId((currentValue) => currentValue + 1)
    setMode(TerminalMode.Query)
    setQueryModeState(createQueryModeState())
    setSearchModeState(createSearchModeState())
    setViewModeState(createViewModeState())
    setEditModeState(null)
    setOpenViewFile(null)
    setLocalError(undefined)
    setExternalEvent(null)
    setSelectedCommand("")
    setKeyboardSelectedCommand("")
  }

  const reloadApp = () => {
    resetTerminalState()
    onReload?.()
  }

  const handleAppCommand = (command: string | undefined): boolean => {
    if (command === undefined) {
      return false
    }

    const appCommand = resolveAppInputCommand(command)

    if (appCommand.type !== "app") {
      return false
    }

    if (appCommand.command === "exit") {
      exitApp()
      return true
    }

    if (appCommand.command === "reload") {
      reloadApp()
      return true
    }

    return false
  }

  const runQueryCommand = (command: string) => {
    setOpenViewFile(null)
    setEditModeState(null)
    setViewModeState({
      command: "",
      commandCursorX: 0,
      scrollX: 0,
      scrollY: 0,
    })
    setLocalError(undefined)
    setExternalEvent(null)
    onCommand?.(command)
  }

  const quickSwitchMode = (): boolean => {
    const nextMode = resolveQuickSwitchMode(mode)

    if (!nextMode) {
      return false
    }

    setKeyboardSelectedCommand("")

    if (nextMode === TerminalMode.Query) {
      closeAiMode()
      return true
    }

    if (nextMode === TerminalMode.View) {
      setMode(TerminalMode.View)
      setViewModeState({
        command: "",
        commandCursorX: 0,
        scrollX: openViewFile ? viewModeState.scrollX : 0,
        scrollY: openViewFile ? viewModeState.scrollY : 0,
      })
      return true
    }

    if (nextMode === TerminalMode.Search) {
      const scrollX = openViewFile
        ? viewModeState.scrollX
        : queryModeState.scrollX
      const scrollY = openViewFile
        ? viewModeState.scrollY
        : queryModeState.scrollY

      setMode(TerminalMode.Search)
      setSearchModeState({
        scrollX,
        scrollY,
        input: "",
        inputCursorX: 0,
        query: "",
        focusedMatchIndex: 0,
      })
      return true
    }

    if (nextMode === TerminalMode.Ai) {
      startAiMode()
      setSearchModeState({
        ...searchModeState,
        input: "",
        inputCursorX: 0,
        query: "",
        focusedMatchIndex: 0,
      })
      return true
    }

    return false
  }

  useInput((input, key) => {
    setCursorActivityId((currentValue) => currentValue + 1)
    setIsCursorBlinkActive(true)

    if (isQuickSwitchKey(key) && quickSwitchMode()) {
      return
    }

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

      if (result.shouldReloadApp) {
        reloadApp()
        return
      }

      if (submittedInput) {
        writeAiInput(submittedInput)
      }

      return
    }

    if (
      openViewFile &&
      (mode === TerminalMode.View || mode === TerminalMode.Edit)
    ) {
      if (mode === TerminalMode.Edit && editModeState) {
        const result = handleEditModeInput(
          input,
          key,
          editModeState,
          activeEditSuggestionItems,
        )

        if (result.shouldSave) {
          const nextContent = serializeEditModeContent(result.state)

          try {
            writeFileSync(openViewFile.path, nextContent)
            setOpenViewFile({
              ...openViewFile,
              content: nextContent,
            })
            // Rebuild suggestions because saving can change ref lines and their
            // referenced .ntd keys.
            rebuildEditSuggestions(openViewFile.path, nextContent)
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
      const isSelectedCommandInput =
        viewModeState.command.trim() === "" &&
        keyboardSelectedCommand === "" &&
        selectedCommand !== ""
      const highlightedEntry =
        isViewCommandInput || isKeyboardSelectionInput || isSelectedCommandInput
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
          preloadEditSuggestions(nextOpenViewFile)
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

      const nextCommand =
        result.selectedCommand === undefined
          ? undefined
          : resolveAppInputCommand(result.selectedCommand)
      const nextMode = nextCommand?.type === "mode" ? nextCommand.mode : null

      if (handleAppCommand(result.selectedCommand)) {
        return
      }

      if (nextMode === TerminalMode.Edit) {
        if (mode === TerminalMode.View) {
          setMode(TerminalMode.Edit)
          setEditModeState(createEditModeForOpenFile(openViewFile))
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
      const nextCommand =
        result.submittedQuery === undefined
          ? undefined
          : resolveAppInputCommand(result.submittedQuery)
      const nextMode = nextCommand?.type === "mode" ? nextCommand.mode : null

      if (handleAppCommand(result.submittedQuery)) {
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
            ...createEditModeForOpenFile(openViewFile),
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
      const isSelectedCommandInput =
        viewModeState.command.trim() === "" &&
        keyboardSelectedCommand === "" &&
        selectedCommand !== ""
      const highlightedEntry =
        isViewCommandInput || isKeyboardSelectionInput || isSelectedCommandInput
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
          preloadEditSuggestions(nextOpenViewFile)
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

      const nextCommand =
        result.selectedCommand === undefined
          ? undefined
          : resolveAppInputCommand(result.selectedCommand)
      const nextMode = nextCommand?.type === "mode" ? nextCommand.mode : null

      if (handleAppCommand(result.selectedCommand)) {
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
    const isSelectedCommandInput =
      queryModeState.command.trim() === "" &&
      keyboardSelectedCommand === "" &&
      selectedCommand !== ""
    const highlightedEntry =
      isQueryCommandInput || isKeyboardSelectionInput || isSelectedCommandInput
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
        runQueryCommand(highlightedEntry.commandValue)
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

    const nextCommand =
      result.command === undefined
        ? undefined
        : resolveAppInputCommand(result.command)
    const nextMode = nextCommand?.type === "mode" ? nextCommand.mode : null

    if (handleAppCommand(result.command)) {
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

    if (nextCommand?.type === "request") {
      setSelectedCommand(nextCommand.path)
      runQueryCommand(nextCommand.path)
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
        <Text>{`◷ Time Spend ${externalEvent?.time ?? requestDurationMs ?? 0} ms,`}</Text>
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
                  suggestions: editModeState?.suggestions,
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
        <BlinkingCursor
          active={isCursorBlinkActive}
          activityId={cursorActivityId}
          bold
          backgroundColor={commandBackgroundColor}
        />
        <Text backgroundColor={commandBackgroundColor}>{inputAfterCursor}</Text>
      </Box>
      {mode === TerminalMode.Ai && (
        <Ai
          width={width}
          height={height}
          input={aiModeState.input}
          inputCursorX={aiModeState.inputCursorX}
          cursorBlinkActive={isCursorBlinkActive}
          cursorActivityId={cursorActivityId}
          messages={aiModeState.messages}
          scrollY={aiModeState.scrollY}
          isPending={isAiPending}
          isOffline={isAiOffline}
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
