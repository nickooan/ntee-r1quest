package view

import (
	"encoding/json"
	"strings"
	"testing"

	"codeberg.org/nickoan/ntee-r1quest/tui/internal/runtime"
)

func TestFormatHistoryEntry(t *testing.T) {
	rec := runtime.ApiCallRecord{Endpoint: "/orders [GET]", Method: "get", DurationMs: 42}
	rec.Request.URL = "https://api.test/orders"
	rec.Request.Headers = map[string]any{"accept": "application/json"}
	rec.Response.Status = 200
	rec.Response.Headers = map[string]any{"content-type": "application/json"}
	rec.Response.Data = json.RawMessage(`{"ok":true}`)

	out := FormatHistoryEntry(rec, 60)
	for _, want := range []string{
		"/orders [GET]",
		"200  ·  42 ms",
		"URL     https://api.test/orders",
		"Method  GET",
		`"ok": true`,
	} {
		if !strings.Contains(out, want) {
			t.Fatalf("history entry missing %q in:\n%s", want, out)
		}
	}
}

func TestFormatHistoryValueStringifiedJSON(t *testing.T) {
	// A body sent as a JSON string that itself contains JSON gets pretty-printed.
	got := formatHistoryValue(json.RawMessage(`"{\"a\":1}"`))
	if got != "{\n  \"a\": 1\n}" {
		t.Fatalf("got %q", got)
	}
	if formatHistoryValue(json.RawMessage(`null`)) != "(empty)" {
		t.Fatal("null should be (empty)")
	}
}

func TestFindSearchMatches(t *testing.T) {
	content := "hello world\nHELLO again\nbye"
	matches := FindSearchMatches(content, "hello")
	if len(matches) != 2 {
		t.Fatalf("expected 2 case-insensitive matches, got %d", len(matches))
	}
	if matches[0].LineIndex != 0 || matches[0].Start != 0 || matches[0].End != 5 {
		t.Fatalf("first match: %+v", matches[0])
	}
	if matches[1].LineIndex != 1 {
		t.Fatalf("second match line: %+v", matches[1])
	}
}

func TestFindSearchMatchesInvalidRegexFallsBackToLiteral(t *testing.T) {
	// "(" is invalid regex; should match literally.
	matches := FindSearchMatches("a(b)c\nxyz", "(")
	if len(matches) != 1 || matches[0].Start != 1 {
		t.Fatalf("literal fallback failed: %+v", matches)
	}
}

func TestBuildMatchesByLine(t *testing.T) {
	matches := []SearchMatch{
		{LineIndex: 0, Start: 5, End: 7},
		{LineIndex: 0, Start: 0, End: 2},
		{LineIndex: 2, Start: 1, End: 3},
	}
	byLine := BuildMatchesByLine(matches)
	if len(byLine[0]) != 2 || byLine[0][0].Start != 0 {
		t.Fatalf("line 0 bucket should be sorted by start: %+v", byLine[0])
	}
	// Global match index preserved.
	if byLine[0][0].MatchIndex != 1 {
		t.Fatalf("expected global match index 1, got %d", byLine[0][0].MatchIndex)
	}
}
