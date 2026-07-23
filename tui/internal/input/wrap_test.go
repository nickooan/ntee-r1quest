package input

import "testing"

func TestWrapRowsHardWrapsAndSplitsLines(t *testing.T) {
	rows := WrapRows("abcdef\nxy", 3)
	want := []WrapRow{{0, 3}, {3, 6}, {7, 9}}
	if len(rows) != len(want) {
		t.Fatalf("rows = %v, want %v", rows, want)
	}
	for i := range want {
		if rows[i] != want[i] {
			t.Fatalf("rows[%d] = %v, want %v", i, rows[i], want[i])
		}
	}
}

func TestWrapRowsEmptyTextAndEmptyLines(t *testing.T) {
	if rows := WrapRows("", 10); len(rows) != 1 || rows[0] != (WrapRow{0, 0}) {
		t.Fatalf("empty text rows = %v", rows)
	}
	// A trailing newline yields an empty final row the cursor can sit on.
	rows := WrapRows("ab\n", 10)
	if len(rows) != 2 || rows[1] != (WrapRow{3, 3}) {
		t.Fatalf("trailing newline rows = %v", rows)
	}
}

func TestCursorRowColWrapBoundary(t *testing.T) {
	rows := WrapRows("abcdef", 3) // {0,3} {3,6}
	// On a full wrapped row, the boundary cursor displays at the next row's start.
	if r, c := CursorRowCol(rows, 3); r != 1 || c != 0 {
		t.Fatalf("boundary = (%d,%d), want (1,0)", r, c)
	}
	if r, c := CursorRowCol(rows, 6); r != 1 || c != 3 {
		t.Fatalf("end = (%d,%d), want (1,3)", r, c)
	}
}

func TestCursorRowColNewlineBoundary(t *testing.T) {
	rows := WrapRows("ab\ncd", 10) // {0,2} {3,5}
	// Before the newline the cursor belongs to the first row's end.
	if r, c := CursorRowCol(rows, 2); r != 0 || c != 2 {
		t.Fatalf("pre-newline = (%d,%d), want (0,2)", r, c)
	}
	if r, c := CursorRowCol(rows, 3); r != 1 || c != 0 {
		t.Fatalf("post-newline = (%d,%d), want (1,0)", r, c)
	}
}

func TestIndexAtRowColClamps(t *testing.T) {
	rows := WrapRows("ab\ncdef", 10) // {0,2} {3,7}
	if got := IndexAtRowCol(rows, 0, 99); got != 2 {
		t.Fatalf("clamped col = %d, want 2", got)
	}
	if got := IndexAtRowCol(rows, 1, 2); got != 5 {
		t.Fatalf("index = %d, want 5", got)
	}
}

func TestMoveCursorVisual(t *testing.T) {
	// "abcdef" wrapped at 3 → rows abc / def.
	if got := MoveCursorVisual("abcdef", 1, 3, 1); got != 4 {
		t.Fatalf("down = %d, want 4", got)
	}
	if got := MoveCursorVisual("abcdef", 4, 3, -1); got != 1 {
		t.Fatalf("up = %d, want 1", got)
	}
	// Boundary rule: first row up → start, last row down → end.
	if got := MoveCursorVisual("abcdef", 1, 3, -1); got != 0 {
		t.Fatalf("top-row up = %d, want 0", got)
	}
	if got := MoveCursorVisual("abcdef", 4, 3, 1); got != 6 {
		t.Fatalf("bottom-row down = %d, want 6", got)
	}
	// Column preserved across a shorter row, clamped to its length.
	if got := MoveCursorVisual("abcdef\nx", 5, 10, 1); got != 8 {
		t.Fatalf("clamped down = %d, want 8", got)
	}
}

func TestRemoveAtCursor(t *testing.T) {
	if got, ok := RemoveAtCursor("abc", 1); !ok || got != "ac" {
		t.Fatalf("forward delete = %q ok=%v", got, ok)
	}
	if _, ok := RemoveAtCursor("abc", 3); ok {
		t.Fatal("delete at end should report false")
	}
}
