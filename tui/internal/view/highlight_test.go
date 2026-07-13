package view

import "testing"

func findSeg(segs []HighlightSegment, text string) *HighlightSegment {
	for i := range segs {
		if segs[i].Text == text {
			return &segs[i]
		}
	}
	return nil
}

func TestHighlightKeywordAndString(t *testing.T) {
	segs := HighlightLine(`url "https://x"`, "r1quest")
	if len(segs) == 0 || segs[0].Text != "url" || segs[0].Color != "cyan" || !segs[0].Bold {
		t.Fatalf("expected leading cyan bold keyword; got %+v", segs)
	}
	if s := findSeg(segs, `"https://x"`); s == nil || s.Color != "yellow" {
		t.Fatalf("expected yellow string segment; got %+v", segs)
	}
}

func TestHighlightMacro(t *testing.T) {
	segs := HighlightLine(`@i(id)`, "r1quest")
	at := findSeg(segs, "@")
	action := findSeg(segs, "i")
	if at == nil || at.Color != "red" || !at.Bold {
		t.Fatalf("expected red @; got %+v", segs)
	}
	if action == nil || action.Color != "green" || !action.Bold {
		t.Fatalf("expected green action; got %+v", segs)
	}
}

func TestHighlightNumberAndComment(t *testing.T) {
	segs := HighlightLine("body 42", "r1quest")
	if s := findSeg(segs, "42"); s == nil || s.Color != "blue" {
		t.Fatalf("expected blue number; got %+v", segs)
	}
	comment := HighlightLine("// note", "r1quest")
	if s := findSeg(comment, "// note"); s == nil || !s.DimColor {
		t.Fatalf("expected dim comment; got %+v", comment)
	}
}

func TestBuildGraphqlHighlightLinesSugarBlock(t *testing.T) {
	lines := []string{"query {", "  user { id }", "}"}
	got := BuildGraphqlHighlightLines(lines)
	for i := 0; i < 3; i++ {
		if !got[i] {
			t.Fatalf("line %d should be graphql; got %+v", i, got)
		}
	}
}

func TestBuildGraphqlHighlightLinesPlain(t *testing.T) {
	lines := []string{"url example.com", "type json"}
	got := BuildGraphqlHighlightLines(lines)
	if len(got) != 0 {
		t.Fatalf("no graphql expected; got %+v", got)
	}
}

func TestHighlightGraphqlTokens(t *testing.T) {
	segs := HighlightLine("query { field }", "graphql")
	if s := findSeg(segs, "query"); s == nil || s.Color != "cyan" {
		t.Fatalf("expected cyan keyword; got %+v", segs)
	}
}

func TestBuildFilePaneLayout(t *testing.T) {
	layout := BuildFilePaneLayout(40, 12, 100)
	if layout.ContentHeight != 10 {
		t.Fatalf("content height: %d", layout.ContentHeight)
	}
	if layout.LineNumberWidth != 3 { // max(100,10) -> "100"
		t.Fatalf("line number width: %d", layout.LineNumberWidth)
	}
}

func TestHighlightArrowAndRun(t *testing.T) {
	segs := HighlightLine("-> @run(query-user)", "r1quest")
	arrow := findSeg(segs, "->")
	if arrow == nil || arrow.Color != "cyan" || !arrow.Bold {
		t.Fatalf("arrow: %#v", arrow)
	}
	at := findSeg(segs, "@")
	if at == nil || at.Color != "red" || !at.Bold {
		t.Fatalf("@: %#v", at)
	}
	action := findSeg(segs, "run")
	if action == nil || action.Color != "green" || !action.Bold {
		t.Fatalf("run: %#v", action)
	}
	path := findSeg(segs, "query-user")
	if path == nil || path.Color != "yellow" {
		t.Fatalf("path: %#v", path)
	}
}

func TestHighlightJoint(t *testing.T) {
	segs := HighlightLine("@joint('trace-id')", "r1quest")
	action := findSeg(segs, "joint")
	if action == nil || action.Color != "green" || !action.Bold {
		t.Fatalf("joint: %#v", action)
	}
	trace := findSeg(segs, "'trace-id'")
	if trace == nil || trace.Color != "yellow" {
		t.Fatalf("trace id: %#v", trace)
	}

	empty := HighlightLine("@joint()", "r1quest")
	if findSeg(empty, "joint") == nil {
		t.Fatalf("empty joint: %#v", empty)
	}
}

func TestHighlightPickJsonPath(t *testing.T) {
	segs := HighlightLine("-> @pick(postId: data.user.posts.data[0].id)", "r1quest")
	key := findSeg(segs, "postId")
	if key == nil || key.Color != "cyan" || key.Bold {
		t.Fatalf("key: %#v", key)
	}
	path := findSeg(segs, "data.user.posts.data[0].id")
	if path == nil || path.Color != "blue" {
		t.Fatalf("path: %#v", path)
	}
}

