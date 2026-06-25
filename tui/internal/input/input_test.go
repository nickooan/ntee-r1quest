package input

import "testing"

func TestInsertAtCursor(t *testing.T) {
	out, cur := InsertAtCursor("helloworld", 5, " brave ")
	if out != "hello brave world" || cur != 12 {
		t.Fatalf("got %q cursor %d", out, cur)
	}
}

func TestInsertAtCursorClampsBeyondEnd(t *testing.T) {
	out, cur := InsertAtCursor("ab", 99, "c")
	if out != "abc" || cur != 3 {
		t.Fatalf("got %q cursor %d", out, cur)
	}
}

func TestRemoveBeforeCursor(t *testing.T) {
	out, cur, ok := RemoveBeforeCursor("abc", 2)
	if !ok || out != "ac" || cur != 1 {
		t.Fatalf("got %q cursor %d ok %v", out, cur, ok)
	}
}

func TestRemoveBeforeCursorAtStart(t *testing.T) {
	out, cur, ok := RemoveBeforeCursor("abc", 0)
	if ok || out != "abc" || cur != 0 {
		t.Fatalf("got %q cursor %d ok %v", out, cur, ok)
	}
}

func TestMoveCursorClamps(t *testing.T) {
	if MoveCursor("ab", 2, 1) != 2 {
		t.Fatal("should clamp at end")
	}
	if MoveCursor("ab", 0, -1) != 0 {
		t.Fatal("should clamp at start")
	}
}

func TestRuneAware(t *testing.T) {
	// Two-rune string; backspace at end removes one full rune.
	out, cur, ok := RemoveBeforeCursor("héllo", 2)
	if !ok || out != "hllo" || cur != 1 {
		t.Fatalf("got %q cursor %d ok %v", out, cur, ok)
	}
}
