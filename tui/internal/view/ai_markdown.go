package view

import (
	"regexp"
	"strings"
)

// Light markdown accents for AI chat prose: whole-line headers, list markers,
// fenced code, and inline spans (`code`, **bold**, bare links). A span is
// styled only when its closing delimiter is on the same logical line, so
// partially streamed markdown renders literally until the closer arrives —
// the transcript re-renders every frame, so styling snaps in on its own.

var (
	mdHeaderPattern = regexp.MustCompile(`^#{1,6} `)
	mdListPattern   = regexp.MustCompile(`^\s*(?:[-*]|\d+\.) `)
	mdInlinePattern = regexp.MustCompile("`[^`]+`|\\*\\*[^*]+\\*\\*|https?://[^ \t]+")
)

// MarkdownLineSegments styles one logical line and returns the code-block
// state after it (a fence line toggles the state; callers reset it at message
// start).
func MarkdownLineSegments(line string, inCodeBlock bool) ([]HighlightSegment, bool) {
	if strings.HasPrefix(strings.TrimSpace(line), "```") {
		return []HighlightSegment{{Text: line, DimColor: true}}, !inCodeBlock
	}
	if inCodeBlock {
		return []HighlightSegment{{Text: line, Color: "yellow"}}, true
	}
	if mdHeaderPattern.MatchString(line) {
		return []HighlightSegment{{Text: line, Color: "blue", Bold: true}}, false
	}

	rest := line
	var segments []HighlightSegment
	if marker := mdListPattern.FindString(line); marker != "" {
		segments = append(segments, HighlightSegment{Text: marker, Color: "cyan"})
		rest = line[len(marker):]
	}
	return append(segments, markdownInlineSegments(rest)...), false
}

func markdownInlineSegments(text string) []HighlightSegment {
	var segments []HighlightSegment
	cursor := 0
	for _, loc := range mdInlinePattern.FindAllStringIndex(text, -1) {
		start, end := loc[0], loc[1]
		if start > cursor {
			segments = append(segments, HighlightSegment{Text: text[cursor:start]})
		}
		token := text[start:end]
		switch {
		case strings.HasPrefix(token, "`"):
			segments = append(segments, HighlightSegment{Text: token, Color: "yellow"})
		case strings.HasPrefix(token, "**"):
			segments = append(segments, HighlightSegment{Text: token, Bold: true})
		default:
			segments = append(segments, HighlightSegment{Text: token, Color: "cyan", Underline: true})
		}
		cursor = end
	}
	if cursor < len(text) || len(segments) == 0 {
		segments = append(segments, HighlightSegment{Text: text[cursor:]})
	}
	return segments
}

// WrapSegments wraps styled segments into rows of at most width runes,
// splitting a segment at the boundary while keeping its style attributes on
// the continuation row. Always returns at least one row.
func WrapSegments(segments []HighlightSegment, width int) [][]HighlightSegment {
	if width <= 0 {
		return [][]HighlightSegment{segments}
	}

	var rows [][]HighlightSegment
	var row []HighlightSegment
	used := 0
	for _, segment := range segments {
		runes := []rune(segment.Text)
		for len(runes) > 0 {
			if used == width {
				rows = append(rows, row)
				row, used = nil, 0
			}
			take := min(width-used, len(runes))
			part := segment
			part.Text = string(runes[:take])
			row = append(row, part)
			used += take
			runes = runes[take:]
		}
	}
	if len(row) > 0 || len(rows) == 0 {
		rows = append(rows, row)
	}
	return rows
}
