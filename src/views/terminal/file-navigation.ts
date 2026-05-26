import type { Dispatch, SetStateAction } from "react"
import {
  resolveNextFileTreeSelectionIndex,
  resolveParentDirectoryCommand,
  type FileTreeEntry,
} from "../../runtime/file-manager/index.ts"
import type { QueryModeState, ViewModeState } from "../key-helpers/index.ts"

type UseFileNavigationParams = {
  fileTreeEntries: FileTreeEntry[]
  highlightedEntryIndex: number
  selectedCommand: string
  queryModeState: QueryModeState
  viewModeState: ViewModeState
  setKeyboardSelectedCommand: Dispatch<SetStateAction<string>>
  setSelectedCommand: Dispatch<SetStateAction<string>>
  setQueryModeState: Dispatch<SetStateAction<QueryModeState>>
  setViewModeState: Dispatch<SetStateAction<ViewModeState>>
}

export const useFileNavigation = ({
  fileTreeEntries,
  highlightedEntryIndex,
  selectedCommand,
  queryModeState,
  viewModeState,
  setKeyboardSelectedCommand,
  setSelectedCommand,
  setQueryModeState,
  setViewModeState,
}: UseFileNavigationParams) => {
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

  return {
    moveSidebarSelection,
    moveToParentDirectory,
    moveQueryToParentDirectory,
  }
}
