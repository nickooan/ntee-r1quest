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

// macroSuggestions are the macros legal in a request .nts file. @env is not
// here — it only resolves in .ntd definition files (a compile error in .nts);
// see BuildDefinitionSuggestionItems. @joint bootstraps a fresh chain file:
// once accepted, the buffer detects as joint and the pool swaps to
// BuildJointSuggestionItems.
var macroSuggestions = []Item{
	{Label: "@i", InsertText: "@i()", CursorOffset: 3, Kind: "macro"},
	{Label: "@f", InsertText: "@f()", CursorOffset: 3, Kind: "macro"},
	{Label: "@joint", InsertText: "@joint()", CursorOffset: 7, Kind: "macro"},
}

// jointMacroSuggestions are the macros legal in a joint chain file: the chain
// declaration and steps, plus @i for context picks. @f/@env are invalid there
// (a PickSource is an @i macro or a json path).
var jointMacroSuggestions = []Item{
	{Label: "@joint", InsertText: "@joint()", CursorOffset: 7, Kind: "macro"},
	{Label: "@pick", InsertText: "@pick()", CursorOffset: 6, Kind: "macro"},
	{Label: "@run", InsertText: "@run()", CursorOffset: 5, Kind: "macro"},
	{Label: "@i", InsertText: "@i()", CursorOffset: 3, Kind: "macro"},
}

// JointStepSuggestions are offered when a joint-file line holds only "-"/"->"
// so far; the cursor offsets land inside the parens.
var JointStepSuggestions = []Item{
	{Label: "-> @run()", InsertText: "-> @run()", CursorOffset: 8, Kind: "step"},
	{Label: "-> @pick()", InsertText: "-> @pick()", CursorOffset: 9, Kind: "step"},
}

