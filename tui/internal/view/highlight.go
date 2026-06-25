package view

import (
	"regexp"
	"strconv"
	"strings"
)

// Ported from src/views/terminal/file-content-highlight.ts. Colors are Ink color
// names; the renderer maps them to lipgloss. Go's RE2 lacks lookahead, so the
// one lookahead pattern (graphql sugar start) is handled in code.

// HighlightSegment is a colored run of text.
type HighlightSegment struct {
	Text     string
	Color    string
	Bold     bool
	DimColor bool
}

// FilePaneLayout mirrors file-content-highlight.ts FilePaneLayout.
type FilePaneLayout struct {
	ContentWidth    int
	ContentHeight   int
	LineNumberWidth int
}

const highlightPaddingX = 1

var (
	syntaxPattern        = regexp.MustCompile(`(@)(i|f|env)(\([^)]*\))|\b(true|false|null)\b|"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?|//.*$`)
	macroArgsPattern     = regexp.MustCompile(`\bor\b|"(?:\\.|[^"\\])*"|\b(true|false)\b|-?\d+(?:\.\d+)?`)
	stringMacroPattern   = regexp.MustCompile(`(@)(i)(\([A-Za-z][A-Za-z0-9_-]*\))`)
	keywordPattern       = regexp.MustCompile(`^(\s*)(ref|url|type|header|authorization|auth|body)\b`)
	graphqlStartPattern  = regexp.MustCompile(`^\s*(query|mutation)\s*:\s*(?:"|$)`)
	graphqlSugarStart    = regexp.MustCompile(`^\s*(query|mutation)\b`)
	afterWhitespaceColon = regexp.MustCompile(`^\s*:`)
	graphqlStringStart   = regexp.MustCompile(`^\s*"`)
	graphqlSyntaxPattern = regexp.MustCompile(`#.*$|"(?:\\.|[^"\\])*"|\$[A-Za-z_][A-Za-z0-9_]*|@[A-Za-z_][A-Za-z0-9_]*|\b(query|mutation|subscription|fragment|on|true|false|null)\b|-?\d+(?:\.\d+)?|[!$():=@{}\[\],|]`)
	leadingDigit         = regexp.MustCompile(`^-?\d`)
)

func hasClosingUnescapedQuote(line string, startIndex int) bool {
	for i := startIndex; i < len(line); i++ {
		if line[i] != '"' {
			continue
		}
		slashes := 0
		for s := i - 1; s >= 0 && line[s] == '\\'; s-- {
			slashes++
		}
		if slashes%2 == 0 {
			return true
		}
	}
	return false
}

func graphqlBraceDelta(line string) int {
	delta := 0
	inString := false
	for i := 0; i < len(line); i++ {
		c := line[i]
		if inString {
			if c == '\\' && i+1 < len(line) {
				i++
			} else if c == '"' {
				inString = false
			}
			continue
		}
		switch c {
		case '#':
			return delta
		case '"':
			inString = true
		case '{':
			delta++
		case '}':
			delta--
		}
	}
	return delta
}

func matchesGraphqlSugarStart(line string) bool {
	loc := graphqlSugarStart.FindStringIndex(line)
	if loc == nil {
		return false
	}
	return !afterWhitespaceColon.MatchString(line[loc[1]:])
}

// BuildGraphqlHighlightLines returns the set of line indices that hold GraphQL
// content. Mirrors buildGraphqlHighlightLines.
func BuildGraphqlHighlightLines(lines []string) map[int]bool {
	graphql := map[int]bool{}
	pendingValue := false
	inString := false
	inSugarBlock := false
	sugarDepth := 0

	for i, line := range lines {
		switch {
		case inSugarBlock:
			graphql[i] = true
			sugarDepth += graphqlBraceDelta(line)
			if sugarDepth <= 0 {
				inSugarBlock = false
				sugarDepth = 0
			}
		case inString:
			graphql[i] = true
			if hasClosingUnescapedQuote(line, 0) {
				inString = false
			}
		case pendingValue:
			if strings.TrimSpace(line) == "" {
				continue
			}
			pendingValue = false
			if !graphqlStringStart.MatchString(line) {
				continue
			}
			graphql[i] = true
			quote := strings.IndexByte(line, '"')
			if !hasClosingUnescapedQuote(line, quote+1) {
				inString = true
			}
		case matchesGraphqlSugarStart(line):
			graphql[i] = true
			sugarDepth = graphqlBraceDelta(line)
			if sugarDepth > 0 {
				inSugarBlock = true
			} else {
				sugarDepth = 0
			}
		case graphqlStartPattern.MatchString(line):
			quote := strings.IndexByte(line, '"')
			if quote == -1 {
				pendingValue = true
				continue
			}
			graphql[i] = true
			if !hasClosingUnescapedQuote(line, quote+1) {
				inString = true
			}
		}
	}
	return graphql
}

// BuildFilePaneLayout mirrors buildFilePaneLayout.
func BuildFilePaneLayout(width, height, lineCount int) FilePaneLayout {
	contentHeight := max(1, height-2)
	lineNumberWidth := len(strconv.Itoa(max(lineCount, contentHeight)))
	gutter := lineNumberWidth + 2
	contentWidth := max(1, width-2-highlightPaddingX*2-gutter)
	return FilePaneLayout{ContentWidth: contentWidth, ContentHeight: contentHeight, LineNumberWidth: lineNumberWidth}
}

