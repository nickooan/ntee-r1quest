package app

import (
	"strings"
	"testing"
	"unicode/utf8"

	"codeberg.org/nickoan/ntee-r1quest/tui/internal/view"
)

// Section dividers are almost entirely 3-byte box-drawing runes; a byte-based
// width cut splits one mid-sequence and the terminal shows �. renderSearchLine
// must truncate by runes.
func TestRenderSearchLineNeverSplitsRunes(t *testing.T) {
	divider := "── Request " + strings.Repeat("─", 60)

	for width := 1; width <= 30; width++ {
		got := renderSearchLine(divider, nil, 0, width)
		if !utf8.ValidString(got) {
			t.Fatalf("width %d: invalid UTF-8: %q", width, got)
		}
		if strings.ContainsRune(got, utf8.RuneError) {
			t.Fatalf("width %d: replacement char in output: %q", width, got)
		}
		if n := utf8.RuneCountInString(got); n != width {
			t.Errorf("width %d: rendered %d runes", width, n)
		}
	}
}

func TestRenderSearchLineHighlightsWithMultibyteContent(t *testing.T) {
	line := "── Request ──── data ────"
	start := strings.Index(line, "data")
	matches := []view.LineMatch{{
		SearchMatch: view.SearchMatch{Start: start, End: start + len("data")},
		MatchIndex:  0,
	}}

	got := renderSearchLine(line, matches, 0, 40)
	if !utf8.ValidString(got) || strings.ContainsRune(got, utf8.RuneError) {
		t.Fatalf("invalid output: %q", got)
	}
	if !strings.Contains(got, "data") {
		t.Fatalf("match text missing from output: %q", got)
	}
}
