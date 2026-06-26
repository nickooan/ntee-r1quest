package filetree

import "strings"

// InputSuggestion mirrors input-suggestions.ts InputSuggestion. Source is
// "file"/"directory" for current-directory tree entries, or "cache" for a
// recorded typed-history input (the latter has no Entry).
type InputSuggestion struct {
	Label      string
	InsertText string
	Source     string // "file" | "directory" | "cache"
	Entry      FileTreeEntry
}

// MaxInputSuggestions caps the popup, matching the TS default.
const MaxInputSuggestions = 8

// BuildInputSuggestions returns current-directory file/dir entries whose
// commandValue/name match the typed command, exact matches first then prefix
// matches (prefix-only, like the TS buildInputSuggestions), then cached typed
// inputs (already prefix-matched + recency-sorted by the runtime). Deduped by
// InsertText and capped to limit. Empty or @-commands yield nothing.
func BuildInputSuggestions(entries []FileTreeEntry, command string, cachedInputs []string, limit int) []InputSuggestion {
	trimmed := strings.TrimSpace(command)
	if trimmed == "" || strings.HasPrefix(trimmed, "@") {
		return nil
	}
	if limit <= 0 {
		limit = MaxInputSuggestions
	}

	normalized := strings.ToLower(strings.ReplaceAll(trimmed, "\\", "/"))

	var exact, prefix []FileTreeEntry
	for _, entry := range entries {
		cmd := strings.ToLower(entry.CommandValue)
		name := strings.ToLower(entry.Name)
		switch {
		case cmd == normalized || name == normalized:
			exact = append(exact, entry)
		case strings.HasPrefix(cmd, normalized) || strings.HasPrefix(name, normalized):
			prefix = append(prefix, entry)
		}
	}

	seen := map[string]bool{}
	suggestions := make([]InputSuggestion, 0, limit)
	for _, entry := range append(exact, prefix...) {
		if seen[entry.CommandValue] {
			continue
		}
		seen[entry.CommandValue] = true

		source := "file"
		if entry.Type == "directory" {
			source = "directory"
		}
		suggestions = append(suggestions, InputSuggestion{
			Label:      entry.CommandValue,
			InsertText: entry.CommandValue,
			Source:     source,
			Entry:      entry,
		})
		if len(suggestions) >= limit {
			break
		}
	}

	// Cached typed inputs, excluding anything already offered as a file entry.
	for _, cached := range cachedInputs {
		if len(suggestions) >= limit {
			break
		}
		if cached == "" || seen[cached] {
			continue
		}
		seen[cached] = true
		suggestions = append(suggestions, InputSuggestion{
			Label:      cached,
			InsertText: cached,
			Source:     "cache",
		})
	}
	return suggestions
}
