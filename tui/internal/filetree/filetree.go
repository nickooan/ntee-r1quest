// Package filetree ports src/runtime/file-manager: the request-tree sidebar
// model. It is a presentation-time filesystem read owned by the Go TUI (the TS
// runtime never serves the tree). Directory listings are cached by mtime, as in
// the TS version, since the tree rebuilds on every path keystroke.
package filetree

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// FileTreeEntry mirrors file-manager/types.ts FileTreeEntry.
type FileTreeEntry struct {
	Name         string
	RelativePath string
	CommandValue string
	Depth        int
	Type         string // "directory" | "request" | "file"
	IsExpanded   bool
}

type dirChild struct {
	name   string
	isDir  bool
	isFile bool
}

type cachedDir struct {
	mtime   time.Time
	entries []dirChild
}

var (
	dirCacheMu sync.Mutex
	dirCache   = map[string]cachedDir{}
)

func readDirectorySorted(path string) ([]dirChild, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}

	dirCacheMu.Lock()
	cached, ok := dirCache[path]
	dirCacheMu.Unlock()
	if ok && cached.mtime.Equal(info.ModTime()) {
		return cached.entries, nil
	}

	raw, err := os.ReadDir(path)
	if err != nil {
		return nil, err
	}

	entries := make([]dirChild, 0, len(raw))
	for _, e := range raw {
		entries = append(entries, dirChild{
			name:   e.Name(),
			isDir:  e.IsDir(),
			isFile: e.Type().IsRegular(),
		})
	}
	// Directories first, then by name.
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].isDir != entries[j].isDir {
			return entries[i].isDir
		}
		return entries[i].name < entries[j].name
	})

	dirCacheMu.Lock()
	dirCache[path] = cachedDir{mtime: info.ModTime(), entries: entries}
	dirCacheMu.Unlock()
	return entries, nil
}

func isInsideRoot(root, target string) bool {
	rel, err := filepath.Rel(root, target)
	if err != nil {
		return false
	}
	return rel == "." || (!strings.HasPrefix(rel, "..") && !filepath.IsAbs(rel))
}

// BuildFileTreeEntries walks the root, expanding directories whose paths are in
// expanded. Mirrors buildFileTreeEntries.
func BuildFileTreeEntries(root string, expanded map[string]bool) []FileTreeEntry {
	if root == "" {
		return nil
	}
	resolvedRoot, err := filepath.Abs(root)
	if err != nil {
		return nil
	}

	var entries []FileTreeEntry
	var appendDir func(dirPath string, depth int)
	appendDir = func(dirPath string, depth int) {
		resolvedDir := filepath.Join(resolvedRoot, dirPath)
		if !isInsideRoot(resolvedRoot, resolvedDir) {
			return
		}
		children, err := readDirectorySorted(resolvedDir)
		if err != nil {
			return
		}

		for _, child := range children {
			rel := child.name
			if dirPath != "" {
				rel = dirPath + "/" + child.name
			}

			if child.isDir {
				isExpanded := expanded[rel]
				entries = append(entries, FileTreeEntry{
					Name:         child.name,
					RelativePath: rel,
					CommandValue: rel + "/",
					Depth:        depth,
					Type:         "directory",
					IsExpanded:   isExpanded,
				})
				if isExpanded {
					appendDir(rel, depth+1)
				}
				continue
			}

			if !child.isFile {
				continue
			}

			isRequest := strings.HasSuffix(child.name, ".nts")
			command := rel
			entryType := "file"
			if isRequest {
				command = strings.TrimSuffix(rel, ".nts")
				entryType = "request"
			}
			entries = append(entries, FileTreeEntry{
				Name:         child.name,
				RelativePath: rel,
				CommandValue: command,
				Depth:        depth,
				Type:         entryType,
			})
		}
	}

	appendDir("", 0)
	return entries
}

// maxScanDepth bounds the BuildAllEntries walk (symlink-loop guard).
const maxScanDepth = 16

