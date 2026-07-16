package filetree

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestResolveParentDirectoryCommand(t *testing.T) {
	cases := []struct {
		in   string
		want string
		ok   bool
	}{
		{"orders/sub/get", "orders/sub/", true},
		{"orders/sub/", "orders/", true},
		{"orders/", "", true},
		{"orders", "", true},
		{"", "", false},
	}
	for _, c := range cases {
		got, ok := ResolveParentDirectoryCommand(c.in)
		if got != c.want || ok != c.ok {
			t.Fatalf("ResolveParentDirectoryCommand(%q) = (%q,%v), want (%q,%v)", c.in, got, ok, c.want, c.ok)
		}
	}
}

// suggestTree builds a root with a collapsed orders/ directory holding a nested
// request and a .ntd data file. Returns the visible (collapsed) entries and the
// full corpus (dirs + .nts + .ntd).
func suggestTree(t *testing.T) (entries, allEntries []FileTreeEntry) {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "orders"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{
		filepath.Join("orders", "get-orders-by-id.nts"),
		filepath.Join("orders", "data.ntd"),
		"orders.nts",
		"ping.nts",
	} {
		if err := os.WriteFile(filepath.Join(root, name), []byte("u\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return BuildFileTreeEntries(root, nil), BuildAllEntries(root)
}

func TestFuzzyMatchEntries(t *testing.T) {
	_, allEntries := suggestTree(t)

	// Name-substring hits rank before path-only hits; dirs and .ntd matchable.
	got := FuzzyMatchEntries(allEntries, "orders")
	if len(got) == 0 || !strings.Contains(strings.ToLower(got[0].Name), "orders") {
		t.Fatalf("name hits should rank first, got %+v", got)
	}
	var haveDir, haveNtd bool
	for _, e := range FuzzyMatchEntries(allEntries, "d") {
		if e.Type == "directory" {
			haveDir = true
		}
		if strings.HasSuffix(e.Name, ".ntd") {
			haveNtd = true
		}
	}
	if !haveDir || !haveNtd {
		t.Fatalf("directories and .ntd files should be matchable; dir=%v ntd=%v", haveDir, haveNtd)
	}

	if FuzzyMatchEntries(allEntries, "  ") != nil {
		t.Fatal("empty keyword should yield nil")
	}
}

func TestBuildInputSuggestions(t *testing.T) {
	entries, allRequests := suggestTree(t)

	// Prefix "or" → orders/ (dir) and orders (request), exact "orders" first.
	got := BuildInputSuggestions(entries, allRequests, "or", nil, MaxInputSuggestions)
	if len(got) < 2 {
		t.Fatalf("expected >=2 suggestions for 'or', got %+v", got)
	}

	// Exact matches are ordered before prefix-only matches. Both "orders/" (dir,
	// name == "orders") and "orders" (request) are exact, so the first result
	// must be one of them.
	exact := BuildInputSuggestions(entries, allRequests, "orders", nil, MaxInputSuggestions)
	if len(exact) == 0 {
		t.Fatal("expected suggestions for 'orders'")
	}
	first := exact[0].Entry
	if first.CommandValue != "orders" && first.Name != "orders" {
		t.Fatalf("first suggestion should be an exact match, got %+v", exact[0])
	}

	// Empty and @-commands yield nothing.
	if BuildInputSuggestions(entries, allRequests, "", nil, MaxInputSuggestions) != nil {
		t.Fatal("empty command should yield no suggestions")
	}
	if BuildInputSuggestions(entries, allRequests, "@v", nil, MaxInputSuggestions) != nil {
		t.Fatal("@-command should yield no suggestions")
	}
}

func TestBuildInputSuggestionsSubstring(t *testing.T) {
	entries, allRequests := suggestTree(t)

	// Mid-word keyword hits .nts requests by substring.
	got := BuildInputSuggestions(entries, allRequests, "rders", nil, MaxInputSuggestions)
	found := map[string]bool{}
	for _, s := range got {
		found[s.InsertText] = true
	}
	if !found["orders"] || !found["orders/get-orders-by-id"] {
		t.Fatalf("substring matches missing, got %+v", got)
	}

	// A request inside a collapsed directory is found, labeled with its full
	// relative path, and carries its entry.
	nested := BuildInputSuggestions(entries, allRequests, "by-id", nil, MaxInputSuggestions)
	if len(nested) != 1 {
		t.Fatalf("expected 1 suggestion for 'by-id', got %+v", nested)
	}
	s := nested[0]
	if s.Label != "orders/get-orders-by-id" || s.InsertText != "orders/get-orders-by-id" {
		t.Fatalf("nested suggestion should show the full path, got %+v", s)
	}
	if s.Source != "file" || s.Entry.Type != "request" {
		t.Fatalf("nested suggestion source/entry: %+v", s)
	}

	// Exact/prefix (visible entries) rank above corpus substring hits.
	ranked := BuildInputSuggestions(entries, allRequests, "orders", nil, MaxInputSuggestions)
	for i, s := range ranked {
		if s.InsertText == "orders/get-orders-by-id" && i == 0 {
			t.Fatalf("substring hit ranked above exact/prefix: %+v", ranked)
		}
	}

	// .nts-only scope: a keyword matching only data.ntd yields nothing.
	if got := BuildInputSuggestions(entries, allRequests, "data", nil, MaxInputSuggestions); len(got) != 0 {
		t.Fatalf(".ntd files should not be suggested, got %+v", got)
	}

	// Limit caps the popup.
	if got := BuildInputSuggestions(entries, allRequests, "or", nil, 2); len(got) != 2 {
		t.Fatalf("limit not applied, got %+v", got)
	}
}

func TestBuildInputSuggestionsSubsequence(t *testing.T) {
	entries, allRequests := suggestTree(t)

	// Skipped-letter fuzzy input: "gob" → get-orders-by-id.
	got := BuildInputSuggestions(entries, allRequests, "gob", nil, MaxInputSuggestions)
	if len(got) != 1 || got[0].InsertText != "orders/get-orders-by-id" {
		t.Fatalf("expected subsequence match for 'gob', got %+v", got)
	}
}

func TestBuildInputSuggestionsSourceAndDedup(t *testing.T) {
	entries, allRequests := suggestTree(t)
	got := BuildInputSuggestions(entries, allRequests, "orders", nil, MaxInputSuggestions)

	seen := map[string]bool{}
	for _, s := range got {
		if seen[s.InsertText] {
			t.Fatalf("duplicate insertText %q", s.InsertText)
		}
		seen[s.InsertText] = true
		if s.Source != "directory" && s.Source != "file" {
			t.Fatalf("unexpected source %q", s.Source)
		}
	}
}

func TestBuildInputSuggestionsCachedDedup(t *testing.T) {
	entries, allRequests := suggestTree(t)

	// Cached inputs duplicating an already-suggested path — including case and
	// backslash variants — are dropped; genuinely new ones still show as cache.
	cached := []string{"ORDERS", "orders\\get-orders-by-id", "orders-history"}
	got := BuildInputSuggestions(entries, allRequests, "orders", cached, MaxInputSuggestions)

	var cacheRows []string
	for _, s := range got {
		if s.Source == "cache" {
			cacheRows = append(cacheRows, s.InsertText)
			if !s.Recent {
				t.Fatalf("cache row should be marked recent: %+v", s)
			}
		}
	}
	if len(cacheRows) != 1 || cacheRows[0] != "orders-history" {
		t.Fatalf("cached dedup failed, cache rows: %v (all: %+v)", cacheRows, got)
	}

	// File suggestions that absorbed a duplicate cache row keep the recently-
	// called marker (rendered in the cache color); others don't.
	for _, s := range got {
		switch s.InsertText {
		case "orders", "orders/get-orders-by-id":
			if !s.Recent {
				t.Fatalf("suggestion deduping a cached input should be recent: %+v", s)
			}
		case "orders/":
			if s.Recent {
				t.Fatalf("suggestion without cached history should not be recent: %+v", s)
			}
		}
	}
}
