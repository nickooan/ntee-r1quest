package view

import (
	"regexp"
	"strings"
)

// Light markdown accents for AI chat prose, tuned for the GitHub-flavored
// markdown both Claude and Codex emit: whole-line headers, list markers,
// blockquotes, fenced code, and inline spans (`code`, **bold**, *italic*,
// ***both***, ~~strike~~, [links](url), and bare URLs). A span is styled only
// when its closing delimiter is on the same logical line, so partially
// streamed markdown renders literally until the closer arrives — the
// transcript re-renders every frame, so styling snaps in on its own.
//
// Underscore emphasis (_italic_, __bold__) is deliberately NOT styled: agent
// prose is full of snake_case and dunder identifiers (foo_bar, __init__) that
// it would wrongly mangle. Only the asterisk forms are recognized.

var (
	mdHeaderPattern = regexp.MustCompile(`^#{1,6} `)
	mdListPattern   = regexp.MustCompile(`^\s*(?:[-*+]|\d+\.) `)
	mdQuotePattern  = regexp.MustCompile(`^\s*> ?`)

	// Ordered most-specific first: Go's regexp prefers the earliest match and,
	// at a tie, the earlier alternative — so links beat bare URLs and
	// ***both*** beats **bold** beats *italic*.
	mdInlinePattern = regexp.MustCompile(strings.Join([]string{
		`\[[^\]]+\]\([^)]+\)`, // [label](url)
		"`[^`]+`",             // `code`
		`\*\*\*[^*]+\*\*\*`,   // ***bold italic***
		`\*\*[^*]+\*\*`,       // **bold**
		`\*[^*]+\*`,           // *italic*
		`~~[^~]+~~`,           // ~~strikethrough~~
		`https?://[^ \t]+`,    // bare url
	}, "|"))

	// Trailing punctuation that should not be swallowed into a bare URL.
	mdURLTrailing = ".,;:!?)]}'\""
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
	if marker := mdQuotePattern.FindString(line); marker != "" {
		segments = append(segments, HighlightSegment{Text: marker, Color: "gray"})
		rest = line[len(marker):]
	} else if marker := mdListPattern.FindString(line); marker != "" {
		segments = append(segments, HighlightSegment{Text: marker, Color: "cyan"})
		rest = line[len(marker):]
	}
	return append(segments, markdownInlineSegments(rest)...), false
}

func markdownInlineSegments(text string) []HighlightSegment {
	var segments []HighlightSegment
	cursor := 0
	emitPlain := func(s string) {
		if s != "" {
			segments = append(segments, HighlightSegment{Text: s})
		}
	}
	for _, loc := range mdInlinePattern.FindAllStringIndex(text, -1) {
		start, end := loc[0], loc[1]
		emitPlain(text[cursor:start])
		token := text[start:end]
		cursor = end
		switch {
		case strings.HasPrefix(token, "["):
			label, url := splitMarkdownLink(token)
			segments = append(segments, HighlightSegment{Text: label, Color: "cyan", Underline: true})
			if url != "" {
				// Keep the URL visible (and copyable) but de-emphasized, since a
				// terminal link isn't clickable.
				segments = append(segments, HighlightSegment{Text: " (" + url + ")", Color: "gray"})
			}
		case strings.HasPrefix(token, "`"):
			segments = append(segments, HighlightSegment{Text: token, Color: "yellow"})
		case strings.HasPrefix(token, "***"):
			segments = append(segments, HighlightSegment{Text: token, Bold: true, Italic: true})
		case strings.HasPrefix(token, "**"):
			segments = append(segments, HighlightSegment{Text: token, Bold: true})
		case strings.HasPrefix(token, "*"):
			segments = append(segments, HighlightSegment{Text: token, Italic: true})
		case strings.HasPrefix(token, "~~"):
			segments = append(segments, HighlightSegment{Text: token, Strike: true})
		default: // bare url
			link, trailing := trimURLTrailing(token)
			segments = append(segments, HighlightSegment{Text: link, Color: "cyan", Underline: true})
			emitPlain(trailing)
		}
	}
	emitPlain(text[cursor:])
	if len(segments) == 0 {
		segments = append(segments, HighlightSegment{Text: text})
	}
	return segments
}

// splitMarkdownLink pulls the label and url out of a "[label](url)" token.
func splitMarkdownLink(token string) (label, url string) {
	i := strings.Index(token, "](")
	if i < 0 || !strings.HasPrefix(token, "[") || !strings.HasSuffix(token, ")") {
		return token, ""
	}
	return token[1:i], token[i+2 : len(token)-1]
}

// trimURLTrailing splits sentence punctuation off the end of a bare URL so it
// is not underlined as part of the link (e.g. "see https://x.dev." keeps the
// period as plain text).
func trimURLTrailing(url string) (clean, trailing string) {
	i := len(url)
	for i > 0 && strings.IndexByte(mdURLTrailing, url[i-1]) >= 0 {
		i--
	}
	return url[:i], url[i:]
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
