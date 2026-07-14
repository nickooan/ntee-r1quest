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
	Text      string
	Color     string
	Bold      bool
	DimColor  bool
	Underline bool
	Italic    bool
	Strike    bool
}

// FilePaneLayout mirrors file-content-highlight.ts FilePaneLayout.
type FilePaneLayout struct {
	ContentWidth    int
	ContentHeight   int
	LineNumberWidth int
}

const highlightPaddingX = 1

var (
	// The macro alternative deliberately stops at the "(" — the args span may
	// contain nested parens (`@pick(x: @i(key))`), which RE2 cannot match, so
	// HighlightLine finds the closing paren with balancedParenEnd instead.
	syntaxPattern        = regexp.MustCompile(`(@)(i|f|env|joint|pick|run)\(|->|\b(true|false|null)\b|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|-?\d+(?:\.\d+)?|//.*$|[{}\[\],:]`)
	macroArgsPattern     = regexp.MustCompile(`\bor\b|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(true|false)\b|-?\d+(?:\.\d+)?`)
	stringMacroPattern   = regexp.MustCompile(`(@)(i)(\([A-Za-z][A-Za-z0-9_-]*\))`)
	keywordPattern       = regexp.MustCompile(`^(\s*)(ref|url|type|header|authorization|auth|body)\b`)
	graphqlStartPattern  = regexp.MustCompile(`^\s*(query|mutation)\s*:\s*(?:"|$)`)
	graphqlSugarStart    = regexp.MustCompile(`^\s*(query|mutation)\b`)
	afterWhitespaceColon = regexp.MustCompile(`^\s*:`)
	graphqlStringStart   = regexp.MustCompile(`^\s*"`)
	graphqlSyntaxPattern = regexp.MustCompile(`#.*$|"(?:\\.|[^"\\])*"|\$[A-Za-z_][A-Za-z0-9_]*|@[A-Za-z_][A-Za-z0-9_]*|\b(query|mutation|subscription|fragment|on|true|false|null)\b|-?\d+(?:\.\d+)?|[!$():=@{}\[\],|]`)
	leadingDigit         = regexp.MustCompile(`^-?\d`)
	// @pick args: nested macro start | pair key with colon | json path |
	// quoted strings | punctuation. The key alternative precedes the json-path
	// one so `userId:` wins over a bare-path match at the same position.
	pickArgsPattern = regexp.MustCompile(`(@)(i|env)\(|([A-Za-z][A-Za-z0-9_-]*)\s*:|[A-Za-z][A-Za-z0-9_-]*(?:\[\d+\])*(?:\.[A-Za-z][A-Za-z0-9_-]*(?:\[\d+\])*)*|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|[,()]`)
	// Value coloring after the `type` / `ref` keywords and for `key:` lines.
	typeMethodPattern = regexp.MustCompile("^(\\s+)([A-Za-z!#$%&'*+.^_`|~-]+)")
	refPathPattern    = regexp.MustCompile(`^(\s+)([A-Za-z0-9/._-]+)`)
	keyPattern        = regexp.MustCompile(`^(\s*)([A-Za-z][A-Za-z0-9_-]*)(\s*)(:)`)
	runPathPattern    = regexp.MustCompile(`^[A-Za-z0-9/._-]+$`)
)

// balancedParenEnd returns the index just past the ")" that closes the "(" at
// open, skipping quoted strings ("…" and '…' with \-escapes). Returns
// len(line) when the parens are unterminated (e.g. mid-typing in edit mode).
func balancedParenEnd(line string, open int) int {
	depth := 0
	for i := open; i < len(line); i++ {
		switch line[i] {
		case '"', '\'':
			quote := line[i]
			for i++; i < len(line); i++ {
				if line[i] == '\\' {
					i++
					continue
				}
				if line[i] == quote {
					break
				}
			}
		case '(':
			depth++
		case ')':
			depth--
			if depth == 0 {
				return i + 1
			}
		}
	}
	return len(line)
}

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
		case strings.HasPrefix(token, `"`) || strings.HasPrefix(token, "'"):
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

// highlightRunArgs colors an @run args span (parens included): the file path
// is a string-like target, so it renders yellow like ref paths.
func highlightRunArgs(args string) []HighlightSegment {
	var segments []HighlightSegment
	inner := args
	closed := false

	if strings.HasPrefix(inner, "(") {
		segments = append(segments, HighlightSegment{Text: "(", Color: "gray"})
		inner = inner[1:]
	}
	if strings.HasSuffix(inner, ")") {
		closed = true
		inner = inner[:len(inner)-1]
	}
	if inner != "" {
		if runPathPattern.MatchString(inner) {
			segments = append(segments, HighlightSegment{Text: inner, Color: "yellow"})
		} else {
			segments = append(segments, HighlightSegment{Text: inner})
		}
	}
	if closed {
		segments = append(segments, HighlightSegment{Text: ")", Color: "gray"})
	}
	return segments
}