// IsJointContent reports whether the buffer is a joint chain file: its first
// significant statement (skipping blank lines, // comments, and ref lines)
// starts the @joint declaration or a -> step.
func IsJointContent(content string) bool {
	for _, line := range strings.Split(content, "\n") {
		t := strings.TrimSpace(line)
		if t == "" || strings.HasPrefix(t, "//") ||
			t == "ref" || strings.HasPrefix(t, "ref ") {
			continue
		}
		return strings.HasPrefix(t, "@joint(") || strings.HasPrefix(t, "->")
	}
	return false
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

// headerValueSuggestions maps a (lowercased) header name to its most common
// values, offered when the cursor is in the value position of a `header <name>,`
// line. Ordered most-common-first so the default match sits at the top.
var headerValueSuggestions = map[string][]string{
	"content-type": {
		"application/json",
		"application/json; charset=utf-8",
		"application/x-www-form-urlencoded",
		"multipart/form-data",
		"text/plain",
		"text/plain; charset=utf-8",
		"text/html",
		"application/xml",
		"application/octet-stream",
		"application/graphql",
	},
	"accept": {
		"application/json",
		"application/json, text/plain, */*",
		"*/*",
		"text/html",
		"application/xml",
	},
	"accept-encoding":  {"gzip, deflate, br", "gzip", "identity"},
	"content-encoding": {"gzip", "br", "deflate"},
	"accept-language":  {"en-US,en;q=0.9", "en", "*"},
	"cache-control": {
		"no-cache",
		"no-store",
		"no-cache, no-store, must-revalidate",
		"max-age=0",
		"max-age=3600",
		"must-revalidate",
		"public",
		"private",
	},
	"connection": {"keep-alive", "close"},
	"authorization": {
		"Bearer ",
		"Basic ",
		"Digest ",
		"Token ",
		"ApiKey ",
		"AWS4-HMAC-SHA256 ",
		"Negotiate ",
		"NTLM ",
	},
	"proxy-authorization": {"Basic ", "Bearer ", "Negotiate ", "NTLM "},
	"prefer":              {"return=representation", "return=minimal", "respond-async"},
	"x-requested-with":    {"XMLHttpRequest"},
}

// BuildHeaderValueSuggestionItems returns the common values for headerName whose
// (case-insensitive) text begins with fragment (the value typed so far). Empty
// fragment lists all values for the header; an unknown header returns nil.
func BuildHeaderValueSuggestionItems(headerName, fragment string) []Item {
	values, ok := headerValueSuggestions[strings.ToLower(strings.TrimSpace(headerName))]
	if !ok {
		return nil
	}
	lower := strings.ToLower(fragment)
	var items []Item
	for _, v := range values {
		if lower == "" || strings.HasPrefix(strings.ToLower(v), lower) {
			items = append(items, Item{Label: v, InsertText: v, Kind: "headerValue"})
		}
	}
	return items
}

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

// FindDefinitionKeyLine returns the 0-based index of the LAST line defining
// key (`key: ...`) — at runtime later duplicate entries override earlier ones,
// so the last definition is the one in effect. Returns -1 when absent.
func FindDefinitionKeyLine(content, key string) int {
	found := -1
	for i, line := range strings.Split(content, "\n") {
		if m := defKeyPattern.FindStringSubmatch(line); m != nil && m[1] == key {
			found = i
		}
	}
	return found
}

// ResolveKeyDefinition locates the definition of an @i key that wins at
// runtime: the buffer's ref lines merge in order with later files overriding
// earlier ones, so the LAST ref'd .ntd defining the key is returned, with the
// 0-based line of its winning entry. The returned path is absolute. Files are
// read directly (the definition cache stores key names only; .ntd files are
// tiny). ok=false when no readable ref defines the key.
func ResolveKeyDefinition(requestPath, content, key string) (ntdPath string, line int, ok bool) {
	dir := filepath.Dir(requestPath)
	for _, bufferLine := range strings.Split(content, "\n") {
		m := refLinePattern.FindStringSubmatch(bufferLine)
		if m == nil {
			continue
		}
		path := filepath.Join(dir, m[1])
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		if keyLine := FindDefinitionKeyLine(string(data), key); keyLine >= 0 {
			ntdPath, line, ok = path, keyLine, true
		}
	}
	return ntdPath, line, ok
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

// BuildJointSuggestionItems is the word-path pool for joint chain buffers,
// replacing BuildEditorSuggestionItems there — request statements
// (url/type/header/auth/body) and header names cannot parse in a joint file.
// Referenced-definition keys still apply (refs are legal before @joint).
func BuildJointSuggestionItems(requestPath, content string) []Item {
	var defKeys []string
	if requestPath != "" {
		defKeys = referencedDefinitionKeys(requestPath, content)
	}

	items := make([]Item, 0, 5+2*len(defKeys))
	items = append(items, Item{Label: "ref", InsertText: "ref ", Kind: "keyword"})
	items = append(items, jointMacroSuggestions...)
	for _, key := range defKeys {
		items = append(items, Item{Label: "@i(" + key + ")", InsertText: "@i(" + key + ")", Kind: "macro"})
	}
	for _, key := range defKeys {
		items = append(items, Item{Label: key, InsertText: key, Kind: "definition"})
	}
	return items
}

// BuildDefinitionSuggestionItems is the word-path pool for .ntd definition
// buffers: custom keys as entry scaffolds plus the @env macro — request
// keywords, headers, @i and @f are invalid in definition files.
func BuildDefinitionSuggestionItems(custom []string) []Item {
	items := []Item{{Label: "@env", InsertText: "@env()", CursorOffset: 5, Kind: "macro"}}
	seen := map[string]bool{}
	for _, c := range custom {
		if seen[c] {
			continue
		}
		seen[c] = true
		items = append(items, Item{Label: c, InsertText: c + ": ", Kind: "bodyKey"})
	}
	return items
}

// httpMethodSuggestions is ordered by usage so the common methods sit first.
var httpMethodSuggestions = []string{
	"get", "post", "put", "patch", "delete", "head", "options", "trace", "connect",
}

// BuildTypeSuggestionItems returns the HTTP methods whose name begins with
// fragment (case-insensitive); empty fragment lists all.
func BuildTypeSuggestionItems(fragment string) []Item {
	lower := strings.ToLower(fragment)
	var items []Item
	for _, method := range httpMethodSuggestions {
		if lower == "" || strings.HasPrefix(method, lower) {
			items = append(items, Item{Label: method, InsertText: method, Kind: "httpMethod"})
		}
	}
	return items
}

var authSchemeSuggestions = []string{"bearer", "basic"}

// BuildAuthSchemeSuggestionItems returns the auth schemes matching fragment
// (case-insensitive prefix); the inserted text ends with a space so the
// credentials follow directly.
func BuildAuthSchemeSuggestionItems(fragment string) []Item {
	lower := strings.ToLower(fragment)
	var items []Item
	for _, scheme := range authSchemeSuggestions {
		if lower == "" || strings.HasPrefix(scheme, lower) {
			items = append(items, Item{Label: scheme, InsertText: scheme + " ", Kind: "authScheme"})
		}
	}
	return items
}

const maxRefSuggestionItems = 50

var skippedRefFragments = map[string]bool{".": true, "..": true, "/": true}

// pathOpts parameterizes buildPathSuggestionItems for the ref/@run/@f path
// completers, which differ only in which files they offer and how the emitted
// path is shaped.
type pathOpts struct {
	// fileMatch selects the regular files to offer; directories are always
	// offered (with a trailing "/") so the user can navigate into them.
	fileMatch func(name string) bool
	// exclude omits one absolute path (the open file itself); "" = none.
	exclude string
	// stripSuffix is trimmed from emitted file paths (".nts" for @run, whose
	// convention omits the extension).
	stripSuffix string
	// doneSuffix: a fragment already ending with it is complete — return nil.
	doneSuffix string
	// allowEmpty lists the request directory on an empty fragment.
	allowEmpty bool
	kind       string
}

// buildPathSuggestionItems completes a path fragment with matching files and
// directories under the request's directory. Shared core of the ref/@run/@f
// completers; preserves the original ref semantics (cap, dir slashes,
// request-relative forward-slashed paths).
func buildPathSuggestionItems(requestPath, fragment string, opts pathOpts) []Item {
	if fragment == "" && !opts.allowEmpty {
		return nil
	}
	if skippedRefFragments[fragment] ||
		(opts.doneSuffix != "" && strings.HasSuffix(fragment, opts.doneSuffix)) {
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
		isFileMatch := entry.Type().IsRegular() && opts.fileMatch(name) && strings.HasPrefix(name, fragmentBase)
		if !isDirMatch && !isFileMatch {
			continue
		}

		entryPath := filepath.Join(searchDir, name)
		if opts.exclude != "" && filepath.Clean(entryPath) == filepath.Clean(opts.exclude) {
			continue
		}
		relPath := toRequestRelative(requestDir, entryPath)
		if isDirMatch {
			relPath += "/"
		} else if opts.stripSuffix != "" {
			relPath = strings.TrimSuffix(relPath, opts.stripSuffix)
		}
		items = append(items, Item{Label: relPath, InsertText: relPath, Kind: opts.kind})
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

// BuildRefSuggestionItems completes a `ref <fragment>` path with matching .ntd
// files and directories under the request's directory. Mirrors
// buildRefSuggestionItems.
func BuildRefSuggestionItems(requestPath, fragment string) []Item {
	if fragment == "" {
		return nil
	}
	return buildPathSuggestionItems(requestPath, fragment, pathOpts{
		fileMatch:  func(name string) bool { return strings.HasSuffix(name, ".ntd") },
		doneSuffix: ".ntd",
		kind:       "ref",
	})
}

// BuildRunSuggestionItems completes an `@run(<fragment>` target with sibling
// .nts scripts (extension stripped, matching convention — the runtime appends
// it) and directories, excluding the open joint file itself. An empty fragment
// lists the request directory, so accepting `@run()` immediately offers the
// available scripts.
func BuildRunSuggestionItems(requestPath, fragment string) []Item {
	return buildPathSuggestionItems(requestPath, fragment, pathOpts{
		fileMatch:   func(name string) bool { return strings.HasSuffix(name, ".nts") },
		exclude:     requestPath,
		stripSuffix: ".nts",
		doneSuffix:  ".nts",
		allowEmpty:  true,
		kind:        "run",
	})
}

// BuildFileSuggestionItems completes an `@f(<fragment>` upload path with any
// regular file (extension kept) and directories, excluding the open file.
func BuildFileSuggestionItems(requestPath, fragment string) []Item {
	return buildPathSuggestionItems(requestPath, fragment, pathOpts{
		fileMatch:  func(string) bool { return true },
		exclude:    requestPath,
		allowEmpty: true,
		kind:       "file",
	})
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
