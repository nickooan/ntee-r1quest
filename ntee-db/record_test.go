package nteedb

import (
	"bytes"
	"testing"
)

func TestRecordRoundTrip(t *testing.T) {
	cases := []struct {
		name string
		rec  record
	}{
		{"inline", record{Key: "GetOrders", Value: []byte("hello world")}},
		{"empty value", record{Key: "EmptyVal"}},
		{"blob ref", record{Key: "BigUpload", Blob: &blobRef{Off: 4096, Size: 1 << 20}}},
		{"tombstone", record{Key: "Gone", Deleted: true}},
		{"binary value", record{Key: "Bin", Value: []byte{0x00, 0x01, 0xff, 0x0a, 0x7f}}},
		{"newline in key", record{Key: "weird\nkey", Value: []byte("v")}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			line, err := marshalRecord(tc.rec)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			if bytes.ContainsRune(line, '\n') {
				t.Fatalf("marshaled line must not contain a literal newline: %q", line)
			}
			got, err := unmarshalRecord(line)
			if err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if got.Key != tc.rec.Key {
				t.Errorf("key: got %q want %q", got.Key, tc.rec.Key)
			}
			if got.Deleted != tc.rec.Deleted {
				t.Errorf("deleted: got %v want %v", got.Deleted, tc.rec.Deleted)
			}
			if !bytes.Equal(got.Value, tc.rec.Value) {
				t.Errorf("value: got %q want %q", got.Value, tc.rec.Value)
			}
			if (got.Blob == nil) != (tc.rec.Blob == nil) {
				t.Fatalf("blob presence mismatch: got %v want %v", got.Blob, tc.rec.Blob)
			}
			if got.Blob != nil && *got.Blob != *tc.rec.Blob {
				t.Errorf("blob: got %+v want %+v", *got.Blob, *tc.rec.Blob)
			}
		})
	}
}

func TestTombstoneDetection(t *testing.T) {
	if !(record{Key: "x", Deleted: true}).isTombstone() {
		t.Error("expected tombstone")
	}
	if (record{Key: "x", Value: []byte("v")}).isTombstone() {
		t.Error("live record reported as tombstone")
	}
}
