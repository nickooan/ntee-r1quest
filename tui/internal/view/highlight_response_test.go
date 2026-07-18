package view

import "testing"

func respSegText(segs []HighlightSegment) string {
	out := ""
	for _, s := range segs {
		out += s.Text
	}
	return out
}

func findRespSeg(t *testing.T, segs []HighlightSegment, text string) HighlightSegment {
	t.Helper()
	for _, s := range segs {
		if s.Text == text {
			return s
		}
	}
	t.Fatalf("segment %q not found in %+v", text, segs)
	return HighlightSegment{}
}

func TestHighlightResponseJSONLine(t *testing.T) {
	line := `    "name": "widget",`
	segs := HighlightLine(line, "response")
	if respSegText(segs) != line {
		t.Fatalf("segments must reassemble the line: %q", respSegText(segs))
	}
	if findRespSeg(t, segs, `"name"`).Color != "green" {
		t.Fatal("key should be green")
	}
	if findRespSeg(t, segs, `"widget"`).Color != "white" {
		t.Fatal("string value should be white")
	}
	if findRespSeg(t, segs, ",").Color != "gray" {
		t.Fatal("punctuation should be gray")
	}
}

func TestHighlightResponseNumbersAndBools(t *testing.T) {
	segs := HighlightLine(`    "count": 42,`, "response")
	if findRespSeg(t, segs, "42").Color != "white" {
		t.Fatal("number should be white")
	}
	segs = HighlightLine(`    "ok": true`, "response")
	if findRespSeg(t, segs, "true").Color != "white" {
		t.Fatal("bool should be white")
	}
}

func TestHighlightResponseStatusLines(t *testing.T) {
	segs := HighlightLine("Status 200 OK", "response")
	if findRespSeg(t, segs, "Status").Color != "cyan" {
		t.Fatal("label should be cyan")
	}
	if s := findRespSeg(t, segs, "200"); s.Color != "green" || !s.Bold {
		t.Fatalf("2xx should be bold green: %+v", s)
	}
	segs = HighlightLine("Status 404 Not Found", "response")
	if findRespSeg(t, segs, "404").Color != "red" {
		t.Fatal("4xx should be red")
	}
	segs = HighlightLine("Status 302 Found", "response")
	if findRespSeg(t, segs, "302").Color != "yellow" {
		t.Fatal("3xx should be yellow")
	}
}

func TestHighlightResponseChromeAndHeaders(t *testing.T) {
	segs := HighlightLine("── Response ───────", "response")
	if len(segs) != 1 || segs[0].Color != "gray" {
		t.Fatalf("section rule should be one gray segment: %+v", segs)
	}
	segs = HighlightLine("  content-type: application/json", "response")
	if findRespSeg(t, segs, "content-type").Color != "cyan" {
		t.Fatal("header key should be cyan")
	}
	// Title and free text stay plain.
	segs = HighlightLine("folder-2/create-post [POST]", "response")
	for _, s := range segs {
		if s.Color != "" {
			t.Fatalf("title should be plain: %+v", segs)
		}
	}
	// DSL macros are not applied in response mode.
	segs = HighlightLine(`    "note": "@i(user) stays plain",`, "response")
	if respSegText(segs) != `    "note": "@i(user) stays plain",` {
		t.Fatal("macro text must pass through untouched")
	}
	if findRespSeg(t, segs, `"@i(user) stays plain"`).Color != "white" {
		t.Fatal("macro-looking text is just a white string value")
	}
}
