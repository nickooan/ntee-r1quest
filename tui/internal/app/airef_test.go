package app

import "testing"

func TestCollectAiRefs(t *testing.T) {
	refs := map[string]string{
		"get.nts": "/root/orders/get.nts",
		"orders":  "/root/orders",
		"gone":    "/root/gone.nts", // pill deleted from the text → dropped
	}
	got := collectAiRefs("compare [orders] with [get.nts]", refs)
	if len(got) != 2 {
		t.Fatalf("expected 2 refs (deleted pill dropped), got %+v", got)
	}
	// Order follows appearance in the text: [orders] before [get.nts].
	if got[0].Path != "/root/orders" || got[0].Name != "orders" {
		t.Fatalf("first ref should be orders, got %+v", got[0])
	}
	if got[1].Path != "/root/orders/get.nts" || got[1].Name != "get.nts" {
		t.Fatalf("second ref should be get.nts, got %+v", got[1])
	}

	if got := collectAiRefs("no pills here", refs); len(got) != 0 {
		t.Fatalf("no pills should yield no refs, got %+v", got)
	}
}

func TestParseRefToken(t *testing.T) {
	cases := []struct {
		name    string
		text    string
		cursor  int
		keyword string
		start   int
		end     int
		ok      bool
	}{
		{"simple token, cursor at end", "#deep", 5, "deep", 0, 5, true},
		{"cursor inside token", "#deep", 3, "deep", 0, 5, true},
		{"after whitespace", "hi #ref", 7, "ref", 3, 7, true},
		{"newline boundary counts as whitespace", "a\n#tok", 6, "tok", 2, 6, true},
		{"trailing text: token ends at space", "#asdga as", 6, "asdga", 0, 6, true},
		{"scenario 1: space after #", "# asdgas", 1, "", 0, 0, false},
		{"scenario 1: cursor in the word after '# '", "# asdgas", 4, "", 0, 0, false},
		{"scenario 2: cursor past the token", "#asdga as", 8, "", 0, 0, false},
		{"scenario 3: glued #", "asdfasf#asdgas", 14, "", 0, 0, false},
		{"bare #", "#", 1, "", 0, 0, false},
		{"cursor before the #", "#deep", 0, "", 0, 0, false},
		{"empty input", "", 0, "", 0, 0, false},
	}
	for _, c := range cases {
		keyword, start, end, ok := parseRefToken(c.text, c.cursor)
		if ok != c.ok {
			t.Fatalf("%s: parseRefToken(%q, %d) ok=%v, want %v", c.name, c.text, c.cursor, ok, c.ok)
		}
		if !ok {
			continue
		}
		if keyword != c.keyword || start != c.start || end != c.end {
			t.Fatalf("%s: parseRefToken(%q, %d) = (%q,%d,%d), want (%q,%d,%d)",
				c.name, c.text, c.cursor, keyword, start, end, c.keyword, c.start, c.end)
		}
	}
}

