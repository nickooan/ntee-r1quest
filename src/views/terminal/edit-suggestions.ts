import { useEffect, useState, type Dispatch, type SetStateAction } from "react"
import {
  createEditModeState,
  getEditRefSuggestionQuery,
  refreshEditModeSuggestions,
  type EditModeState,
  TerminalMode,
} from "../key-helpers/index.ts"
import {
  buildEditorSuggestionItems,
  buildRefSuggestionItems,
  type EditorSuggestionItem,
} from "../../runtime/editor-suggestions/index.ts"
import type { OpenViewFile } from "../../runtime/file-manager/index.ts"

type UseEditSuggestionsParams = {
  mode: TerminalMode
  editModeState: EditModeState | null
  openViewFile: OpenViewFile | null
  setEditModeState: Dispatch<SetStateAction<EditModeState | null>>
}

export const useEditSuggestions = ({
  mode,
  editModeState,
  openViewFile,
  setEditModeState,
}: UseEditSuggestionsParams) => {
  const [editSuggestionItems, setEditSuggestionItems] = useState<
    EditorSuggestionItem[]
  >([])
  const [editRefSuggestionItems, setEditRefSuggestionItems] = useState<
    EditorSuggestionItem[]
  >([])
  const editRefSuggestionQuery =
    mode === TerminalMode.Edit && editModeState
      ? getEditRefSuggestionQuery(editModeState)
      : null
  const editRefSuggestionFragment = editRefSuggestionQuery?.fragment ?? null
  const activeEditSuggestionItems = [
    ...editSuggestionItems,
    ...editRefSuggestionItems,
  ]

  useEffect(() => {
    if (
      mode !== TerminalMode.Edit ||
      !openViewFile ||
      !editModeState ||
      editRefSuggestionFragment === null ||
      editRefSuggestionFragment === "" ||
      editRefSuggestionFragment === "." ||
      editRefSuggestionFragment === ".." ||
      editRefSuggestionFragment === "/" ||
      editRefSuggestionFragment.endsWith(".ntd")
    ) {
      setEditRefSuggestionItems([])
      return
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => {
      controller.abort()
    }, 1000)

    void buildRefSuggestionItems(
      openViewFile.path,
      editRefSuggestionFragment,
      controller.signal,
    )
      .then((suggestions) => {
        if (controller.signal.aborted) {
          return
        }

        setEditRefSuggestionItems(suggestions)
        setEditModeState((currentState) => {
          return currentState
            ? refreshEditModeSuggestions(currentState, [
                ...editSuggestionItems,
                ...suggestions,
              ])
            : currentState
        })
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setEditRefSuggestionItems([])
        }
      })
      .finally(() => {
        clearTimeout(timeout)
      })

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [editRefSuggestionFragment, editSuggestionItems, mode, openViewFile?.path])

  const createEditModeForOpenFile = (file: OpenViewFile): EditModeState => {
    setEditSuggestionItems(buildEditorSuggestionItems(file.path, file.content))
    setEditRefSuggestionItems([])
    return createEditModeState(file.content)
  }

  const preloadEditSuggestions = (file: OpenViewFile) => {
    setEditSuggestionItems(buildEditorSuggestionItems(file.path, file.content))
    setEditRefSuggestionItems([])
  }

  const rebuildEditSuggestions = (filePath: string, content: string) => {
    setEditSuggestionItems(buildEditorSuggestionItems(filePath, content))
    setEditRefSuggestionItems([])
  }

  return {
    activeEditSuggestionItems,
    createEditModeForOpenFile,
    preloadEditSuggestions,
    rebuildEditSuggestions,
  }
}
