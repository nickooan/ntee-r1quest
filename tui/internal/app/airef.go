package app

import (
	"path/filepath"
	"sort"
	"strings"
	"unicode"

	"codeberg.org/nickoan/ntee-r1quest/tui/internal/filetree"
	"codeberg.org/nickoan/ntee-r1quest/tui/internal/input"
	"codeberg.org/nickoan/ntee-r1quest/tui/internal/runtime"
)

// maxAiRefSuggestions caps the #reference popup.
const maxAiRefSuggestions = 8

// parseRefToken finds the standalone `#keyword` token containing the cursor.
// The `#` must be at start-of-input or preceded by whitespace (so `abc#x`
// never triggers), must be followed by at least one non-space rune (so `# x`
// never triggers), and the token ends at the next whitespace or end-of-input.
// start/end are rune indices spanning "#keyword"; the token is active only
// while start < cursor <= end, i.e. while the cursor sits inside it.
func parseRefToken(text string, cursor int) (keyword string, start, end int, ok bool) {
	runes := []rune(text)
	if cursor < 0 || cursor > len(runes) {
		return "", 0, 0, false
	}

	// Walk back to the token start (nearest whitespace boundary).
	start = cursor
	for start > 0 && !unicode.IsSpace(runes[start-1]) {
		start--
	}
	if start >= len(runes) || runes[start] != '#' {
		return "", 0, 0, false
	}

	end = cursor
	for end < len(runes) && !unicode.IsSpace(runes[end]) {
		end++
	}
	if end == start+1 { // bare "#"
		return "", 0, 0, false
	}
	if cursor <= start { // cursor before the '#'
		return "", 0, 0, false
	}
	return string(runes[start+1 : end]), start, end, true
}

// aiRefState is everything the key handler and renderer need for the popup.
type aiRefState struct {
	token      string // full "#keyword" text, compared against aiRefDismissed
	start, end int    // rune span of the token in aiInput
	matches    []filetree.FileTreeEntry
}

// activeAiRef reports the #reference popup state: false when no token is under
// the cursor, the token was Esc-dismissed, or nothing matches. Unlike the
// query popup this searches the whole corpus — directories, .nts and .ntd.
func (m Model) activeAiRef() (aiRefState, bool) {
	keyword, start, end, ok := parseRefToken(m.aiInput, m.aiInputCursor)
	if !ok {
		return aiRefState{}, false
	}
	token := "#" + keyword
	if token == m.aiRefDismissed {
		return aiRefState{}, false
	}
	matches := filetree.FuzzyMatchEntries(filetree.BuildAllEntries(m.config.Root), keyword)
	if len(matches) == 0 {
		return aiRefState{}, false
	}
	if len(matches) > maxAiRefSuggestions {
		matches = matches[:maxAiRefSuggestions]
	}
	return aiRefState{token: token, start: start, end: end, matches: matches}, true
}

// acceptAiRef replaces the token span with a "[label] " pill and records the
// label → absolute-path mapping expanded at send time.
func (m *Model) acceptAiRef(ref aiRefState) {
	entry := ref.matches[input.Clamp(m.aiRefSuggestIndex, 0, len(ref.matches)-1)]

	rootAbs, err := filepath.Abs(m.config.Root)
	if err != nil {
		rootAbs = m.config.Root
	}
	absPath := filepath.Join(rootAbs, filepath.FromSlash(entry.RelativePath))

	label := strings.TrimSuffix(entry.Name, "/")
	if existing, ok := m.aiRefs[label]; ok && existing != absPath {
		// Same name elsewhere in the tree — disambiguate with the relative path.
		label = entry.RelativePath
	}

	pill := "[" + label + "] "
	runes := []rune(m.aiInput)
	m.aiInput = string(runes[:ref.start]) + pill + string(runes[ref.end:])
	m.aiInputCursor = ref.start + len([]rune(pill))

	if m.aiRefs == nil {
		m.aiRefs = map[string]string{}
	}
	m.aiRefs[label] = absPath
	m.aiRefDismissed = ""
	m.aiRefSuggestIndex = 0
}

// collectAiRefs returns the file references whose "[label]" pill still appears
// in text, as resource_link attachments (name = the file/dir base name, path =
// absolute). Refs whose pill was deleted from the input are dropped. Order
// follows first appearance in the text so the attachments track the prose.
func collectAiRefs(text string, refs map[string]string) []runtime.AiPromptFileRef {
	type placed struct {
		at  int
		ref runtime.AiPromptFileRef
	}
	var found []placed
	for label, path := range refs {
		at := strings.Index(text, "["+label+"]")
		if at < 0 {
			continue
		}
		found = append(found, placed{at: at, ref: runtime.AiPromptFileRef{
			Name: filepath.Base(path),
			Path: path,
		}})
	}
	sort.Slice(found, func(i, j int) bool { return found[i].at < found[j].at })

	out := make([]runtime.AiPromptFileRef, len(found))
	for i, f := range found {
		out[i] = f.ref
	}
	return out
}

// clearAiRefs resets all #reference state (after a send or session reset).
func (m *Model) clearAiRefs() {
	m.aiRefs = nil
	m.aiRefSuggestIndex = 0
	m.aiRefDismissed = ""
}
