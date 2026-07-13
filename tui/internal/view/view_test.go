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
	// A raw \r in a rendered line would jump the terminal cursor to column 0
	// and shear the pane borders (e.g. nginx 503 HTML bodies use CRLF).
	if got := FormatResponseBody(json.RawMessage("<html>\r\n<body>x</body>\r</html>")); got != "<html>\n<body>x</body>\n</html>" {
		t.Fatalf("CRLF body: %q", got)
	}
	if got := FormatResponseBody(json.RawMessage(`"line 1\r\nline 2"`)); got != "line 1\nline 2" {
		t.Fatalf("CRLF string body: %q", got)
	}
}

func TestNormalizeLinesStripsCR(t *testing.T) {
	got := NormalizeLines("a\r\nb\nc")
	if len(got) != 3 || got[0] != "a" || got[1] != "b" || got[2] != "c" {
		t.Fatalf("got %q", got)
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

func TestFormatExecuteResultPlainRequest(t *testing.T) {
	res := runtime.ExecuteResult{Status: 200, StatusText: "OK"}
	res.Request.Method = "get"
	res.Request.URL = "https://ntee.io/x"

	got := FormatExecuteResult(res, 60)
	if strings.Contains(got, "Trace:") || strings.Contains(got, "Joint") {
		t.Fatalf("plain request must not render chain lines; got:\n%s", got)
	}
}

func TestFormatExecuteResultJointChain(t *testing.T) {
	res := runtime.ExecuteResult{Status: 200, StatusText: "OK", TraceID: "t-1", StepCount: 3}
	res.Request.Method = "post"
	res.Request.URL = "https://ntee.io/x"

	got := FormatExecuteResult(res, 60)
	if !strings.Contains(got, "Trace: t-1") {
		t.Fatalf("expected trace line; got:\n%s", got)
	}
	if !strings.Contains(got, "Joint chain: 3 steps completed, trace t-1 — inspect with @h t-1") {
		t.Fatalf("expected chain footer; got:\n%s", got)
	}
}

func TestFormatExecuteResultFailedStep(t *testing.T) {
	res := runtime.ExecuteResult{Status: 500, StatusText: "Server Error", TraceID: "t-1", FailedStep: "2/3 (query-user-posts)"}
	res.Request.Method = "post"
	res.Request.URL = "https://ntee.io/x"

	got := FormatExecuteResult(res, 60)
	if !strings.HasPrefix(got, "Joint step 2/3 (query-user-posts) failed.") {
		t.Fatalf("expected failed-step banner first; got:\n%s", got)
	}
	if !strings.Contains(got, "Trace: t-1") {
		t.Fatalf("expected trace line; got:\n%s", got)
	}
	if strings.Contains(got, "Joint chain:") {
		t.Fatalf("failed run must not render the completed footer; got:\n%s", got)
	}
}