// BuildAllEntries walks the whole root regardless of expansion state and
// returns every directory, .nts ("request") and .ntd ("file") entry. This is
// the fuzzy-search corpus: the query popup filters it to requests, while the
// AI-mode #reference search uses all of it. Fuzzy matching must find entries
// inside collapsed directories, hence the full walk.
func BuildAllEntries(root string) []FileTreeEntry {
	if root == "" {
		return nil
	}
	resolvedRoot, err := filepath.Abs(root)
	if err != nil {
		return nil
	}

	var entries []FileTreeEntry
	var appendDir func(dirPath string, depth int)
	appendDir = func(dirPath string, depth int) {
		if depth > maxScanDepth {
			return
		}
		resolvedDir := filepath.Join(resolvedRoot, dirPath)
		if !isInsideRoot(resolvedRoot, resolvedDir) {
			return
		}
		children, err := readDirectorySorted(resolvedDir)
		if err != nil {
			return
		}

		for _, child := range children {
			rel := child.name
			if dirPath != "" {
				rel = dirPath + "/" + child.name
			}

			if child.isDir {
				entries = append(entries, FileTreeEntry{
					Name:         child.name,
					RelativePath: rel,
					CommandValue: rel + "/",
					Depth:        depth,
					Type:         "directory",
				})
				appendDir(rel, depth+1)
				continue
			}
			if !child.isFile {
				continue
			}
			isRequest := strings.HasSuffix(child.name, ".nts")
			if !isRequest && !strings.HasSuffix(child.name, ".ntd") {
				continue
			}
			command := rel
			entryType := "file"
			if isRequest {
				command = strings.TrimSuffix(rel, ".nts")
				entryType = "request"
			}
			entries = append(entries, FileTreeEntry{
				Name:         child.name,
				RelativePath: rel,
				CommandValue: command,
				Depth:        depth,
				Type:         entryType,
			})
		}
	}

	appendDir("", 0)
	return entries
}

func splitNonEmpty(s, sep string) []string {
	parts := strings.Split(s, sep)
	out := parts[:0]
	for _, p := range parts {
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// BuildExpandedDirectoryPaths derives the directories to expand from a typed
// command path. Mirrors buildExpandedDirectoryPaths.
func BuildExpandedDirectoryPaths(command string) map[string]bool {
	out := map[string]bool{}
	norm := strings.ReplaceAll(strings.TrimSpace(command), "\\", "/")
	parts := splitNonEmpty(norm, "/")

	depth := len(parts) - 1
	if strings.HasSuffix(norm, "/") {
		depth = len(parts)
	}
	if depth < 0 {
		depth = 0
	}

	for i := 1; i <= depth; i++ {
		out[strings.Join(parts[:i], "/")] = true
	}
	return out
}

// FindFileTreeMatchIndex returns the best match (exact > prefix > substring) for
// input, or -1. Mirrors findFileTreeMatchIndex.
func FindFileTreeMatchIndex(entries []FileTreeEntry, input string) int {
	normalized := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(input), "\\", "/"))
	if normalized == "" || strings.HasPrefix(normalized, "@") {
		return -1
	}

	startsWith := -1
	includes := -1
	for i, entry := range entries {
		command := strings.ToLower(entry.CommandValue)
		name := strings.ToLower(entry.Name)

		if command == normalized || name == normalized {
			return i
		}
		if startsWith == -1 && (strings.HasPrefix(command, normalized) || strings.HasPrefix(name, normalized)) {
			startsWith = i
		}
		if includes == -1 && (strings.Contains(command, normalized) || strings.Contains(name, normalized)) {
			includes = i
		}
	}

	if startsWith != -1 {
		return startsWith
	}
	return includes
}

