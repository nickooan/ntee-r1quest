import type { AxiosResponse } from "axios"
import { useMemo } from "react"
import {
  findSearchMatches,
  serializeEditModeContent,
  type AiModeState,
  type EditModeState,
  type QueryModeState,
  type SearchModeState,
  type ViewModeState,
} from "../key-helpers/index.ts"
import { TerminalMode } from "../../runtime/app-command/index.ts"
import { buildAiLayout, buildAiMessageLines } from "../ai.tsx"
import type { ExternalRequestEvent } from "../../runtime/external-event/index.ts"
import {
  buildExpandedDirectoryPaths,
  buildFileTreeEntries,
  resolveHighlightedEntry,
  resolveSidebarCommand,
  type OpenViewFile,
} from "../../runtime/file-manager/index.ts"
import {
  commandLineHeight,
  headerHeight,
  paneGap,
  requestStatsHeight,
} from "./constants.ts"
import { formatTerminalContent } from "./content.ts"
import { buildFilePaneLayout } from "./file-content.tsx"
import { buildTerminalViewport, normalizeLines } from "./viewport.ts"

type InputStateByMode = {
  aiModeState: AiModeState
  editModeState: EditModeState | null
  queryModeState: QueryModeState
  historyModeState: QueryModeState
  searchModeState: SearchModeState
  viewModeState: ViewModeState
}

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

  if (mode === TerminalMode.History) {
    return states.historyModeState.command
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
  } else if (mode === TerminalMode.History) {
    cursorX = states.historyModeState.commandCursorX ?? inputLength
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

export type TerminalViewParams = {
  response?: AxiosResponse
  error?: unknown
  isPending: boolean
  root?: string
  width: number
  height: number
  mode: TerminalMode
  queryModeState: QueryModeState
  searchModeState: SearchModeState
  viewModeState: ViewModeState
  editModeState: EditModeState | null
  openViewFile: OpenViewFile | null
  localError: unknown
  externalEvent: ExternalRequestEvent | null
  selectedCommand: string
  keyboardSelectedCommand: string
  frameIndex: number
  aiModeState: AiModeState
  isAiThinking: boolean
  isAiOffline: boolean
  aiAgentName: string
  historyModeState: QueryModeState
  historyContent?: string
}

// Derives all layout/content/viewport values the terminal renders and its input
// handlers read from. Pure derivation of the raw state passed in — no effects,
// no setters.
export const useTerminalView = ({
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
}: TerminalViewParams) => {
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
  const content = openFileContent ?? historyContent ?? responseContent
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
    mode === TerminalMode.History
      ? historyModeState.scrollX
      : mode === TerminalMode.Search
        ? searchModeState.scrollX
        : openViewFile
          ? viewModeState.scrollX
          : queryModeState.scrollX
  const contentScrollY =
    mode === TerminalMode.History
      ? historyModeState.scrollY
      : mode === TerminalMode.Search
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
  const fileContent = useMemo(
    () =>
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
        : undefined,
    [
      openViewFile,
      openFileContent,
      contentScrollX,
      contentScrollY,
      mode,
      editModeState,
    ],
  )
  const inputStates: InputStateByMode = {
    aiModeState,
    editModeState,
    queryModeState,
    historyModeState,
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
  const responsePaneTitle = resolveResponsePaneTitle(mode)
  const aiLayout = useMemo(() => buildAiLayout(width, height), [width, height])
  const aiMessageLineCount = useMemo(
    () =>
      mode === TerminalMode.Ai
        ? buildAiMessageLines(
            aiModeState.messages,
            aiLayout.contentWidth,
            aiAgentName,
          ).length + (isAiThinking || isAiOffline ? 1 : 0)
        : 0,
    [
      mode,
      aiModeState.messages,
      aiLayout.contentWidth,
      aiAgentName,
      isAiThinking,
      isAiOffline,
    ],
  )
  const aiMaxScrollY = Math.max(0, aiMessageLineCount - aiLayout.contentHeight)

  return {
    fileTreeEntries,
    sidebarWidth,
    responsePaneWidth,
    viewHeight,
    responseContentHeight,
    highlightedEntryIndex,
    content,
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
  }
}