func TestHighlightPickNestedMacro(t *testing.T) {
	line := "-> @pick(content: @i(content-type)) // note"
	segs := HighlightLine(line, "r1quest")
	action := findSeg(segs, "i")
	if action == nil || action.Color != "green" || !action.Bold {
		t.Fatalf("nested i: %#v", action)
	}
	comment := findSeg(segs, "// note")
	if comment == nil || !comment.DimColor {
		t.Fatalf("comment: %#v", comment)
	}
}

func TestHighlightPickDefault(t *testing.T) {
	segs := HighlightLine(`@pick(k: @i(key or "d"))`, "r1quest")
	or := findSeg(segs, "or")
	if or == nil || or.Color != "cyan" || !or.Bold {
		t.Fatalf("or: %#v", or)
	}
	def := findSeg(segs, `"d"`)
	if def == nil || def.Color != "yellow" {
		t.Fatalf("default: %#v", def)
	}
}

func TestHighlightSingleQuotedString(t *testing.T) {
	segs := HighlightLine(`x 'a\'b'`, "r1quest")
	str := findSeg(segs, `'a\'b'`)
	if str == nil || str.Color != "yellow" {
		t.Fatalf("single-quoted: %#v", segs)
	}
}

func TestHighlightTypeMethodAndRefPath(t *testing.T) {
	segs := HighlightLine("type POST", "r1quest")
	method := findSeg(segs, "POST")
	if method == nil || method.Color != "magenta" || !method.Bold {
		t.Fatalf("method: %#v", method)
	}

	segs = HighlightLine("ref ../../data/example.ntd", "r1quest")
	path := findSeg(segs, "../../data/example.ntd")
	if path == nil || path.Color != "yellow" {
		t.Fatalf("ref path: %#v", path)
	}
}

func TestHighlightObjectKey(t *testing.T) {
	segs := HighlightLine("userId: 4", "r1quest")
	key := findSeg(segs, "userId")
	if key == nil || key.Color != "cyan" || key.Bold {
		t.Fatalf("key: %#v", key)
	}

	// A keyword followed by ":" is an entry key, not a request statement.
	segs = HighlightLine("type: foo", "r1quest")
	key = findSeg(segs, "type")
	if key == nil || key.Color != "cyan" || key.Bold {
		t.Fatalf("keyword-as-key: %#v", key)
	}

	// A real keyword line still wins.
	segs = HighlightLine(`url "https://x"`, "r1quest")
	keyword := findSeg(segs, "url")
	if keyword == nil || keyword.Color != "cyan" || !keyword.Bold {
		t.Fatalf("keyword: %#v", keyword)
	}
}

func TestHighlightPunctuation(t *testing.T) {
	segs := HighlightLine("body {", "r1quest")
	brace := findSeg(segs, "{")
	if brace == nil || brace.Color != "gray" {
		t.Fatalf("brace: %#v", brace)
	}

	// Punctuation inside strings stays part of the string token.
	segs = HighlightLine(`name: "a:b,c"`, "r1quest")
	str := findSeg(segs, `"a:b,c"`)
	if str == nil || str.Color != "yellow" {
		t.Fatalf("string: %#v", segs)
	}
}

func TestHighlightArrowInComment(t *testing.T) {
	segs := HighlightLine("// -> x", "r1quest")
	if len(segs) != 1 || !segs[0].DimColor || segs[0].Text != "// -> x" {
		t.Fatalf("comment: %#v", segs)
	}
}

func TestHighlightUnterminatedPick(t *testing.T) {
	segs := HighlightLine("-> @pick(k: v", "r1quest")
	var joined string
	for _, s := range segs {
		joined += s.Text
	}
	if joined != "-> @pick(k: v" {
		t.Fatalf("coverage: %q", joined)
	}
}

func TestHighlightSegmentsCoverLine(t *testing.T) {
	lines := []string{
		"ref ../../data/example.ntd",
		"@joint('example-user-post-chain')",
		"@joint()",
		"-> @pick(content: @i(content-type)) // optional leading pick",
		"-> @run(query-user)",
		"-> @pick(postId: data.user.posts.data[0].id, role: post.user.role)",
		"-> @run(../../query-post-comments)",
		`url "https://graphqlzero.almansi.me/api"`,
		"type post",
		"header content-type, application/json",
		"auth bearer @i(token)",
		`body { name: "x", age: 2, off: @i(off or true) }`,
		"userId: 4 // key line",
		"arr1: [\"name\", 1, true]",
		"-> @pick(k: v",
		"@pick(broken",
		"",
	}
	for _, line := range lines {
		var joined string
		for _, s := range HighlightLine(line, "r1quest") {
			joined += s.Text
		}
		if joined != line {
			t.Fatalf("segments do not cover line %q: got %q", line, joined)
		}
	}
}