func highlightGraphqlLine(line string) []HighlightSegment {
	var segments []HighlightSegment
	cursor := 0
	for _, m := range graphqlSyntaxPattern.FindAllStringSubmatchIndex(line, -1) {
		start, end := m[0], m[1]
		token := line[start:end]
		if start > cursor {
			segments = append(segments, HighlightSegment{Text: line[cursor:start]})
		}
		switch {
		case strings.HasPrefix(token, "#"):
			segments = append(segments, HighlightSegment{Text: token, DimColor: true})
		case strings.HasPrefix(token, `"`):
			segments = append(segments, HighlightSegment{Text: token, Color: "yellow"})
		case strings.HasPrefix(token, "$"):
			segments = append(segments, HighlightSegment{Text: token, Color: "green", Bold: true})
		case strings.HasPrefix(token, "@"):
			segments = append(segments, HighlightSegment{Text: token, Color: "red", Bold: true})
		case m[2] != -1: // keyword group
			segments = append(segments, HighlightSegment{Text: token, Color: "cyan", Bold: true})
		case leadingDigit.MatchString(token):
			segments = append(segments, HighlightSegment{Text: token, Color: "blue"})
		default:
			segments = append(segments, HighlightSegment{Text: token, DimColor: true})
		}
		cursor = end
	}
	if cursor < len(line) {
		segments = append(segments, HighlightSegment{Text: line[cursor:]})
	}
	return segments
}

func highlightMacroArgs(args string) []HighlightSegment {
	var segments []HighlightSegment
	cursor := 0
	for _, m := range macroArgsPattern.FindAllStringSubmatchIndex(args, -1) {
		start, end := m[0], m[1]
		token := args[start:end]
		if start > cursor {
			segments = append(segments, HighlightSegment{Text: args[cursor:start]})
		}
		switch {
		case token == "or":
			segments = append(segments, HighlightSegment{Text: token, Color: "cyan", Bold: true})
		case strings.HasPrefix(token, `"`):
			segments = append(segments, HighlightSegment{Text: token, Color: "yellow"})
		case m[2] != -1: // true/false group
			segments = append(segments, HighlightSegment{Text: token, Color: "magenta"})
		default:
			segments = append(segments, HighlightSegment{Text: token, Color: "blue"})
		}
		cursor = end
	}
	if cursor < len(args) {
		segments = append(segments, HighlightSegment{Text: args[cursor:]})
	}
	return segments
}

func highlightString(token string) []HighlightSegment {
	var segments []HighlightSegment
	cursor := 0
	for _, m := range stringMacroPattern.FindAllStringSubmatchIndex(token, -1) {
		start, end := m[0], m[1]
		at := token[m[2]:m[3]]
		action := token[m[4]:m[5]]
		args := token[m[6]:m[7]]
		if start > cursor {
			segments = append(segments, HighlightSegment{Text: token[cursor:start], Color: "yellow"})
		}
		segments = append(segments, HighlightSegment{Text: at, Color: "red", Bold: true})
		segments = append(segments, HighlightSegment{Text: action, Color: "green", Bold: true})
		segments = append(segments, HighlightSegment{Text: args})
		cursor = end
	}
	if cursor < len(token) {
		segments = append(segments, HighlightSegment{Text: token[cursor:], Color: "yellow"})
	}
	return segments
}

// HighlightLine renders a line of r1quest (default) or graphql into colored
// segments. Mirrors highlightLine.
func HighlightLine(line, language string) []HighlightSegment {
	if language == "graphql" {
		return highlightGraphqlLine(line)
	}

	var segments []HighlightSegment
	keywordEnd := -1
	// keywordPattern groups: 1 = leading whitespace, 2 = the keyword.
	if km := keywordPattern.FindStringSubmatchIndex(line); km != nil && km[4] != -1 {
		keywordStart := km[4] // start of the keyword
		keywordEnd = km[5]    // end of the keyword
		if keywordStart > 0 {
			segments = append(segments, HighlightSegment{Text: line[:keywordStart]})
		}
		segments = append(segments, HighlightSegment{Text: line[keywordStart:keywordEnd], Color: "cyan", Bold: true})
	}

	cursor := 0
	if keywordEnd != -1 {
		cursor = keywordEnd
	}

	for _, m := range syntaxPattern.FindAllStringSubmatchIndex(line, -1) {
		start, end := m[0], m[1]
		if start < cursor {
			continue
		}
		token := line[start:end]
		if start > cursor {
			segments = append(segments, HighlightSegment{Text: line[cursor:start]})
		}
		switch {
		case m[2] != -1 && m[4] != -1 && m[6] != -1: // @ + action + (args)
			segments = append(segments, HighlightSegment{Text: line[m[2]:m[3]], Color: "red", Bold: true})
			segments = append(segments, HighlightSegment{Text: line[m[4]:m[5]], Color: "green", Bold: true})
			segments = append(segments, highlightMacroArgs(line[m[6]:m[7]])...)
		case m[8] != -1: // true/false/null
			segments = append(segments, HighlightSegment{Text: token, Color: "magenta"})
		case strings.HasPrefix(token, `"`):
			segments = append(segments, highlightString(token)...)
		case strings.HasPrefix(token, "//"):
			segments = append(segments, HighlightSegment{Text: token, DimColor: true})
		default:
			segments = append(segments, HighlightSegment{Text: token, Color: "blue"})
		}
		cursor = end
	}
	if cursor < len(line) {
		segments = append(segments, HighlightSegment{Text: line[cursor:]})
	}
	return segments
}
