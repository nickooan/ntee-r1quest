package nteedb

import "encoding/json"

// blobRef points at a value stored in the blob side file (blobs.dat).
type blobRef struct {
	Off  int64 `json:"o"`
	Size int32 `json:"n"`
}

// record is one line of the main JSONL log. Exactly one of the following holds:
//
//   - Deleted: a tombstone removing Key.
//   - Blob != nil: the value lives in blobs.dat at the given ref.
//   - otherwise: Value is the inline value (possibly empty).
//
// The JSON keys are kept short ("k","v","b","del") because every record is
// written to disk; omitempty keeps small records compact.
type record struct {
	Key     string   `json:"k"`
	Value   []byte   `json:"v,omitempty"` // inline value; base64 in JSON
	Blob    *blobRef `json:"b,omitempty"` // set when value is stored as a blob
	Deleted bool     `json:"del,omitempty"`
}

// isTombstone reports whether the record deletes its key.
func (r record) isTombstone() bool { return r.Deleted }

// marshalRecord encodes a record as a single JSON object with no trailing
// newline. The log layer is responsible for framing (appending "\n").
func marshalRecord(r record) ([]byte, error) {
	return json.Marshal(r)
}

// unmarshalRecord decodes a single JSON record line. The caller must strip any
// trailing newline first.
func unmarshalRecord(line []byte) (record, error) {
	var r record
	if err := json.Unmarshal(line, &r); err != nil {
		return record{}, err
	}
	return r, nil
}
