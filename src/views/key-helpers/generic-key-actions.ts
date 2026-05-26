import type { Key } from "ink"

export const clampValue = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), max)
}

export const clampInputCursor = (
  input: string,
  inputCursorX: number,
): number => {
  return clampValue(inputCursorX, 0, input.length)
}

export const isQuickSwitchKey = (key: Key): boolean => {
  return key.shift && key.tab
}

export const isTextInputIgnoredKey = (key: Key): boolean => {
  return key.ctrl || key.meta || key.tab
}

export const moveInputCursor = (
  input: string,
  inputCursorX: number,
  direction: -1 | 1,
): number => {
  return clampInputCursor(input, inputCursorX + direction)
}

export const insertInputAtCursor = (
  currentInput: string,
  inputCursorX: number,
  nextInput: string,
): { input: string; inputCursorX: number } => {
  const safeInputCursorX = clampInputCursor(currentInput, inputCursorX)

  return {
    input: `${currentInput.slice(0, safeInputCursorX)}${nextInput}${currentInput.slice(
      safeInputCursorX,
    )}`,
    inputCursorX: safeInputCursorX + nextInput.length,
  }
}

export const removeInputBeforeCursor = (
  input: string,
  inputCursorX: number,
): { input: string; inputCursorX: number } | null => {
  const safeInputCursorX = clampInputCursor(input, inputCursorX)

  if (safeInputCursorX === 0) {
    return null
  }

  return {
    input: `${input.slice(0, safeInputCursorX - 1)}${input.slice(
      safeInputCursorX,
    )}`,
    inputCursorX: safeInputCursorX - 1,
  }
}
