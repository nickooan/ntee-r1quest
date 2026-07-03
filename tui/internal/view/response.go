package view

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"

	"codeberg.org/nickoan/ntee-r1quest/tui/internal/runtime"
)

// DefaultSectionWidth matches response.ts (one-shot/history default).
const DefaultSectionWidth = 60

// FormatResponseHeaders renders sorted "key: value" lines. Mirrors
// formatResponseHeaders.
func FormatResponseHeaders(headers map[string]any) string {
	keys := make([]string, 0, len(headers))
	for k, v := range headers {
		if v == nil {
			continue
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)

	lines := make([]string, 0, len(keys))
	for _, k := range keys {
		lines = append(lines, k+": "+formatHeaderValue(headers[k]))
	}
	return strings.Join(lines, "\n")
}

func formatHeaderValue(value any) string {
	switch v := value.(type) {
	case nil:
		return ""
	case []any:
		parts := make([]string, len(v))
		for i, item := range v {
			parts[i] = fmt.Sprint(item)
		}
		return strings.Join(parts, ", ")
	case string:
		return v
	default:
		return fmt.Sprint(v)
	}
}

// FormatResponseBody renders a response body. A JSON string is returned as-is; a
// scalar via its literal; an object/array pretty-printed (order preserved, since
// the body stays raw JSON). Mirrors formatResponseBody.
func FormatResponseBody(body json.RawMessage) string {
	trimmed := strings.TrimSpace(string(body))
	if trimmed == "" || trimmed == "null" {
		return ""
	}

	var s string
	if json.Unmarshal(body, &s) == nil {
		return normalizeNewlines(s)
	}

	var b bool
	if json.Unmarshal(body, &b) == nil {
		return strconv.FormatBool(b)
	}

	var f float64
	if json.Unmarshal(body, &f) == nil {
		return strconv.FormatFloat(f, 'g', -1, 64)
	}

	var buf bytes.Buffer
	if json.Indent(&buf, body, "", "  ") == nil {
		return buf.String()
	}
	return normalizeNewlines(trimmed)
}

// normalizeNewlines converts CRLF and lone CR to LF for display. A raw \r in a
// TUI pane jumps the cursor to column 0 and shears the box borders; only the
// rendered string changes — the stored body keeps its exact bytes.
func normalizeNewlines(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	return strings.ReplaceAll(s, "\r", "\n")
}

func formatRequestPath(rawURL, baseURL string) string {
	if rawURL == "" {
		return "/"
	}

	var parsed *url.URL
	var err error
	if baseURL != "" {
		var base *url.URL
		base, err = url.Parse(baseURL)
		if err == nil {
			parsed, err = base.Parse(rawURL)
		}
	} else {
		parsed, err = url.Parse(rawURL)
	}
	if err == nil && parsed != nil && parsed.Path != "" {
		return parsed.Path
	}

	// Not parseable as an absolute URL: drop any query string.
	if i := strings.IndexByte(rawURL, '?'); i >= 0 {
		return rawURL[:i]
	}
	return rawURL
}

// FormatResponse renders an ExecuteResult as the sectioned Results view, matching
// response.ts formatResponse. width sizes the section rules.
func FormatResponse(res runtime.ExecuteResult, traceID string, width int) string {
	method := strings.ToUpper(defaultString(res.Request.Method, "request"))
	path := formatRequestPath(res.Request.URL, res.Request.BaseURL)
	reqURL := defaultString(res.Request.URL, "(unknown)")
	statusLine := strings.TrimSpace(fmt.Sprintf("%d %s", res.Status, res.StatusText))
	headers := FormatResponseHeaders(res.Headers)
	body := FormatResponseBody(res.Body)

	// Show the request duration after the status, like history mode.
	statusHeader := statusLine
	if res.DurationMs > 0 {
		statusHeader = fmt.Sprintf("%s  ·  %d ms", statusLine, res.DurationMs)
	}

	lines := []string{
		fmt.Sprintf("%s [%s]", path, method),
		statusHeader,
	}
	if traceID != "" {
		lines = append(lines, "Trace: "+traceID)
	}
	lines = append(lines,
		"",
		SectionRule("Request", width),
		"URL     "+reqURL,
		"Method  "+method,
		"",
		SectionRule("Response", width),
		"Status  "+statusLine,
		"",
		"Headers",
		IndentBlock(emptyFallback(headers, "(none)"), "  "),
		"",
		"Body",
		IndentBlock(emptyFallback(body, "(empty)"), "  "),
	)
	return strings.Join(lines, "\n")
}

// FormatError renders a true failure (no response) as an Error block. Mirrors
// formatError.
func FormatError(err error, width int) string {
	message := "unknown error"
	if err != nil {
		message = err.Error()
	}
	return strings.Join([]string{SectionRule("Error", width), "", message}, "\n")
}

func defaultString(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func emptyFallback(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
