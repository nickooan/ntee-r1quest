import { basename } from "node:path"
import {
  FILE_INDEX,
  MAX_VERSIONS_PER_FILE,
  NS,
  cacheDelete,
  cacheGet,
  openCache,
} from "./store.ts"

// A single edit-history snapshot of a file's content. Snapshots are one record
// each, keyed by NS.versions + a zero-padded caller-supplied `seq` (a monotonic
// millisecond id, so keys sort in save order and the oldest is the lowest key).
// The `file` secondary index (value = the file's absolute path) has
// maxPerValue = MAX_VERSIONS_PER_FILE, so the store auto-evicts the oldest
// snapshot once a file exceeds the cap.
//
// The TUI owns the "when" (coalescing edit bursts) and the undo cursor; this
// module is just storage. Snapshots are best-effort like the rest of the cache.

export type SnapshotKind = "edit" | "save"

export type SnapshotRecord = {
  filename: string
  // Absolute file path — also the value of the `file` secondary index.
  path: string
  // Monotonic millisecond id assigned by the caller; also the record key.
  seq: number
  snapshotAt: string
  kind: SnapshotKind
  content: string
}

// Zero-padded so keys sort in seq (time) order; 16 digits covers ms timestamps.
const versionKey = (seq: number): string =>
  `${NS.versions}${String(seq).padStart(16, "0")}`

/** Stores one snapshot for a file at the caller-supplied seq. */
export const recordSnapshot = async (
  path: string,
  seq: number,
  kind: SnapshotKind,
  content: string,
): Promise<void> => {
  const cache = openCache()

  if (!cache) {
    return
  }

  try {
    const record: SnapshotRecord = {
      filename: basename(path),
      path,
      seq,
      snapshotAt: new Date().toISOString(),
      kind,
      content,
    }
    // ntee-db JSON-serializes; the `file` index (+ maxPerValue) caps history.
    cache.put(versionKey(seq), record, { [FILE_INDEX]: path })
  } catch {
    // ignore snapshot write failures — history is best-effort
  }
}

/** Returns one snapshot's content by seq, or undefined when absent/evicted. */
export const getSnapshot = async (
  seq: number,
): Promise<SnapshotRecord | undefined> => {
  const cache = openCache()

  if (!cache) {
    return undefined
  }

  try {
    return await cacheGet<SnapshotRecord>(cache, versionKey(seq))
  } catch {
    return undefined
  }
}

export type SnapshotMeta = {
  seq: number
  snapshotAt: string
  kind: SnapshotKind
}

/**
 * Returns up to `limit` snapshots for a file, newest first, as lightweight
 * metadata (no content). Used to seed the undo timeline and to browse saved
 * versions.
 */
export const listSnapshots = async (
  path: string,
  limit = MAX_VERSIONS_PER_FILE,
): Promise<SnapshotMeta[]> => {
  const cache = openCache()

  if (!cache) {
    return []
  }

  try {
    // A negative limit returns the last |N| for the value, descending by key —
    // i.e. the newest snapshots first.
    const rows = await cache.secIndexRecords(FILE_INDEX, path, -Math.abs(limit))
    const out: SnapshotMeta[] = []
    for (const { value } of rows) {
      if (value == null || Buffer.isBuffer(value)) {
        continue
      }
      const record = value as SnapshotRecord
      out.push({
        seq: record.seq,
        snapshotAt: record.snapshotAt,
        kind: record.kind,
      })
    }
    return out
  } catch {
    return []
  }
}

/** Deletes snapshots by seq (used to drop the redo branch after a new edit). */
export const deleteSnapshots = async (seqs: number[]): Promise<void> => {
  const cache = openCache()

  if (!cache) {
    return
  }

  try {
    for (const seq of seqs) {
      cacheDelete(cache, versionKey(seq))
    }
  } catch {
    // ignore delete failures — best-effort
  }
}
