package view

import (
	"encoding/json"
	"strings"
	"testing"

	"codeberg.org/nickoan/ntee-r1quest/tui/internal/runtime"
)

func TestSectionRule(t *testing.T) {
	got := SectionRule("Headers", 20)
	want := "── Headers " + strings.Repeat("─", 9)
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestIndentBlock(t *testing.T) {
	got := IndentBlock("a\n\nb", "  ")
	if got != "  a\n\n  b" {
		t.Fatalf("got %q", got)
	}
}

func TestFormatResponseBody(t *testing.T) {
	if got := FormatResponseBody(json.RawMessage(`"line 1\nline 2"`)); got != "line 1\nline 2" {
		t.Fatalf("string body: %q", got)
	}
	if got := FormatResponseBody(json.RawMessage(`null`)); got != "" {
		t.Fatalf("null body: %q", got)
	}
	if got := FormatResponseBody(json.RawMessage(`42`)); got != "42" {
		t.Fatalf("number body: %q", got)
	}
	got := FormatResponseBody(json.RawMessage(`{"content":[{"name":"abc"}]}`))
	want := "{\n  \"content\": [\n    {\n      \"name\": \"abc\"\n    }\n  ]\n}"
	if got != want {
		t.Fatalf("object body:\n%q\nwant\n%q", got, want)
	}
}

func TestFormatResponseShowsDuration(t *testing.T) {
	res := runtime.ExecuteResult{Status: 404, StatusText: "Not Found", DurationMs: 680}
	res.Request.Method = "get"
	res.Request.URL = "https://ntee.io/x"

	got := FormatResponse(res, "", 60)
	if !strings.Contains(got, "404 Not Found  ·  680 ms") {
		t.Fatalf("expected duration after status; got:\n%s", got)
	}
}

func TestFormatResponse(t *testing.T) {
	res := runtime.ExecuteResult{
		Status:     200,
		StatusText: "OK",
		Headers: map[string]any{
			"content-type": "application/json",
			"x-request-id": "abc-123",
		},
		Body: json.RawMessage(`{"content":[{"name":"abc"}]}`),
	}
	res.Request.Method = "get"
	res.Request.URL = "https://ntee.io/xxx/xx/xxx"

	want := strings.Join([]string{
		"/xxx/xx/xxx [GET]",
		"200 OK",
		"",
		SectionRule("Request", 60),
		"URL     https://ntee.io/xxx/xx/xxx",
		"Method  GET",
		"",
		SectionRule("Response", 60),
		"Status  200 OK",
		"",
		"Headers",
		"  content-type: application/json",
		"  x-request-id: abc-123",
		"",
		"Body",
		"  {",
		`    "content": [`,
		"      {",
		`        "name": "abc"`,
		"      }",
		"    ]",
		"  }",
	}, "\n")

	if got := FormatResponse(res, "", 60); got != want {
		t.Fatalf("got:\n%s\n\nwant:\n%s", got, want)
	}
}

func TestBuildTerminalViewport(t *testing.T) {
	vp := BuildTerminalViewport("abcdef\nghijkl\nmnopqr", 3, 2, 1, 1)
	// scrollY=1 → start at "ghijkl"; scrollX=1 width=3 → "hij" then "nop"
	if len(vp.Lines) != 2 || vp.Lines[0] != "hij" || vp.Lines[1] != "nop" {
		t.Fatalf("lines: %#v", vp.Lines)
	}
	if vp.MaxScrollY != 1 || vp.MaxScrollX != 3 {
		t.Fatalf("max scroll x=%d y=%d", vp.MaxScrollX, vp.MaxScrollY)
	}
}

func TestBuildTerminalViewportPadsShort(t *testing.T) {
	vp := BuildTerminalViewport("ab", 4, 3, 0, 0)
	if len(vp.Lines) != 3 || vp.Lines[0] != "ab  " || vp.Lines[1] != "    " {
		t.Fatalf("lines: %#v", vp.Lines)
	}
}
