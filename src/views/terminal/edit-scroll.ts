import type { EditModeState, ViewModeState } from "../key-helpers/index.ts"
import { buildFilePaneLayout } from "./file-content.tsx"

export const resolveEditScroll = (
  state: EditModeState,
  width: number,
  height: number,
): Pick<ViewModeState, "scrollX" | "scrollY"> => {
  const layout = buildFilePaneLayout(width, height, state.lines.length)
  let scrollX = state.cursorX < 0 ? 0 : state.cursorX
  let scrollY = state.cursorY < 0 ? 0 : state.cursorY

  if (state.cursorX >= layout.contentWidth) {
    scrollX = state.cursorX - layout.contentWidth + 1
  } else {
    scrollX = 0
  }

  if (state.cursorY >= layout.contentHeight) {
    scrollY = state.cursorY - layout.contentHeight + 1
  } else {
    scrollY = 0
  }

  return { scrollX, scrollY }
}
