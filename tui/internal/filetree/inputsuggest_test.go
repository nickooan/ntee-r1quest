package filetree

import (
	"os"
	"path/filepath"
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

func suggestTree(t *testing.T) []FileTreeEntry {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "orders"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "orders.nts"), []byte("u\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "ping.nts"), []byte("u\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return BuildFileTreeEntries(root, nil)
}

func TestBuildInputSuggestions(t *testing.T) {
	entries := suggestTree(t)

	// Prefix "or" → orders/ (dir) and orders (request), exact "orders" first.
	got := BuildInputSuggestions(entries, "or", nil, MaxInputSuggestions)
	if len(got) < 2 {
		t.Fatalf("expected >=2 suggestions for 'or', got %+v", got)
	}

	// Exact matches are ordered before prefix-only matches. Both "orders/" (dir,
	// name == "orders") and "orders" (request) are exact, so the first result
	// must be one of them.
	exact := BuildInputSuggestions(entries, "orders", nil, MaxInputSuggestions)
	if len(exact) == 0 {
		t.Fatal("expected suggestions for 'orders'")
	}
	first := exact[0].Entry
	if first.CommandValue != "orders" && first.Name != "orders" {
		t.Fatalf("first suggestion should be an exact match, got %+v", exact[0])
	}

	// Empty and @-commands yield nothing.
	if BuildInputSuggestions(entries, "", nil, MaxInputSuggestions) != nil {
		t.Fatal("empty command should yield no suggestions")
	}
	if BuildInputSuggestions(entries, "@v", nil, MaxInputSuggestions) != nil {
		t.Fatal("@-command should yield no suggestions")
	}

	// Prefix-only (no substring): "rders" matches nothing.
	if got := BuildInputSuggestions(entries, "rders", nil, MaxInputSuggestions); len(got) != 0 {
		t.Fatalf("substring match should not be offered, got %+v", got)
	}
}

func TestBuildInputSuggestionsSourceAndDedup(t *testing.T) {
	entries := suggestTree(t)
	got := BuildInputSuggestions(entries, "orders", nil, MaxInputSuggestions)

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