// ResolveHighlightedEntry returns the entry to highlight for input: the best
// match, else the nearest expanded ancestor directory, else -1. Mirrors
// resolveHighlightedEntry.
func ResolveHighlightedEntry(entries []FileTreeEntry, input string) int {
	if matched := FindFileTreeMatchIndex(entries, input); matched != -1 {
		return matched
	}

	normalized := strings.ReplaceAll(strings.TrimSpace(input), "\\", "/")
	parts := splitNonEmpty(normalized, "/")
	for i := len(parts) - 1; i > 0; i-- {
		parentCommand := strings.Join(parts[:i], "/") + "/"
		for index, entry := range entries {
			if entry.Type == "directory" && entry.CommandValue == parentCommand {
				return index
			}
		}
	}
	return -1
}

// FileTreeViewport is the visible window of the tree.
type FileTreeViewport struct {
	Entries     []FileTreeEntry
	MaxScrollY  int
	SafeScrollY int
}

// BuildFileTreeViewport centers the highlighted entry within height rows.
// Mirrors buildFileTreeViewport.
func BuildFileTreeViewport(entries []FileTreeEntry, height, scrollY, highlightedIndex int) FileTreeViewport {
	maxScrollY := max(0, len(entries)-height)
	next := scrollY
	if highlightedIndex != -1 {
		next = highlightedIndex - max(1, height)/2
	}
	safe := min(max(next, 0), maxScrollY)
	end := min(safe+height, len(entries))
	return FileTreeViewport{
		Entries:     entries[safe:end],
		MaxScrollY:  maxScrollY,
		SafeScrollY: safe,
	}
}

// ResolveNextFileTreeSelectionIndex moves the keyboard selection by direction,
// clamped. -1 highlighted starts at an end. Mirrors
// resolveNextFileTreeSelectionIndex.
func ResolveNextFileTreeSelectionIndex(entries []FileTreeEntry, highlightedIndex, direction int) int {
	if len(entries) == 0 {
		return -1
	}
	if highlightedIndex == -1 {
		if direction == 1 {
			return 0
		}
		return len(entries) - 1
	}
	return min(max(highlightedIndex+direction, 0), len(entries)-1)
}

// ResolveParentDirectoryCommand returns the parent directory command of the
// given path (with a trailing slash), or ok=false when there is no parent.
// Mirrors command.ts resolveParentDirectoryCommand.
func ResolveParentDirectoryCommand(commandValue string) (string, bool) {
	normalized := strings.ReplaceAll(strings.TrimSpace(commandValue), "\\", "/")
	if normalized == "" {
		return "", false
	}
	parts := splitNonEmpty(normalized, "/")
	if len(parts) == 0 {
		return "", false
	}
	parts = parts[:len(parts)-1]
	if len(parts) == 0 {
		return "", true
	}
	return strings.Join(parts, "/") + "/", true
}

// ResolveSidebarCommand picks the path that drives the sidebar: the typed input
// unless it is empty or an @-command, in which case the keyboard selection.
// Mirrors resolveSidebarCommand.
func ResolveSidebarCommand(inputCommand, selectedCommand string) string {
	trimmed := strings.TrimSpace(inputCommand)
	if trimmed == "" || strings.HasPrefix(trimmed, "@") {
		return selectedCommand
	}
	return inputCommand
}

// FormatFileTreeEntryLabel renders an entry line padded/truncated to width.
// Mirrors formatFileTreeEntryLabel.
func FormatFileTreeEntryLabel(entry FileTreeEntry, width int) string {
	indent := strings.Repeat("  ", entry.Depth)
	marker := "  "
	if entry.Type == "directory" {
		if entry.IsExpanded {
			marker = "↓ "
		} else {
			marker = "→ "
		}
	}
	label := indent + marker + entry.Name
	runes := []rune(label)
	if len(runes) > width {
		cut := max(0, width-1)
		return padRight(string(runes[:cut]), width)
	}
	return padRight(label, width)
}

func padRight(s string, width int) string {
	if pad := width - len([]rune(s)); pad > 0 {
		return s + strings.Repeat(" ", pad)
	}
	return s
}
