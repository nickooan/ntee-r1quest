package view

import (
	"regexp"
	"strings"
)

// Response-pane highlighting: colors the sectioned output of FormatResponse /
// FormatHistoryEntry (labels, status codes, headers) and its pretty-printed
// JSON bodies. Line-shape driven — the formatter's layout is regular: labels
// sit at column 0, headers/bodies are indented by IndentBlock. The r1quest
// DSL macros are deliberately not applied here.
var (
	responseLabelPattern = regexp.MustCompile(`^(URL|Method|Status|Headers|Body|Trace:|Joint chain:)( |$)`)
	responseStatusCode   = regexp.MustCompile(`^\d{3}`)
	responseJSONKey      = regexp.MustCompile(`^(\s*)("(?:\\.|[^"\\])*")(\s*)(:)`)
	responseJSONToken    = regexp.MustCompile(`"(?:\\.|[^"\\])*"|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\],:]`)
	responseJSONStart    = regexp.MustCompile(`^\s*["{}\[\]]`)
	responseHeaderKey    = regexp.MustCompile(`^(\s+)([A-Za-z0-9-]+)(:)`)
)

// highlightResponseLine renders one line of a formatted response/history entry
// into colored segments.
func highlightResponseLine(line string) []HighlightSegment {
	// Section rules: `── Request ────…`
	if strings.HasPrefix(strings.TrimLeft(line, " "), "─") {
		return []HighlightSegment{{Text: line, Color: "gray"}}
	}

	// Formatter labels at column 0 (bodies are indented, so no clash).
	if lm := responseLabelPattern.FindStringSubmatchIndex(line); lm != nil {
		label := line[lm[2]:lm[3]]
		segments := []HighlightSegment{{Text: label, Color: "cyan", Bold: true}}
		rest := line[lm[3]:]
		if label == "Status" {
			pad := rest[:len(rest)-len(strings.TrimLeft(rest, " "))]
			value := rest[len(pad):]
			if code := responseStatusCode.FindString(value); code != "" {
				color := "green"
				switch value[0] {
				case '3':
					color = "yellow"
				case '4', '5':
					color = "red"
				}
				return append(segments,
					HighlightSegment{Text: pad},
					HighlightSegment{Text: code, Color: color, Bold: true},
					HighlightSegment{Text: value[len(code):]})
			}
		}
		return append(segments, HighlightSegment{Text: rest})
	}

	// Pretty-printed JSON body lines.
	if responseJSONStart.MatchString(line) {
		return highlightJSONLine(line)
	}

	// Indented `key: value` header lines.
	if hm := responseHeaderKey.FindStringSubmatchIndex(line); hm != nil {
		return []HighlightSegment{
			{Text: line[hm[2]:hm[3]]},
			{Text: line[hm[4]:hm[5]], Color: "cyan"},
			{Text: ":", Color: "gray"},
			{Text: line[hm[1]:]},
		}
	}

	// Title lines, error text, external output — plain.
	return []HighlightSegment{{Text: line}}
}

// highlightJSONLine colors one line of pretty-printed JSON: keys green, all
// values (strings, numbers, booleans) standard white/cream, punctuation gray.
func highlightJSONLine(line string) []HighlightSegment {
	var segments []HighlightSegment
	cursor := 0

	if km := responseJSONKey.FindStringSubmatchIndex(line); km != nil {
		if km[2] != km[3] {
			segments = append(segments, HighlightSegment{Text: line[km[2]:km[3]]})
		}
		segments = append(segments, HighlightSegment{Text: line[km[4]:km[5]], Color: "green"})
		if km[6] != km[7] {
			segments = append(segments, HighlightSegment{Text: line[km[6]:km[7]]})
		}
		segments = append(segments, HighlightSegment{Text: ":", Color: "gray"})
		cursor = km[1]
	}

	for _, m := range responseJSONToken.FindAllStringSubmatchIndex(line, -1) {
		start, end := m[0], m[1]
		if start < cursor {
			continue
		}
		if start > cursor {
			segments = append(segments, HighlightSegment{Text: line[cursor:start]})
		}
		token := line[start:end]
		switch {
		case len(token) == 1 && strings.ContainsAny(token, "{}[],:"):
			segments = append(segments, HighlightSegment{Text: token, Color: "gray"})
		default: // string / number / bool / null values
			segments = append(segments, HighlightSegment{Text: token, Color: "white"})
		}
		cursor = end
	}
	if cursor < len(line) {
		segments = append(segments, HighlightSegment{Text: line[cursor:]})
	}
	return segments
}
