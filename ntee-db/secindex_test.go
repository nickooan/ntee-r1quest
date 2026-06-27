package nteedb

import "testing"

func TestSecIndexExactMultiValue(t *testing.T) {
	si := newSecIndex(IndexDef{Name: "traceId", Kind: KindString})
	for _, pk := range []string{"r3", "r1", "r2"} {
		e, _ := si.makeEntry("abc", pk)
		si.insert(e)
	}
	e, _ := si.makeEntry("xyz", "r4")
	si.insert(e)

	got, err := si.exact("abc")
	if err != nil {
		t.Fatal(err)
	}
	if !eqStrs(got, []string{"r1", "r2", "r3"}) {
		t.Errorf("exact(abc) = %v, want [r1 r2 r3] sorted by pk", got)
	}
	if got, _ := si.exact("xyz"); !eqStrs(got, []string{"r4"}) {
		t.Errorf("exact(xyz) = %v", got)
	}
	if got, _ := si.exact("none"); len(got) != 0 {
		t.Errorf("exact(none) = %v, want empty", got)
	}
}

func TestSecIndexRemove(t *testing.T) {
	si := newSecIndex(IndexDef{Name: "t", Kind: KindString})
	for _, pk := range []string{"a", "b", "c"} {
		e, _ := si.makeEntry("v", pk)
		si.insert(e)
	}
	rm, _ := si.makeEntry("v", "b")
	si.remove(rm)
	if got, _ := si.exact("v"); !eqStrs(got, []string{"a", "c"}) {
		t.Errorf("after remove = %v, want [a c]", got)
	}
}

func TestSecIndexNumberRange(t *testing.T) {
	si := newSecIndex(IndexDef{Name: "status", Kind: KindNumber})
	data := map[string]float64{"ok1": 200, "ok2": 204, "redir": 301, "err": 500}
	for pk, v := range data {
		e, _ := si.makeEntry(v, pk)
		si.insert(e)
	}
	got, err := si.rangeQuery(200, 299)
	if err != nil {
		t.Fatal(err)
	}
	if !eqStrs(got, []string{"ok1", "ok2"}) {
		t.Errorf("range 200-299 = %v, want [ok1 ok2]", got)
	}
	if got, _ := si.rangeQuery(300, 599); !eqStrs(got, []string{"redir", "err"}) {
		t.Errorf("range 300-599 = %v, want [redir err]", got)
	}
}

func TestSecIndexStringPrefix(t *testing.T) {
	si := newSecIndex(IndexDef{Name: "name", Kind: KindString})
	for _, v := range []struct{ val, pk string }{
		{"GetOrders", "k1"}, {"GetProperty", "k2"}, {"SetX", "k3"},
	} {
		e, _ := si.makeEntry(v.val, v.pk)
		si.insert(e)
	}
	got, err := si.prefix("Get")
	if err != nil {
		t.Fatal(err)
	}
	if !eqStrs(got, []string{"k1", "k2"}) {
		t.Errorf("prefix(Get) = %v, want [k1 k2]", got)
	}
}

func TestSecIndexTypeMismatch(t *testing.T) {
	si := newSecIndex(IndexDef{Name: "status", Kind: KindNumber})
	if _, err := si.makeEntry("not-a-number", "k"); err == nil {
		t.Error("expected error for string into number index")
	}
	str := newSecIndex(IndexDef{Name: "name", Kind: KindString})
	if _, err := str.makeEntry(42, "k"); err == nil {
		t.Error("expected error for number into string index")
	}
	if _, err := str.prefix("x"); err != nil {
		t.Errorf("prefix on string index should be fine: %v", err)
	}
	if _, err := si.prefix("x"); err == nil {
		t.Error("prefix on number index should error")
	}
}

func TestToFloatAcceptsNumericTypes(t *testing.T) {
	for _, v := range []any{200, int64(200), int32(200), float32(200), float64(200)} {
		if f, ok := toFloat(v); !ok || f != 200 {
			t.Errorf("toFloat(%T) = %v %v", v, f, ok)
		}
	}
	if _, ok := toFloat("200"); ok {
		t.Error("toFloat should reject strings")
	}
}
