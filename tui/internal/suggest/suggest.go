// Package suggest ports src/runtime/editor-suggestions: the edit-mode completion
// items (keywords, headers, macros, custom, referenced-definition keys, and ref
// path completion). Go-local: it reads .ntd files and directories directly. No
// ohm — definition keys and ref lines are matched with plain regex, as in TS.
package suggest

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
)

// Item mirrors editor-suggestions EditorSuggestionItem. CursorOffset 0 means
// "place the cursor at the end of InsertText".
type Item struct {
	Label        string
	InsertText   string
	CursorOffset int
	Kind         string
}

var keywordSuggestions = func() []Item {
	keywords := []string{"ref", "url", "type", "header", "authorization", "auth", "body"}
	items := make([]Item, 0, len(keywords))
	for _, k := range keywords {
		items = append(items, Item{Label: k, InsertText: k + " ", Kind: "keyword"})
	}
	return items
}()

var macroSuggestions = []Item{
	{Label: "@i", InsertText: "@i()", CursorOffset: 3, Kind: "macro"},
	{Label: "@f", InsertText: "@f()", CursorOffset: 3, Kind: "macro"},
	{Label: "@env", InsertText: "@env()", CursorOffset: 5, Kind: "macro"},
}

var headerSuggestions = func() []Item {
	headers := []string{
		"accept", "accept-encoding", "accept-language", "authorization",
		"cache-control", "content-encoding", "content-language", "content-length",
		"content-type", "cookie", "if-match", "if-modified-since", "if-none-match",
		"if-unmodified-since", "origin", "prefer", "range", "referer", "user-agent",
		"x-api-key", "x-correlation-id", "x-csrf-token", "x-forwarded-for",
		"x-forwarded-host", "x-forwarded-proto", "x-idempotency-key", "x-request-id",
	}
	items := make([]Item, 0, len(headers))
	for _, h := range headers {
		items = append(items, Item{Label: h, InsertText: h + ", ", Kind: "header"})
	}
	return items
}()

func buildCustomSuggestionItems(custom []string) []Item {
	seen := map[string]bool{}
	var items []Item
	for _, c := range custom {
		if seen[c] {
			continue
		}
		seen[c] = true
		items = append(items,
			Item{Label: c, InsertText: c + ", ", Kind: "header"},
			Item{Label: c, InsertText: c + ": ", Kind: "bodyKey"},
		)
	}
	return items
}

var (
	refLinePattern = regexp.MustCompile(`^\s*ref\s+([^\s]+\.ntd)\b`)
	defKeyPattern  = regexp.MustCompile(`^\s*([A-Za-z][A-Za-z0-9_-]*)\s*:`)
)

type cachedDefinition struct {
	mtime int64
	keys  []string
}

var (
	defCacheMu sync.Mutex
	defCache   = map[string]cachedDefinition{}
)

func parseDefinitionKeys(content string) []string {
	seen := map[string]bool{}
	var keys []string
	for _, line := range strings.Split(content, "\n") {
		if m := defKeyPattern.FindStringSubmatch(line); m != nil && !seen[m[1]] {
			seen[m[1]] = true
			keys = append(keys, m[1])
		}
	}
	return keys
}

