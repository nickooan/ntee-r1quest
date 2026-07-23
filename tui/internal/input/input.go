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

// WrapRow is one visual row of a soft-wrapped text: the half-open rune-index
// range [Start, End) it displays. A row never includes its terminating '\n'.
type WrapRow struct{ Start, End int }

// WrapRows lays text out as visual rows: logical lines split on '\n', each
// hard rune-wrapped at width (the same char-wrap convention as
// view.WrapSegments). Empty text yields one empty row, so a cursor always has
// a row to live on.
func WrapRows(text string, width int) []WrapRow {
	if width < 1 {
		width = 1
	}
	runes := []rune(text)
	var rows []WrapRow
	lineStart := 0
	for i := 0; i <= len(runes); i++ {
		if i < len(runes) && runes[i] != '\n' {
			continue
		}
		if lineStart == i {
			rows = append(rows, WrapRow{lineStart, i})
		} else {
			for s := lineStart; s < i; s += width {
				rows = append(rows, WrapRow{s, min(s + width, i)})
			}
		}
		lineStart = i + 1
	}
	return rows
}

// CursorRowCol locates a cursor within a wrap layout. A cursor sitting exactly
// on the End of a full (wrapped) row displays at the start of the next row;
// on the End of a newline-terminated or final row it displays at that row's
// end.
func CursorRowCol(rows []WrapRow, cursor int) (row, col int) {
	for i, r := range rows {
		if cursor < r.End {
			return i, cursor - r.Start
		}
		if cursor == r.End {
			if i+1 < len(rows) && rows[i+1].Start == r.End {
				return i + 1, 0 // wrap boundary: same logical line continues
			}
			return i, cursor - r.Start
		}
	}
	last := len(rows) - 1
	return last, rows[last].End - rows[last].Start
}

// IndexAtRowCol converts a visual (row, col) back into a rune index, clamping
// col to the row's length.
func IndexAtRowCol(rows []WrapRow, row, col int) int {
	row = Clamp(row, 0, len(rows)-1)
	r := rows[row]
	return r.Start + Clamp(col, 0, r.End-r.Start)
}

// MoveCursorVisual moves the cursor up (direction -1) or down (+1) one VISUAL
// row of the wrap layout, preserving the column. On the first row moving up
// lands at the start of the text; on the last row moving down lands at its
// end.
func MoveCursorVisual(text string, cursor, width, direction int) int {
	rows := WrapRows(text, width)
	cursor = ClampCursor(text, cursor)
	row, col := CursorRowCol(rows, cursor)
	if direction < 0 {
		if row == 0 {
			return 0
		}
		return IndexAtRowCol(rows, row-1, col)
	}
	if row == len(rows)-1 {
		return len([]rune(text))
	}
	return IndexAtRowCol(rows, row+1, col)
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

// RemoveAtCursor deletes the rune under the cursor (forward delete). The bool
// is false when there is nothing to delete (cursor at end).
func RemoveAtCursor(s string, cursor int) (string, bool) {
	runes := []rune(s)
	at := Clamp(cursor, 0, len(runes))
	if at == len(runes) {
		return s, false
	}
	return string(runes[:at]) + string(runes[at+1:]), true
}

// LineBounds returns the rune-index bounds [start, end) of the logical line
// (split on '\n') containing the cursor; end excludes the newline itself.
func LineBounds(s string, cursor int) (start, end int) {
	runes := []rune(s)
	cursor = Clamp(cursor, 0, len(runes))
	start = 0
	for i := cursor - 1; i >= 0; i-- {
		if runes[i] == '\n' {
			start = i + 1
			break
		}
	}
	end = len(runes)
	for i := cursor; i < len(runes); i++ {
		if runes[i] == '\n' {
			end = i
			break
		}
	}
	return start, end
}

// RemoveRange deletes the rune range [start, end), returning the new string
// and the cursor position (the range start).
func RemoveRange(s string, start, end int) (string, int) {
	runes := []rune(s)
	start = Clamp(start, 0, len(runes))
	end = Clamp(end, start, len(runes))
	return string(runes[:start]) + string(runes[end:]), start
}
