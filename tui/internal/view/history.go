package view

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"codeberg.org/nickoan/ntee-r1quest/tui/internal/runtime"
)

// formatHistoryValue pretty-prints a header/body value: JSON objects (or
// JSON-looking strings) are indented, everything else shown as-is. Mirrors
// history-content.ts formatValue.
func formatHistoryValue(raw json.RawMessage) string {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return "(empty)"
	}

	// A JSON string may itself contain JSON (e.g. a stringified body).
	var s string
	if json.Unmarshal(raw, &s) == nil {
		inner := strings.TrimSpace(s)
		if strings.HasPrefix(inner, "{") || strings.HasPrefix(inner, "[") {
			var buf bytes.Buffer
			if json.Indent(&buf, []byte(inner), "", "  ") == nil {
				return buf.String()
			}
		}
		if s == "" {
			return "(empty)"
		}
		return s
	}

	var buf bytes.Buffer
	if json.Indent(&buf, raw, "", "  ") == nil {
		return buf.String()
	}
	return trimmed
}

func formatHistoryHeaders(headers map[string]any) string {
	if len(headers) == 0 {
		return "(none)"
	}
	keys := make([]string, 0, len(headers))
	for k := range headers {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	lines := make([]string, 0, len(keys))
	for _, k := range keys {
		lines = append(lines, fmt.Sprintf("%s: %v", k, headers[k]))
	}
	return strings.Join(lines, "\n")
}

// FormatHistoryEntry renders a cached API call as a sectioned Results view.
// Mirrors history-content.ts formatHistoryEntry.
func FormatHistoryEntry(record runtime.ApiCallRecord, width int) string {
	method := strings.ToUpper(record.Method)

	lines := []string{
		record.Endpoint,
		fmt.Sprintf("%d  ·  %d ms", record.Response.Status, record.DurationMs),
	}
	if record.TraceID != "" {
		lines = append(lines, "Trace: "+record.TraceID)
	}
	lines = append(lines,
		"",
		SectionRule("Request", width),
		"URL     "+defaultString(record.Request.URL, "(unknown)"),
		"Method  "+method,
		"",
		"Headers",
		IndentBlock(formatHistoryHeaders(record.Request.Headers), "  "),
		"",
		"Body",
		IndentBlock(formatHistoryValue(record.Request.Body), "  "),
		"",
		SectionRule("Response", width),
		fmt.Sprintf("Status  %d", record.Response.Status),
		"",
		"Headers",
		IndentBlock(formatHistoryHeaders(record.Response.Headers), "  "),
		"",
		"Body",
		IndentBlock(formatHistoryValue(record.Response.Data), "  "),
	)
	return strings.Join(lines, "\n")
}