func readDefinitionKeys(path string) []string {
	info, err := os.Stat(path)
	if err != nil {
		return nil
	}
	mtime := info.ModTime().UnixNano()

	defCacheMu.Lock()
	cached, ok := defCache[path]
	defCacheMu.Unlock()
	if ok && cached.mtime == mtime {
		return cached.keys
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	keys := parseDefinitionKeys(string(data))

	defCacheMu.Lock()
	defCache[path] = cachedDefinition{mtime: mtime, keys: keys}
	defCacheMu.Unlock()
	return keys
}

// referencedDefinitionKeys collects keys from every .ntd referenced by the
// request content, resolved relative to the request file. Sorted, unique.
func referencedDefinitionKeys(requestPath, content string) []string {
	dir := filepath.Dir(requestPath)
	seen := map[string]bool{}
	var keys []string
	for _, line := range strings.Split(content, "\n") {
		m := refLinePattern.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		for _, key := range readDefinitionKeys(filepath.Join(dir, m[1])) {
			if !seen[key] {
				seen[key] = true
				keys = append(keys, key)
			}
		}
	}
	sort.Strings(keys)
	return keys
}

// BuildEditorSuggestionItems assembles the full suggestion set for editing a
// request. Mirrors buildEditorSuggestionItems.
func BuildEditorSuggestionItems(requestPath, content string, custom []string) []Item {
	var defKeys []string
	if requestPath != "" {
		defKeys = referencedDefinitionKeys(requestPath, content)
	}

	var defMacros, defs []Item
	for _, key := range defKeys {
		defs = append(defs, Item{Label: key, InsertText: key, Kind: "definition"})
		defMacros = append(defMacros, Item{Label: "@i(" + key + ")", InsertText: "@i(" + key + ")", Kind: "macro"})
	}

	items := make([]Item, 0)
	items = append(items, keywordSuggestions...)
	items = append(items, headerSuggestions...)
	items = append(items, buildCustomSuggestionItems(custom)...)
	items = append(items, macroSuggestions...)
	items = append(items, defMacros...)
	items = append(items, defs...)
	return items
}

const maxRefSuggestionItems = 50

var skippedRefFragments = map[string]bool{".": true, "..": true, "/": true}

// BuildRefSuggestionItems completes a `ref <fragment>` path with matching .ntd
// files and directories under the request's directory. Mirrors
// buildRefSuggestionItems.
func BuildRefSuggestionItems(requestPath, fragment string) []Item {
	if fragment == "" || skippedRefFragments[fragment] || strings.HasSuffix(fragment, ".ntd") {
		return nil
	}

	requestDir := filepath.Dir(requestPath)
	normalized := strings.ReplaceAll(fragment, "\\", "/")

	var fragmentDir, fragmentBase string
	if strings.HasSuffix(normalized, "/") {
		fragmentDir = normalized
		fragmentBase = ""
	} else {
		fragmentDir = pathDir(normalized)
		fragmentBase = pathBase(normalized)
	}

	searchDir := requestDir
	if fragmentDir != "." {
		searchDir = filepath.Join(requestDir, fragmentDir)
	}

	entries, err := os.ReadDir(searchDir)
	if err != nil {
		return nil
	}

	var items []Item
	for _, entry := range entries {
		name := entry.Name()
		isDirMatch := entry.IsDir() && strings.HasPrefix(name, fragmentBase)
		isNtdMatch := entry.Type().IsRegular() && strings.HasSuffix(name, ".ntd") && strings.HasPrefix(name, fragmentBase)
		if !isDirMatch && !isNtdMatch {
			continue
		}

		entryPath := filepath.Join(searchDir, name)
		refPath := toRequestRelative(requestDir, entryPath)
		if isDirMatch {
			refPath += "/"
		}
		items = append(items, Item{Label: refPath, InsertText: refPath, Kind: "ref"})
		if len(items) >= maxRefSuggestionItems {
			break
		}
	}

	sort.Slice(items, func(a, b int) bool { return items[a].Label < items[b].Label })
	if len(items) > maxRefSuggestionItems {
		items = items[:maxRefSuggestionItems]
	}
	return items
}

func toRequestRelative(requestDir, target string) string {
	rel, err := filepath.Rel(requestDir, target)
	if err != nil {
		return target
	}
	return filepath.ToSlash(rel)
}

// pathDir/pathBase operate on the normalized (forward-slash) fragment.
func pathDir(p string) string {
	if i := strings.LastIndex(p, "/"); i >= 0 {
		if i == 0 {
			return "/"
		}
		return p[:i]
	}
	return "."
}

func pathBase(p string) string {
	if i := strings.LastIndex(p, "/"); i >= 0 {
		return p[i+1:]
	}
	return p
}
