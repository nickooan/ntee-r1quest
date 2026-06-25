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
