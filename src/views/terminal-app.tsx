import { writeFileSync } from "node:fs"
import type { AxiosResponse } from "axios"
import { useEffect, useMemo, useState } from "react"
import { Box, render, useInput, useWindowSize } from "ink"
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
  type SearchModeState,
  type ViewModeState,
} from "./key-helpers/index.ts"
import {
  resolveQuickSwitchMode,
  resolveAppInputCommand,
  TerminalMode,
} from "../runtime/app-command/index.ts"
import {
  matchCustomCommands,
  type CustomCommand,
} from "../runtime/custom-command/index.ts"
import { Ai } from "./ai.tsx"
import {
  getAdaptorDisplayName,
  type AcpAdaptorName,
} from "../runtime/acp/index.ts"
import {
  buildExternalEventCommand,
  startExternalEventListener,
  type ExternalEventListener,
  type ExternalRequestEvent,
} from "../runtime/external-event/index.ts"
import {
  readViewFile,
  type OpenViewFile,
} from "../runtime/file-manager/index.ts"
import {
  defaultHeight,
  defaultWidth,
  editModeRequiresViewFileMessage,
  paneGap,
} from "./terminal/constants.ts"
import {
  clearCache,
  listApiEndpoints,
  listTraceCalls,
  recordInput,
  type ApiCallRecord,
} from "../runtime/cache/index.ts"
import { copyToClipboard } from "../runtime/clipboard.ts"
import { formatAcpPermissionMessage } from "./terminal/ai-session.ts"
import { CommandLine } from "./terminal/command-line.tsx"
import { CommandSuggestionOverlay } from "./terminal/command-suggestions.tsx"
import { formatHistoryEntry } from "./terminal/history-content.ts"
import {
  buildEndpointSuggestions,
  buildInputSuggestions,
} from "./terminal/input-suggestions.ts"
import { useAiController } from "./terminal/ai-controller.ts"
import { resolveEditScroll } from "./terminal/edit-scroll.ts"
import { useEditSuggestions } from "./terminal/edit-suggestions.ts"
import { buildFilePaneLayout } from "./terminal/file-content.tsx"
import { useFileNavigation } from "./terminal/file-navigation.ts"
import { ResponsePane } from "./terminal/response-pane.tsx"
import { CacheNoticeOverlay } from "./terminal/cache-notice-overlay.tsx"
import {
  CopiedNoticeOverlay,
  CopyFailedNoticeOverlay,
} from "./terminal/copied-notice-overlay.tsx"
import { SearchNotFoundOverlay } from "./terminal/search-not-found-overlay.tsx"
import { Sidebar } from "./terminal/sidebar.tsx"
import { TerminalHeader } from "./terminal/terminal-header.tsx"
import { useTerminalView } from "./terminal/use-terminal-view.ts"

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
  customCommands?: CustomCommand[]
  onCommand?: (command: string) => void | Promise<void>
  onReload?: () => void
  onExit?: () => void
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
  customCommands = [],
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
  const [searchPreviousMode, setSearchPreviousMode] = useState<TerminalMode>(
    TerminalMode.Query,
  )
  const [searchNotFound, setSearchNotFound] = useState(false)
  const [viewModeState, setViewModeState] =
    useState<ViewModeState>(createViewModeState)
  const [editModeState, setEditModeState] = useState<EditModeState | null>(null)
  const [openViewFile, setOpenViewFile] = useState<OpenViewFile | null>(null)
  const [localError, setLocalError] = useState<unknown>()
  const [externalEvent, setExternalEvent] =
    useState<ExternalRequestEvent | null>(null)
  const [selectedCommand, setSelectedCommand] = useState("")
  const [keyboardSelectedCommand, setKeyboardSelectedCommand] = useState("")
  const [inputSuggestionIndex, setInputSuggestionIndex] = useState(0)
  const [historyModeState, setHistoryModeState] =
    useState<QueryModeState>(createQueryModeState)
  const [historySelectedEndpoint, setHistorySelectedEndpoint] = useState("")
  // Trace id from `@h/@history <traceId>`. When set, the Endpoints list shows
  // only that trace's calls, in call order; null shows all cached endpoints.
  const [historyTraceFilter, setHistoryTraceFilter] = useState<string | null>(
    null,
  )
  const [cacheErasedNotice, setCacheErasedNotice] = useState(false)
  const [copiedNotice, setCopiedNotice] = useState(false)
  // Failure message for `@report`/`@copy`; null when no failure notice is shown.
  const [copyFailedNotice, setCopyFailedNotice] = useState<string | null>(null)
  const {
    aiModeState,
    setAiModeState,
    isAiThinking,
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
  // Label the AI overlay with the chosen agent (e.g. "Claude").
  const aiAgentName = getAdaptorDisplayName(aiAdaptor)

  // History mode: cached endpoints (loaded on entry), the endpoint matching the
  // current filter/selection, and the formatted Results content. Computed
  // before the view hook because the Results content is fed into it. None of it
  // depends on the file tree.
  // History context covers History mode and a search launched from it, so the
  // endpoints sidebar and Results content stay visible (and searchable) while
  // searching history.
  const isHistoryContext =
    mode === TerminalMode.History ||
    (mode === TerminalMode.Search &&
      searchPreviousMode === TerminalMode.History)
  // Endpoint entries with a unique key per row. Without a trace filter the key
  // is the endpoint label (already unique). Under a trace filter the same
  // endpoint can appear more than once, so the call's 1-based order is prefixed
  // to keep keys unique and show the sequence.
  const historyEntries = useMemo(() => {
    if (!isHistoryContext) {
      return [] as Array<{ key: string; record: ApiCallRecord }>
    }

    if (historyTraceFilter) {
      return listTraceCalls(historyTraceFilter).map((record, index) => ({
        key: `${index + 1}. ${record.endpoint}`,
        record,
      }))
    }

    return listApiEndpoints().map((record) => ({
      key: record.endpoint,
      record,
    }))
  }, [isHistoryContext, historyTraceFilter])
  const historyEndpointLabels = useMemo(
    () => historyEntries.map((entry) => entry.key),
    [historyEntries],
  )
  const historySuggestions = useMemo(
    () =>
      mode === TerminalMode.History
        ? buildEndpointSuggestions(
            historyEndpointLabels,
            historyModeState.command,
          )
        : [],
    [mode, historyEndpointLabels, historyModeState.command],
  )
  const historyOverlayIndex =
    historySuggestions.length === 0
      ? 0
      : Math.min(inputSuggestionIndex, historySuggestions.length - 1)
  const activeHistoryEndpoint =
    historySuggestions.length > 0
      ? (historySuggestions[historyOverlayIndex]?.label ?? "")
      : historySelectedEndpoint
  const activeHistoryRecord: ApiCallRecord | undefined = isHistoryContext
    ? (historyEntries.find((entry) => entry.key === activeHistoryEndpoint)
        ?.record ?? historyEntries[0]?.record)
    : undefined
  const approxHistorySidebarWidth = Math.min(
    Math.max(12, Math.floor(width / 4)),
    Math.max(1, width - paneGap - 3),
  )
  const historyResultWidth = Math.max(
    20,
    width - approxHistorySidebarWidth - paneGap - 2,
  )
  const historyContent = isHistoryContext
    ? activeHistoryRecord
      ? formatHistoryEntry(activeHistoryRecord, historyResultWidth)
      : "No cached requests yet.\n\nRun requests in @query mode to fill the history."
    : undefined

  const {
    fileTreeEntries,
    sidebarWidth,
    responsePaneWidth,
    viewHeight,
    responseContentHeight,
    highlightedEntryIndex,
    content,
    resultContent,
    contentLines,
    activeContentWidth,
    activeContentHeight,
    activeMaxScrollX,
    activeMaxScrollY,
    viewport,
    searchMatches,
    fileContent,
    inputBeforeCursor,
    inputAfterCursor,
    promptValue,
    responsePaneTitle,
    aiMaxScrollY,
  } = useTerminalView({
    response,
    error,
    isPending,
    root,
    width,
    height,
    mode,
    queryModeState,
    searchModeState,
    viewModeState,
    editModeState,
    openViewFile,
    localError,
    externalEvent,
    selectedCommand,
    keyboardSelectedCommand,
    frameIndex,
    aiModeState,
    isAiThinking,
    isAiOffline,
    aiAgentName,
    historyModeState,
    historyContent,
  })
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

  // Combined query/view suggestions (current-dir files/dirs + cached inputs),
  // shown in the overlay above the command line. The overlay is the selection
  // source; the sidebar just highlights whichever file/dir is selected.
  const inputSuggestions = useMemo(() => {
    if (mode === TerminalMode.History) {
      return historySuggestions
    }

    if (mode !== TerminalMode.Query && mode !== TerminalMode.View) {
      return []
    }

    const command =
      mode === TerminalMode.View
        ? viewModeState.command
        : queryModeState.command

    return buildInputSuggestions(fileTreeEntries, command)
  }, [
    mode,
    fileTreeEntries,
    queryModeState.command,
    viewModeState.command,
    historySuggestions,
  ])

  const clampedSuggestionIndex =
    inputSuggestions.length === 0
      ? 0
      : Math.min(inputSuggestionIndex, inputSuggestions.length - 1)
  const selectedInputSuggestion = inputSuggestions[clampedSuggestionIndex]
  // The file/directory entry of the selected suggestion, so accepting it opens
  // exactly what the overlay highlights (cache suggestions have no entry).
  const selectedSuggestionEntry =
    selectedInputSuggestion && selectedInputSuggestion.source !== "cache"
      ? selectedInputSuggestion.entry
      : undefined

  // Typing or switching modes resets the highlighted suggestion to the top.
  useEffect(() => {
    setInputSuggestionIndex(0)
  }, [
    mode,
    queryModeState.command,
    viewModeState.command,
    historyModeState.command,
  ])

  const moveInputSuggestion = (direction: 1 | -1) => {
    if (inputSuggestions.length === 0) {
      return
    }

    const nextIndex =
      (clampedSuggestionIndex + direction + inputSuggestions.length) %
      inputSuggestions.length

    setInputSuggestionIndex(nextIndex)

    // Keep the sidebar highlight in sync with the selected file/dir; cache
    // selections clear the keyboard selection so no file is forced.
    const nextSuggestion = inputSuggestions[nextIndex]
    setKeyboardSelectedCommand(
      nextSuggestion && nextSuggestion.source !== "cache"
        ? (nextSuggestion.entry?.commandValue ?? "")
        : "",
    )
  }

  useEffect(() => {
    if (!isPending && !isAiThinking) {
      return
    }

    const interval = setInterval(() => {
      setFrameIndex((currentFrameIndex) => currentFrameIndex + 1)
    }, 250)

    return () => {
      clearInterval(interval)
    }
  }, [isAiThinking, isPending])

  useEffect(() => {
    if (!isCursorBlinkActive || isPending || isAiThinking) {
      return
    }

    const timeout = setTimeout(() => {
      setIsCursorBlinkActive(false)
    }, cursorBlinkIdleMs)

    return () => {
      clearTimeout(timeout)
    }
  }, [cursorActivityId, isAiThinking, isCursorBlinkActive, isPending])

  useEffect(() => {
    if (!externalEventSocket) {
      return
    }

    const handleError = (nextError: unknown) => {
      setExternalEvent(null)
      setOpenViewFile(null)
      setEditModeState(null)
      setLocalError(nextError)
      setSearchNotFound(false)
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
          setSearchNotFound(false)
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
    setSearchPreviousMode(TerminalMode.Query)
    setSearchNotFound(false)
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

    if (appCommand.command === "clean-cache") {
      void clearCache()
      setHistoryTraceFilter(null)
      setHistorySelectedEndpoint("")
      setCacheErasedNotice(true)
      return true
    }

    if (appCommand.command === "copy-report") {
      // Copy exactly what the Result pane shows (sans the pending animation).
      // Confirm only once the clipboard utility has accepted the text; surface a
      // failure notice when there is nothing to copy or no clipboard tool.
      if (resultContent.trim() === "") {
        setCopyFailedNotice("Nothing to copy from the Result pane")
        return true
      }

      void copyToClipboard(resultContent).then((copied) => {
        if (copied) {
          setCopiedNotice(true)
        } else {
          setCopyFailedNotice("No clipboard tool available")
        }
      })

      return true
    }

    return false
  }

  const runQueryCommand = (command: string) => {
    recordInput(command)
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

  // Enter search mode, optionally with an initial query (e.g. from `@s uuid`).
  // Remembers the mode we came from so Esc can return to it, and raises the
  // "nothing found" overlay when a non-empty query has no matches.
  const openSearchMode = (
    query: string,
    fromMode: TerminalMode,
    scrollX: number,
    scrollY: number,
  ) => {
    const limits = {
      maxScrollX: activeMaxScrollX,
      maxScrollY: activeMaxScrollY,
      viewWidth: activeContentWidth,
      viewHeight: activeContentHeight,
    }
    const matches = query ? findSearchMatches(content, query) : []
    const baseState: SearchModeState = {
      scrollX,
      scrollY,
      input: "",
      inputCursorX: 0,
      query,
      focusedMatchIndex: 0,
    }

    setSearchPreviousMode(fromMode)
    setMode(TerminalMode.Search)
    setSearchModeState(
      query ? focusSearchMatch(baseState, limits, matches, 0) : baseState,
    )
    setKeyboardSelectedCommand("")
    setSearchNotFound(query !== "" && matches.length === 0)
  }

  const exitSearchToPreviousMode = () => {
    const targetMode = searchPreviousMode
    const { scrollX, scrollY } = searchModeState

    setSearchNotFound(false)
    setSearchModeState({
      ...searchModeState,
      input: "",
      inputCursorX: 0,
      query: "",
      focusedMatchIndex: 0,
    })
    setKeyboardSelectedCommand("")
    setMode(targetMode)

    if (targetMode === TerminalMode.Query) {
      setQueryModeState({ ...queryModeState, scrollX, scrollY })
    } else if (
      targetMode === TerminalMode.View ||
      targetMode === TerminalMode.Edit
    ) {
      setViewModeState({ ...viewModeState, command: "", scrollX, scrollY })
    } else if (targetMode === TerminalMode.History) {
      setHistoryModeState({
        ...historyModeState,
        command: "",
        commandCursorX: 0,
        scrollX,
        scrollY,
      })
    }
  }

  useInput((input, key) => {
    setCursorActivityId((currentValue) => currentValue + 1)
    setIsCursorBlinkActive(true)

    // The cache-erased and copy notices are modal: Enter/Esc dismisses them
    // (and clears the submitted "@cc"/"@report" text); nothing else is processed
    // while one is shown.
    if (cacheErasedNotice || copiedNotice || copyFailedNotice) {
      if (key.return || key.escape) {
        setCacheErasedNotice(false)
        setCopiedNotice(false)
        setCopyFailedNotice(null)

        if (mode === TerminalMode.View) {
          setViewModeState((state) => ({
            ...state,
            command: "",
            commandCursorX: 0,
          }))
        } else if (mode === TerminalMode.History) {
          setHistoryModeState((state) => ({
            ...state,
            command: "",
            commandCursorX: 0,
          }))
        } else {
          setQueryModeState((state) => ({
            ...state,
            command: "",
            commandCursorX: 0,
          }))
        }
      }
      return
    }

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

      const result = handleAiModeInput(input, key, aiModeState, {
        maxScrollY: aiMaxScrollY,
        customCommands,
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

      if (result.submittedPrompt) {
        writeAiInput(result.submittedPrompt)
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
        selectedSuggestionEntry ??
        (isViewCommandInput ||
        isKeyboardSelectionInput ||
        isSelectedCommandInput
          ? fileTreeEntries[highlightedEntryIndex]
          : undefined)

      if (!isModeCommandInput && inputSuggestions.length > 0) {
        if (!key.shift && (key.upArrow || key.downArrow)) {
          moveInputSuggestion(key.downArrow ? 1 : -1)
          return
        }

        if (key.return && selectedInputSuggestion?.source === "cache") {
          setViewModeState({
            ...viewModeState,
            command: selectedInputSuggestion.insertText,
            commandCursorX: selectedInputSuggestion.insertText.length,
          })
          setInputSuggestionIndex(0)
          return
        }
      }

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
          recordInput(highlightedEntry.commandValue)
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
        setViewModeState({
          ...result.state,
          command: "",
        })
        openSearchMode(
          nextCommand?.type === "mode"
            ? (nextCommand.args?.join(" ") ?? "")
            : "",
          mode,
          result.state.scrollX,
          result.state.scrollY,
        )
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

      if (nextMode === TerminalMode.History) {
        setMode(TerminalMode.History)
        setHistoryTraceFilter(
          nextCommand?.type === "mode" ? (nextCommand.args?.[0] ?? null) : null,
        )
        setOpenViewFile(null)
        setEditModeState(null)
        setHistorySelectedEndpoint("")
        setHistoryModeState(createQueryModeState())
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
      if (searchNotFound) {
        if (key.return) {
          setSearchNotFound(false)
          return
        }

        if (key.escape) {
          exitSearchToPreviousMode()
          return
        }

        return
      }

      if (key.escape) {
        exitSearchToPreviousMode()
        return
      }

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

      if (nextMode === TerminalMode.Search) {
        openSearchMode(
          nextCommand?.type === "mode"
            ? (nextCommand.args?.join(" ") ?? "")
            : "",
          searchPreviousMode,
          result.state.scrollX,
          result.state.scrollY,
        )
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

      if (nextMode === TerminalMode.History) {
        setMode(TerminalMode.History)
        setHistoryTraceFilter(
          nextCommand?.type === "mode" ? (nextCommand.args?.[0] ?? null) : null,
        )
        setHistorySelectedEndpoint("")
        setHistoryModeState(createQueryModeState())
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

      if (result.submittedQuery !== undefined) {
        setSearchNotFound(result.state.query !== "" && nextMatches.length === 0)
      }

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
        selectedSuggestionEntry ??
        (isViewCommandInput ||
        isKeyboardSelectionInput ||
        isSelectedCommandInput
          ? fileTreeEntries[highlightedEntryIndex]
          : undefined)

      if (!isModeCommandInput && inputSuggestions.length > 0) {
        if (!key.shift && (key.upArrow || key.downArrow)) {
          moveInputSuggestion(key.downArrow ? 1 : -1)
          return
        }

        if (key.return && selectedInputSuggestion?.source === "cache") {
          setViewModeState({
            ...viewModeState,
            command: selectedInputSuggestion.insertText,
            commandCursorX: selectedInputSuggestion.insertText.length,
          })
          setInputSuggestionIndex(0)
          return
        }
      }

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
          recordInput(highlightedEntry.commandValue)
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
        setViewModeState({
          command: "",
          scrollX: 0,
          scrollY: 0,
        })
        openSearchMode(
          nextCommand?.type === "mode"
            ? (nextCommand.args?.join(" ") ?? "")
            : "",
          TerminalMode.View,
          queryModeState.scrollX,
          queryModeState.scrollY,
        )
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

      if (nextMode === TerminalMode.History) {
        setMode(TerminalMode.History)
        setHistoryTraceFilter(
          nextCommand?.type === "mode" ? (nextCommand.args?.[0] ?? null) : null,
        )
        setHistorySelectedEndpoint("")
        setHistoryModeState(createQueryModeState())
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

    if (mode === TerminalMode.History) {
      const isHistoryCommand = historyModeState.command.trim().startsWith("@")
      const isOverlayOpen = !isHistoryCommand && inputSuggestions.length > 0

      // While filtering, plain arrows navigate the overlay and Enter selects.
      if (isOverlayOpen && !key.shift && (key.upArrow || key.downArrow)) {
        moveInputSuggestion(key.downArrow ? 1 : -1)
        return
      }

      if (isOverlayOpen && key.return && selectedInputSuggestion) {
        setHistorySelectedEndpoint(selectedInputSuggestion.label)
        setHistoryModeState({
          ...historyModeState,
          command: "",
          commandCursorX: 0,
        })
        setInputSuggestionIndex(0)
        return
      }

      // Plain arrows (overlay closed) scroll the Results pane; shift+arrows move
      // the endpoint highlight in the left section.
      const result = handleQueryModeInput(input, key, historyModeState, {
        maxScrollX: activeMaxScrollX,
        maxScrollY: activeMaxScrollY,
        viewHeight: responseContentHeight,
      })

      if (
        result.fileTreeSelectionDirection &&
        historyEndpointLabels.length > 0
      ) {
        const currentIndex = Math.max(
          0,
          historyEndpointLabels.indexOf(activeHistoryEndpoint),
        )
        const nextIndex =
          (currentIndex +
            result.fileTreeSelectionDirection +
            historyEndpointLabels.length) %
          historyEndpointLabels.length
        setHistorySelectedEndpoint(historyEndpointLabels[nextIndex] ?? "")
        return
      }

      // Submitting an "@" command leaves history for the requested mode.
      if (key.return && result.command !== undefined) {
        if (handleAppCommand(result.command)) {
          return
        }

        const nextCommand = resolveAppInputCommand(result.command)
        const nextMode = nextCommand.type === "mode" ? nextCommand.mode : null

        if (nextMode && nextMode !== TerminalMode.History) {
          // Keep the selected endpoint so its Results stay shown and searchable.
          setHistorySelectedEndpoint(activeHistoryEndpoint)
          setHistoryModeState(createQueryModeState())
          setKeyboardSelectedCommand("")

          if (nextMode === TerminalMode.Search) {
            openSearchMode(
              nextCommand.type === "mode"
                ? (nextCommand.args?.join(" ") ?? "")
                : "",
              TerminalMode.History,
              historyModeState.scrollX,
              historyModeState.scrollY,
            )
          } else if (nextMode === TerminalMode.Ai) {
            startAiMode()
          } else if (nextMode === TerminalMode.View) {
            setMode(TerminalMode.View)
            setViewModeState(createViewModeState())
          } else if (nextMode === TerminalMode.Edit) {
            setLocalError(new Error(editModeRequiresViewFileMessage))
          } else {
            setMode(TerminalMode.Query)
            setQueryModeState(createQueryModeState())
          }

          return
        }

        // Re-entering History from History re-applies the trace filter:
        // `@h <traceId>` narrows to that trace, bare `@h`/`@history` resets to
        // all endpoints. Selection is reset so the new list starts at the top.
        if (nextMode === TerminalMode.History) {
          setHistoryTraceFilter(
            nextCommand.type === "mode"
              ? (nextCommand.args?.[0] ?? null)
              : null,
          )
          setHistorySelectedEndpoint("")
          setHistoryModeState(createQueryModeState())
          setKeyboardSelectedCommand("")
          return
        }

        // Plain Enter with no match keeps the current selection.
        setHistoryModeState({
          ...historyModeState,
          command: "",
          commandCursorX: 0,
        })
        return
      }

      setHistoryModeState(result.state)
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
      selectedSuggestionEntry ??
      (isQueryCommandInput || isKeyboardSelectionInput || isSelectedCommandInput
        ? fileTreeEntries[highlightedEntryIndex]
        : undefined)

    if (!isModeCommandInput && inputSuggestions.length > 0) {
      if (!key.shift && (key.upArrow || key.downArrow)) {
        moveInputSuggestion(key.downArrow ? 1 : -1)
        return
      }

      if (key.return && selectedInputSuggestion?.source === "cache") {
        setQueryModeState({
          ...queryModeState,
          command: selectedInputSuggestion.insertText,
          commandCursorX: selectedInputSuggestion.insertText.length,
        })
        setInputSuggestionIndex(0)
        return
      }
    }

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
      setQueryModeState(result.state)
      openSearchMode(
        nextCommand?.type === "mode" ? (nextCommand.args?.join(" ") ?? "") : "",
        TerminalMode.Query,
        result.state.scrollX,
        result.state.scrollY,
      )
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

    if (nextMode === TerminalMode.History) {
      setMode(TerminalMode.History)
      setHistoryTraceFilter(
        nextCommand?.type === "mode" ? (nextCommand.args?.[0] ?? null) : null,
      )
      setHistorySelectedEndpoint("")
      setHistoryModeState(createQueryModeState())
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
      <TerminalHeader
        width={width}
        version={version}
        timeSpentMs={
          isHistoryContext
            ? (activeHistoryRecord?.durationMs ?? 0)
            : (externalEvent?.time ?? requestDurationMs ?? 0)
        }
      />
      <Box width={width} height={viewHeight} columnGap={paneGap}>
        <Sidebar
          entries={fileTreeEntries}
          highlightedIndex={highlightedEntryIndex}
          width={sidebarWidth}
          height={viewHeight}
          title={
            isHistoryContext
              ? historyTraceFilter
                ? `Trace ${historyTraceFilter}`
                : "Endpoints"
              : "Collections"
          }
          endpoints={isHistoryContext ? historyEndpointLabels : undefined}
          selectedEndpointIndex={
            isHistoryContext && activeHistoryRecord
              ? Math.max(
                  0,
                  historyEndpointLabels.indexOf(activeHistoryEndpoint),
                )
              : 0
          }
        />
        <ResponsePane
          title={responsePaneTitle}
          contentLines={contentLines}
          viewport={viewport}
          searchMatches={searchMatches}
          focusedMatchIndex={searchModeState.focusedMatchIndex}
          width={responsePaneWidth}
          height={viewHeight}
          fileContent={fileContent}
        />
      </Box>
      <CommandLine
        width={width}
        prompt={promptValue}
        inputBeforeCursor={inputBeforeCursor}
        inputAfterCursor={inputAfterCursor}
        cursorBlinkActive={isCursorBlinkActive}
        cursorActivityId={cursorActivityId}
      />
      {(mode === TerminalMode.Query ||
        mode === TerminalMode.View ||
        mode === TerminalMode.History) && (
        <CommandSuggestionOverlay
          suggestions={inputSuggestions}
          selectedIndex={clampedSuggestionIndex}
          width={width}
          height={height}
          left={promptValue.length}
        />
      )}
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
          commandSuggestions={matchCustomCommands(
            customCommands,
            aiModeState.input,
          )}
          commandSuggestionIndex={aiModeState.commandSuggestionIndex}
          isPending={isAiThinking}
          isOffline={isAiOffline}
          pendingFrameIndex={frameIndex}
          agentName={aiAgentName}
          permissionMessage={
            aiPermissionRequest
              ? formatAcpPermissionMessage(aiPermissionRequest)
              : undefined
          }
        />
      )}
      {mode === TerminalMode.Search && searchNotFound && (
        <SearchNotFoundOverlay
          width={width}
          height={height}
          query={searchModeState.query}
        />
      )}
      {cacheErasedNotice && (
        <CacheNoticeOverlay width={width} height={height} />
      )}
      {copiedNotice && <CopiedNoticeOverlay width={width} height={height} />}
      {copyFailedNotice && (
        <CopyFailedNoticeOverlay
          width={width}
          height={height}
          message={copyFailedNotice}
        />
      )}
    </Box>
  )
}

export const displayTerminalApp = (props: TerminalAppProps) => {
  return render(<TerminalApp {...props} />)
}