// highlightPickArgs colors an @pick args span (parens included): pair keys
// cyan, json paths into the previous response blue, nested @i/@env macros with
// the usual macro colors, strings yellow, punctuation gray.
func highlightPickArgs(args string) []HighlightSegment {
	var segments []HighlightSegment
	cursor := 0
	for _, m := range pickArgsPattern.FindAllStringSubmatchIndex(args, -1) {
		start, end := m[0], m[1]
		if start < cursor {
			continue
		}
		if start > cursor {
			segments = append(segments, HighlightSegment{Text: args[cursor:start]})
		}
		token := args[start:end]
		switch {
		case m[2] != -1: // nested (@)(i|env)( macro; args found by balanced scan
			argsEnd := balancedParenEnd(args, end-1)
			segments = append(segments, HighlightSegment{Text: args[m[2]:m[3]], Color: "red", Bold: true})
			segments = append(segments, HighlightSegment{Text: args[m[4]:m[5]], Color: "green", Bold: true})
			segments = append(segments, highlightMacroArgs(args[end-1:argsEnd])...)
			cursor = argsEnd
			continue
		case m[6] != -1: // pair key + colon
			segments = append(segments, HighlightSegment{Text: args[m[6]:m[7]], Color: "cyan"})
			if gap := args[m[7] : end-1]; gap != "" {
				segments = append(segments, HighlightSegment{Text: gap})
			}
			segments = append(segments, HighlightSegment{Text: ":", Color: "gray"})
		case strings.HasPrefix(token, `"`) || strings.HasPrefix(token, "'"):
			segments = append(segments, HighlightSegment{Text: token, Color: "yellow"})
		case token == "," || token == "(" || token == ")":
			segments = append(segments, HighlightSegment{Text: token, Color: "gray"})
		default: // json path
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
	cursor := 0

	// keywordPattern groups: 1 = leading whitespace, 2 = the keyword. A keyword
	// followed by ":" is a .ntd/body entry key (e.g. `type: foo`), not a
	// request statement — leave it to the key handling below.
	km := keywordPattern.FindStringSubmatchIndex(line)
	if km != nil && afterWhitespaceColon.MatchString(line[km[5]:]) {
		km = nil
	}

	switch {
	case km != nil:
		keywordStart, keywordEnd := km[4], km[5]
		keyword := line[keywordStart:keywordEnd]
		if keywordStart > 0 {
			segments = append(segments, HighlightSegment{Text: line[:keywordStart]})
		}
		segments = append(segments, HighlightSegment{Text: keyword, Color: "cyan", Bold: true})
		cursor = keywordEnd

		// The value after `type` is an HTTP method, after `ref` a file path —
		// both deserve their own color.
		switch keyword {
		case "type":
			if tm := typeMethodPattern.FindStringSubmatchIndex(line[cursor:]); tm != nil {
				segments = append(segments, HighlightSegment{Text: line[cursor+tm[2] : cursor+tm[3]]})
				segments = append(segments, HighlightSegment{Text: line[cursor+tm[4] : cursor+tm[5]], Color: "magenta", Bold: true})
				cursor += tm[1]
			}
		case "ref":
			if rm := refPathPattern.FindStringSubmatchIndex(line[cursor:]); rm != nil {
				segments = append(segments, HighlightSegment{Text: line[cursor+rm[2] : cursor+rm[3]]})
				segments = append(segments, HighlightSegment{Text: line[cursor+rm[4] : cursor+rm[5]], Color: "yellow"})
				cursor += rm[1]
			}
		}
	default:
		// Object-key lines (`userId: 4` in .ntd files and body objects).
		if pm := keyPattern.FindStringSubmatchIndex(line); pm != nil {
			if pm[2] != pm[3] {
				segments = append(segments, HighlightSegment{Text: line[pm[2]:pm[3]]})
			}
			segments = append(segments, HighlightSegment{Text: line[pm[4]:pm[5]], Color: "cyan"})
			if pm[6] != pm[7] {
				segments = append(segments, HighlightSegment{Text: line[pm[6]:pm[7]]})
			}
			segments = append(segments, HighlightSegment{Text: ":", Color: "gray"})
			cursor = pm[1]
		}
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
		case m[2] != -1: // (@)(action)( — args span found by balanced scan
			action := line[m[4]:m[5]]
			argsEnd := balancedParenEnd(line, end-1)
			segments = append(segments, HighlightSegment{Text: line[m[2]:m[3]], Color: "red", Bold: true})
			segments = append(segments, HighlightSegment{Text: action, Color: "green", Bold: true})
			switch action {
			case "pick":
				segments = append(segments, highlightPickArgs(line[end-1:argsEnd])...)
			case "run":
				segments = append(segments, highlightRunArgs(line[end-1:argsEnd])...)
			default:
				segments = append(segments, highlightMacroArgs(line[end-1:argsEnd])...)
			}
			cursor = argsEnd
			continue
		case m[6] != -1: // true/false/null
			segments = append(segments, HighlightSegment{Text: token, Color: "magenta"})
		case token == "->":
			segments = append(segments, HighlightSegment{Text: token, Color: "cyan", Bold: true})
		case strings.HasPrefix(token, `"`):
			segments = append(segments, highlightString(token)...)
		case strings.HasPrefix(token, "'"):
			segments = append(segments, HighlightSegment{Text: token, Color: "yellow"})
		case strings.HasPrefix(token, "//"):
			segments = append(segments, HighlightSegment{Text: token, DimColor: true})
		case len(token) == 1 && strings.ContainsAny(token, "{}[],:"):
			segments = append(segments, HighlightSegment{Text: token, Color: "gray"})
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
