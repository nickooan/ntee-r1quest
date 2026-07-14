package view

import "testing"

func segTexts(segments []HighlightSegment) []string {
	out := make([]string, 0, len(segments))
	for _, s := range segments {
		out = append(out, s.Text)
	}
	return out
}

func TestMarkdownHeaderLine(t *testing.T) {
	segs, inCode := MarkdownLineSegments("## Title", false)
	if inCode {
		t.Fatal("header should not enter code block")
	}
	if len(segs) != 1 || segs[0].Color != "blue" || !segs[0].Bold || segs[0].Text != "## Title" {
		t.Fatalf("header should be one blue bold segment: %+v", segs)
	}
}

func TestMarkdownListMarker(t *testing.T) {
	segs, _ := MarkdownLineSegments("- item one", false)
	if len(segs) < 2 || segs[0].Text != "- " || segs[0].Color != "cyan" {
		t.Fatalf("list marker should be a cyan segment: %+v", segs)
	}
	segs, _ = MarkdownLineSegments("2. numbered", false)
	if len(segs) < 2 || segs[0].Text != "2. " || segs[0].Color != "cyan" {
		t.Fatalf("numbered marker should be a cyan segment: %+v", segs)
	}
}

func TestMarkdownInlineSpans(t *testing.T) {
	segs, _ := MarkdownLineSegments("use `go test` and **really** see https://x.dev/docs now", false)
	var code, bold, link *HighlightSegment
	for i := range segs {
		switch segs[i].Text {
		case "`go test`":
			code = &segs[i]
		case "**really**":
			bold = &segs[i]
		case "https://x.dev/docs":
			link = &segs[i]
		}
	}
	if code == nil || code.Color != "yellow" {
		t.Fatalf("inline code should be yellow: %+v", segs)
	}
	if bold == nil || !bold.Bold {
		t.Fatalf("bold span should be bold: %+v", segs)
	}
	if link == nil || link.Color != "cyan" || !link.Underline {
		t.Fatalf("link should be cyan underlined: %+v", segs)
	}
}

func findSegment(segments []HighlightSegment, text string) *HighlightSegment {
	for i := range segments {
		if segments[i].Text == text {
			return &segments[i]
		}
	}
	return nil
}

func TestMarkdownLink(t *testing.T) {
	segs, _ := MarkdownLineSegments("see the [docs](https://example.com) now", false)
	label := findSegment(segs, "docs")
	if label == nil || label.Color != "cyan" || !label.Underline {
		t.Fatalf("link label should be cyan underlined: %+v", segs)
	}
	url := findSegment(segs, " (https://example.com)")
	if url == nil || url.Color != "gray" {
		t.Fatalf("link url should be kept as a gray parenthetical: %+v", segs)
	}
	// The raw markdown syntax must not survive as plain text.
	if findSegment(segs, "[docs](") != nil {
		t.Fatalf("raw link syntax should not render literally: %+v", segs)
	}
}

func TestMarkdownBareURLTrailingPunctuation(t *testing.T) {
	segs, _ := MarkdownLineSegments("visit https://example.com. Thanks", false)
	url := findSegment(segs, "https://example.com")
	if url == nil || url.Color != "cyan" || !url.Underline {
		t.Fatalf("bare url should be styled without the trailing period: %+v", segs)
	}
	if findSegment(segs, ".") == nil {
		t.Fatalf("trailing punctuation should split into plain text: %+v", segs)
	}
}

func TestMarkdownItalicAndBoldItalic(t *testing.T) {
	segs, _ := MarkdownLineSegments("this is *soft* and ***loud***", false)
	if it := findSegment(segs, "*soft*"); it == nil || !it.Italic || it.Bold {
		t.Fatalf("*soft* should be italic only: %+v", segs)
	}
	if bi := findSegment(segs, "***loud***"); bi == nil || !bi.Bold || !bi.Italic {
		t.Fatalf("***loud*** should be bold+italic: %+v", segs)
	}
}

func TestMarkdownStrikethrough(t *testing.T) {
	segs, _ := MarkdownLineSegments("~~gone~~ text", false)
	if s := findSegment(segs, "~~gone~~"); s == nil || !s.Strike {
		t.Fatalf("~~gone~~ should be struck through: %+v", segs)
	}
}

func TestMarkdownDoesNotItalicizeSnakeCase(t *testing.T) {
	// Underscores are common in agent prose (identifiers); they must stay plain.
	for _, in := range []string{"call foo_bar_baz here", "the __init__ method", "a *b in code"} {
		segs, _ := MarkdownLineSegments(in, false)
		for _, s := range segs {
			if s.Italic || s.Bold {
				t.Fatalf("%q should not be emphasized: %+v", in, segs)
			}
		}
	}
}

func TestMarkdownPlusBulletAndBlockquote(t *testing.T) {
	segs, _ := MarkdownLineSegments("+ plus item", false)
	if m := findSegment(segs, "+ "); m == nil || m.Color != "cyan" {
		t.Fatalf("+ bullet marker should be cyan: %+v", segs)
	}
	segs, _ = MarkdownLineSegments("> quoted line", false)
	if m := findSegment(segs, "> "); m == nil || m.Color != "gray" {
		t.Fatalf("blockquote marker should be gray: %+v", segs)
	}
}

func TestMarkdownUnclosedSpansStayLiteral(t *testing.T) {
	segs, _ := MarkdownLineSegments("this **is unclosed and `so is", false)
	if len(segs) != 1 || segs[0].Bold || segs[0].Color != "" {
		t.Fatalf("unclosed delimiters should render literally: %+v", segs)
	}
	if segs[0].Text != "this **is unclosed and `so is" {
		t.Fatalf("text should be unchanged: %q", segs[0].Text)
	}
}

func TestMarkdownCodeFenceToggles(t *testing.T) {
	segs, inCode := MarkdownLineSegments("```go", false)
	if !inCode || !segs[0].DimColor {
		t.Fatalf("opening fence should be dim and enter code block: %+v", segs)
	}
	segs, inCode = MarkdownLineSegments("x := 1", true)
	if !inCode || segs[0].Color != "yellow" {
		t.Fatalf("code block line should be yellow: %+v", segs)
	}
	_, inCode = MarkdownLineSegments("```", true)
	if inCode {
		t.Fatal("closing fence should exit code block")
	}
}

func TestWrapSegmentsSplitsPreservingStyle(t *testing.T) {
	rows := WrapSegments([]HighlightSegment{
		{Text: "abc"},
		{Text: "defghij", Bold: true},
	}, 5)
	if len(rows) != 2 {
		t.Fatalf("expected 2 rows: %+v", rows)
	}
	if got := segTexts(rows[0]); got[0] != "abc" || got[1] != "de" {
		t.Fatalf("row 0 should split at width 5: %+v", rows[0])
	}
	if !rows[0][1].Bold || !rows[1][0].Bold || rows[1][0].Text != "fghij" {
		t.Fatalf("continuation should keep bold: %+v", rows)
	}
}

func TestWrapSegmentsEmptyLine(t *testing.T) {
	rows := WrapSegments([]HighlightSegment{{Text: ""}}, 10)
	if len(rows) != 1 {
		t.Fatalf("empty line should yield one row: %+v", rows)
	}
}
