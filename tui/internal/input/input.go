// Package input ports the pure cursor/text-edit helpers from
// src/views/key-helpers/generic-key-actions.ts. Rune-based so multibyte input
// behaves correctly (the TS version works on UTF-16 units).
package input

// Clamp constrains v to [lo, hi].
func Clamp(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// ClampCursor keeps a cursor within [0, len(runes)].
func ClampCursor(s string, cursor int) int {
	return Clamp(cursor, 0, len([]rune(s)))
}

// MoveCursor moves the cursor by direction (-1 or 1), clamped.
func MoveCursor(s string, cursor, direction int) int {
	return ClampCursor(s, cursor+direction)
}

// MoveCursorVertical moves the cursor up (direction -1) or down (+1) one line in
// a multi-line string, preserving the visual column. When the target line is
// shorter than the current column, the cursor lands at the target line's end.
func MoveCursorVertical(s string, cursor, direction int) int {
	runes := []rune(s)
	cursor = Clamp(cursor, 0, len(runes))

	// Start of the current line and the column within it.
	lineStart := 0
	for i := cursor - 1; i >= 0; i-- {
		if runes[i] == '\n' {
			lineStart = i + 1
			break
		}
	}
	column := cursor - lineStart

	if direction < 0 {
		if lineStart == 0 {
			return cursor // already on the first line
		}
		prevEnd := lineStart - 1 // the '\n' terminating the previous line
		prevStart := 0
		for i := prevEnd - 1; i >= 0; i-- {
			if runes[i] == '\n' {
				prevStart = i + 1
				break
			}
		}
		return prevStart + min(column, prevEnd-prevStart)
	}

	// direction >= 0: locate the end of the current line.
	lineEnd := len(runes)
	for i := cursor; i < len(runes); i++ {
		if runes[i] == '\n' {
			lineEnd = i
			break
		}
	}
	if lineEnd == len(runes) {
		return cursor // already on the last line
	}
	nextStart := lineEnd + 1
	nextEnd := len(runes)
	for i := nextStart; i < len(runes); i++ {
		if runes[i] == '\n' {
			nextEnd = i
			break
		}
	}
	return nextStart + min(column, nextEnd-nextStart)
}

// InsertAtCursor inserts next at the cursor, returning the new string and cursor.
func InsertAtCursor(current string, cursor int, next string) (string, int) {
	runes := []rune(current)
	at := Clamp(cursor, 0, len(runes))
	out := string(runes[:at]) + next + string(runes[at:])
	return out, at + len([]rune(next))
}

// RemoveBeforeCursor deletes the rune before the cursor (backspace). The bool is
// false when there is nothing to delete (cursor at start).
func RemoveBeforeCursor(s string, cursor int) (string, int, bool) {
	runes := []rune(s)
	at := Clamp(cursor, 0, len(runes))
	if at == 0 {
		return s, at, false
	}
	out := string(runes[:at-1]) + string(runes[at:])
	return out, at - 1, true
}
