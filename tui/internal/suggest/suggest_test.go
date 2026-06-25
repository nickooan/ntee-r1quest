package suggest

import (
	"os"
	"path/filepath"
	"testing"
)

func hasLabel(items []Item, label, kind string) bool {
	for _, it := range items {
		if it.Label == label && it.Kind == kind {
			return true
		}
	}
	return false
}

func TestBuildEditorSuggestionItemsStatic(t *testing.T) {
	items := BuildEditorSuggestionItems("", "", nil)
	if !hasLabel(items, "ref", "keyword") {
		t.Fatal("missing ref keyword")
	}
	if !hasLabel(items, "content-type", "header") {
		t.Fatal("missing content-type header")
	}
	if !hasLabel(items, "@i", "macro") {
		t.Fatal("missing @i macro")
	}
}

func TestBuildEditorSuggestionItemsDefinitionKeys(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "data.ntd"), []byte("id: 1\nname: x\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	reqPath := filepath.Join(root, "req.nts")
	content := "ref data.ntd\nurl example.com\n"

	items := BuildEditorSuggestionItems(reqPath, content, nil)
	if !hasLabel(items, "id", "definition") || !hasLabel(items, "name", "definition") {
		t.Fatal("missing definition keys from referenced .ntd")
	}
	if !hasLabel(items, "@i(id)", "macro") {
		t.Fatal("missing definition macro @i(id)")
	}
}

func TestBuildCustomSuggestionItems(t *testing.T) {
	items := BuildEditorSuggestionItems("", "", []string{"x-tenant"})
	if !hasLabel(items, "x-tenant", "header") || !hasLabel(items, "x-tenant", "bodyKey") {
		t.Fatalf("custom suggestion should add header + bodyKey items: %+v", items)
	}
}

func TestBuildRefSuggestionItems(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "data.ntd"), []byte("id: 1\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "shared"), 0o755); err != nil {
		t.Fatal(err)
	}
	reqPath := filepath.Join(root, "req.nts")

	items := BuildRefSuggestionItems(reqPath, "da")
	if len(items) != 1 || items[0].Label != "data.ntd" || items[0].Kind != "ref" {
		t.Fatalf("expected data.ntd ref completion: %+v", items)
	}

	dirItems := BuildRefSuggestionItems(reqPath, "sh")
	if len(dirItems) != 1 || dirItems[0].Label != "shared/" {
		t.Fatalf("expected shared/ dir completion: %+v", dirItems)
	}
}
