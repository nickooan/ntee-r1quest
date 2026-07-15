package filetree

import "strings"

// InputSuggestion mirrors input-suggestions.ts InputSuggestion. Source is
// "file"/"directory" for current-directory tree entries, or "cache" for a
// recorded typed-history input (the latter has no Entry). Recent marks a
// file/directory suggestion that also appears in the cached typed history —
// rendered like a cache row so recently-called requests stay recognizable
// even though the file entry absorbs the duplicate cache row.
type InputSuggestion struct {
	Label      string
	InsertText string
	Source     string // "file" | "directory" | "cache"
	Recent     bool
	Entry      FileTreeEntry
}

// MaxInputSuggestions caps the popup, matching the TS default.
const MaxInputSuggestions = 8

// BuildInputSuggestions returns entries matching the typed command, ranked
// exact > prefix > substring > subsequence, then cached typed inputs. Exact and
// prefix stages match visible tree entries of any type (preserving directory
// path navigation, like the TS buildInputSuggestions); the substring and
// subsequence stages — a deliberate divergence from the TS port — search
// allRequests, the full recursive .nts corpus, so keywords find requests inside
// collapsed directories. Labels always show the full relative path. Deduped by
// normalized CommandValue/InsertText and capped to limit. Empty or @-commands
// yield nothing.
func BuildInputSuggestions(entries, allRequests []FileTreeEntry, command string, cachedInputs []string, limit int) []InputSuggestion {
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

	// Substring and subsequence stages over the full .nts corpus. Name hits rank
	// above path-only hits; subsequence catches skipped-letter input ("gob" →
	// "get-orders-by-id"). Exact/prefix hits here are skipped: either the entry is
	// visible (already collected above) or shares its CommandValue with a visible
	// one, and the seen map dedupes the rest.
	var nameSubstr, pathSubstr, subseq []FileTreeEntry
	for _, entry := range allRequests {
		cmd := strings.ToLower(entry.CommandValue)
		name := strings.ToLower(entry.Name)
		switch {
		case strings.Contains(name, normalized):
			nameSubstr = append(nameSubstr, entry)
		case strings.Contains(cmd, normalized):
			pathSubstr = append(pathSubstr, entry)
		case isSubsequence(cmd, normalized) || isSubsequence(name, normalized):
			subseq = append(subseq, entry)
		}
	}

	ranked := append(append(append(append(exact, prefix...), nameSubstr...), pathSubstr...), subseq...)

	// Normalized cached inputs, so entry suggestions that absorb a duplicate
	// cache row can still be flagged (and rendered) as recently called.
	recent := map[string]bool{}
	for _, cached := range cachedInputs {
		key := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(cached), "\\", "/"))
		if key != "" {
			recent[key] = true
		}
	}

	seen := map[string]bool{}
	suggestions := make([]InputSuggestion, 0, limit)
	for _, entry := range ranked {
		key := strings.ToLower(entry.CommandValue)
		if seen[key] {
			continue
		}
		seen[key] = true

		source := "file"
		if entry.Type == "directory" {
			source = "directory"
		}
		suggestions = append(suggestions, InputSuggestion{
			Label:      entry.CommandValue,
			InsertText: entry.CommandValue,
			Source:     source,
			Recent:     recent[key],
			Entry:      entry,
		})
		if len(suggestions) >= limit {
			break
		}
	}

	// Cached typed inputs, excluding anything already offered as a file entry
	// (compared normalized, so case/backslash variants don't duplicate).
	for _, cached := range cachedInputs {
		if len(suggestions) >= limit {
			break
		}
		key := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(cached), "\\", "/"))
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		suggestions = append(suggestions, InputSuggestion{
			Label:      cached,
			InsertText: cached,
			Source:     "cache",
			Recent:     true,
		})
	}
	return suggestions
}

// isSubsequence reports whether all runes of needle appear in haystack in
// order, not necessarily adjacent. Both must already be lowercased.
func isSubsequence(haystack, needle string) bool {
	if needle == "" {
		return false
	}
	rest := haystack
	for _, r := range needle {
		i := strings.IndexRune(rest, r)
		if i < 0 {
			return false
		}
		rest = rest[i+len(string(r)):]
	}
	return true
}
