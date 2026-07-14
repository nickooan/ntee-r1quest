package suggest

import (
	"os"
	"path/filepath"
	"strings"
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

func TestBuildHeaderValueSuggestionItems(t *testing.T) {
	// Empty fragment lists all values for the header.
	all := BuildHeaderValueSuggestionItems("content-type", "")
	if !hasLabel(all, "application/json", "headerValue") ||
		!hasLabel(all, "application/json; charset=utf-8", "headerValue") {
		t.Fatalf("content-type values missing: %+v", all)
	}

	// Case-insensitive header name + prefix filtering on the value.
	got := BuildHeaderValueSuggestionItems("Content-Type", "application/json;")
	if len(got) != 1 || got[0].Label != "application/json; charset=utf-8" {
		t.Fatalf("prefix filter: got %+v", got)
	}

	// cache-control common values.
	if !hasLabel(BuildHeaderValueSuggestionItems("cache-control", "no-s"), "no-store", "headerValue") {
		t.Fatal("cache-control no-store missing")
	}

	// Unknown header → no suggestions.
	if got := BuildHeaderValueSuggestionItems("x-nonexistent", ""); got != nil {
		t.Fatalf("unknown header should yield nil, got %+v", got)
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

func TestIsJointContent(t *testing.T) {
	cases := []struct {
		content string
		want    bool
	}{
		{"url \"https://x\"\ntype get\n", false},
		{"@joint('t')\n-> @run(a)\n", true},
		{"ref data.ntd\n\n// chain\n@joint()\n-> @run(a)\n", true},
		{"-> @run(a)\n", true},
		{"// @joint()\n", false},
		{"key: value\n", false},
		{"", false},
		{"ref data.ntd\n", false},
	}
	for _, c := range cases {
		if got := IsJointContent(c.content); got != c.want {
			t.Fatalf("IsJointContent(%q) = %v, want %v", c.content, got, c.want)
		}
	}
}

func TestBuildJointSuggestionItems(t *testing.T) {
	dir := t.TempDir()
	ntd := filepath.Join(dir, "data.ntd")
	if err := os.WriteFile(ntd, []byte("id: 1\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	requestPath := filepath.Join(dir, "chain.joint.nts")
	content := "ref data.ntd\n@joint()\n-> @run(a)\n"

	items := BuildJointSuggestionItems(requestPath, content)
	for _, want := range []struct{ label, kind string }{
		{"ref", "keyword"},
		{"@joint", "macro"},
		{"@pick", "macro"},
		{"@run", "macro"},
		{"@i", "macro"},
		{"@i(id)", "macro"},
		{"id", "definition"},
	} {
		if !hasLabel(items, want.label, want.kind) {
			t.Fatalf("missing %s (%s) in %#v", want.label, want.kind, items)
		}
	}
	for _, absent := range []string{"url", "body", "content-type", "@f", "@env"} {
		for _, item := range items {
			if item.Label == absent {
				t.Fatalf("joint pool must not contain %q", absent)
			}
		}
	}
}

func TestJointStepSuggestionOffsets(t *testing.T) {
	for _, item := range JointStepSuggestions {
		open := strings.IndexByte(item.InsertText, '(')
		if item.CursorOffset != open+1 {
			t.Fatalf("%s: offset %d should land inside the parens (want %d)", item.Label, item.CursorOffset, open+1)
		}
	}
}

func TestBuildEditorSuggestionItemsJointBootstrap(t *testing.T) {
	items := BuildEditorSuggestionItems("", "", nil)
	if !hasLabel(items, "@joint", "macro") {
		t.Fatalf("default pool should offer @joint to bootstrap a chain file")
	}
	for _, item := range items {
		if item.Label == "@env" {
			t.Fatalf("default .nts pool must not offer @env (a .ntd-only macro)")
		}
	}
}

func TestBuildRunSuggestionItems(t *testing.T) {
	dir := t.TempDir()
	for _, f := range []string{"query-user.nts", "notes.txt"} {
		if err := os.WriteFile(filepath.Join(dir, f), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.MkdirAll(filepath.Join(dir, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "sub", "query-post.nts"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	requestPath := filepath.Join(dir, "chain.joint.nts")
	if err := os.WriteFile(requestPath, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	items := BuildRunSuggestionItems(requestPath, "")
	if !hasLabel(items, "query-user", "run") {
		t.Fatalf("expected extension-stripped query-user in %#v", items)
	}
	if !hasLabel(items, "sub/", "run") {
		t.Fatalf("expected sub/ dir in %#v", items)
	}
	for _, item := range items {
		if item.Label == "chain.joint" || item.Label == "chain.joint.nts" {
			t.Fatalf("the open file must be excluded: %#v", items)
		}
		if item.Label == "notes.txt" {
			t.Fatalf("non-.nts files must be excluded: %#v", items)
		}
	}

	items = BuildRunSuggestionItems(requestPath, "sub/")
	if len(items) != 1 || items[0].Label != "sub/query-post" {
		t.Fatalf("dir navigation: %#v", items)
	}

	if BuildRunSuggestionItems(requestPath, "query-user.nts") != nil {
		t.Fatalf("a fragment already ending in .nts is complete")
	}
}

func TestBuildFileSuggestionItems(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "avatar.png"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	requestPath := filepath.Join(dir, "upload.nts")
	if err := os.WriteFile(requestPath, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	items := BuildFileSuggestionItems(requestPath, "")
	if !hasLabel(items, "avatar.png", "file") {
		t.Fatalf("expected avatar.png with extension kept: %#v", items)
	}
	for _, item := range items {
		if item.Label == "upload.nts" {
			t.Fatalf("the open file must be excluded: %#v", items)
		}
	}
}

func TestBuildTypeSuggestionItems(t *testing.T) {
	all := BuildTypeSuggestionItems("")
	if len(all) != 9 || all[0].Label != "get" {
		t.Fatalf("all methods, usage order: %#v", all)
	}
	p := BuildTypeSuggestionItems("P")
	if len(p) != 3 || !hasLabel(p, "post", "httpMethod") || !hasLabel(p, "put", "httpMethod") || !hasLabel(p, "patch", "httpMethod") {
		t.Fatalf("prefix p: %#v", p)
	}
}

func TestBuildAuthSchemeSuggestionItems(t *testing.T) {
	all := BuildAuthSchemeSuggestionItems("")
	if len(all) != 2 {
		t.Fatalf("all schemes: %#v", all)
	}
	be := BuildAuthSchemeSuggestionItems("be")
	if len(be) != 1 || be[0].InsertText != "bearer " {
		t.Fatalf("bearer with trailing space: %#v", be)
	}
}

func TestBuildDefinitionSuggestionItems(t *testing.T) {
	items := BuildDefinitionSuggestionItems([]string{"trace-token", "trace-token"})
	if !hasLabel(items, "@env", "macro") {
		t.Fatalf("definition pool should offer @env: %#v", items)
	}
	if !hasLabel(items, "trace-token", "bodyKey") {
		t.Fatalf("custom keys as entry scaffolds: %#v", items)
	}
	if len(items) != 2 {
		t.Fatalf("duplicates must collapse: %#v", items)
	}
}

func TestFindDefinitionKeyLine(t *testing.T) {
	content := "id: 1\nname: \"x\"\nid: 2\n// id: 3\n"
	if got := FindDefinitionKeyLine(content, "id"); got != 2 {
		t.Fatalf("duplicate keys resolve to the LAST line: got %d", got)
	}
	if got := FindDefinitionKeyLine(content, "name"); got != 1 {
		t.Fatalf("name line: got %d", got)
	}
	if got := FindDefinitionKeyLine(content, "missing"); got != -1 {
		t.Fatalf("absent key: got %d", got)
	}
}

func TestResolveKeyDefinition(t *testing.T) {
	dir := t.TempDir()
	write := func(name, content string) {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("a.ntd", "key: \"first\"\nonly-a: 1\n")
	write("b.ntd", "other: 1\nkey: \"second\"\n")
	requestPath := filepath.Join(dir, "get.nts")
	content := "ref a.ntd\nref gone.ntd\nref b.ntd\nurl \"https://x\"\n"

	// Later refs override earlier ones — the runtime winner is b.ntd.
	path, line, ok := ResolveKeyDefinition(requestPath, content, "key")
	if !ok || filepath.Base(path) != "b.ntd" || line != 1 {
		t.Fatalf("winner: %q line %d ok %v", path, line, ok)
	}

	// A key defined only in an earlier ref still resolves; the unreadable
	// ref (gone.ntd) is skipped.
	path, line, ok = ResolveKeyDefinition(requestPath, content, "only-a")
	if !ok || filepath.Base(path) != "a.ntd" || line != 1 {
		t.Fatalf("only-a: %q line %d ok %v", path, line, ok)
	}

	if _, _, ok := ResolveKeyDefinition(requestPath, content, "missing"); ok {
		t.Fatalf("missing key must not resolve")
	}
}
