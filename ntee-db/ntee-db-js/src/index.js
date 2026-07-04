// Ergonomic Node.js wrapper around the nteedb C-shared library.
import { fns, readEnvelope, callAsync } from "./native.js"

// Exact UTF-8 validity check for batch payloads — the JS counterpart of Go's
// utf8.Valid. fatal makes invalid input throw instead of substituting U+FFFD;
// ignoreBOM keeps a leading BOM instead of silently stripping it.
const utf8Strict = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })

/**
 * NteeDB is an open handle to a store. Construct via NteeDB.open().
 */
export class NteeDB {
  #h
  #closed = false

  constructor(handle) {
    this.#h = handle
  }

  /**
   * Open (creating if needed) a store at `dir`.
   * opts: { blobThreshold?, syncEveryWrite?, hintEveryN?, indexes?: [{name, kind:'string'|'number', jsonPath?, maxPerValue?}] }
   */
  static open(dir, opts = {}) {
    const handle = readEnvelope(fns.open(dir, JSON.stringify({ ...opts, dir })))
    return new NteeDB(handle)
  }

  /** Delete every file of the store at `dir` (no DB need be open). */
  static destroy(dir) {
    readEnvelope(fns.destroy(dir))
  }

  #assertOpen() {
    if (this.#closed) throw new Error("nteedb: database is closed")
  }

  /** Store value (Buffer | string) under key, with optional secondary index values. */
  put(key, value, ix) {
    this.#assertOpen()
    const buf = Buffer.isBuffer(value) ? value : Buffer.from(value)
    const ixJSON = ix ? JSON.stringify(ix) : ""
    readEnvelope(fns.put(this.#h, key, buf, buf.length, ixJSON))
  }

  /**
   * Append many records in one batch — the bulk counterpart to put() for
   * imports and other high-volume writes: one FFI crossing, one lock, one
   * fsync in durable mode. Items are applied in array order (a repeated key's
   * later item wins); an invalid item rejects the whole batch with nothing
   * written. Runs off the event loop; the returned promise resolves to the
   * number of records once ALL of them are appended — synchronous durability
   * at the batch boundary, unlike lmdb-style fire-and-forget batching.
   *
   * items: [{ key, value: Buffer|string, ix? }]
   */
  putMany(items) {
    this.#assertOpen()
    // Values travel like the get envelope: valid-UTF-8 as a plain string
    // ("s"), binary as base64 ("v").
    const payload = items.map(({ key, value, ix }) => {
      let item
      if (typeof value === "string") {
        item = { k: key, s: value }
      } else {
        const buf = Buffer.isBuffer(value) ? value : Buffer.from(value)
        try {
          item = { k: key, s: utf8Strict.decode(buf) }
        } catch {
          item = { k: key, v: buf.toString("base64") }
        }
      }
      return ix ? { ...item, ix } : item
    })
    return callAsync(fns.putBatch, this.#h, JSON.stringify(payload))
  }

  /** Get the value for key as a Buffer, or null if absent. */
  get(key) {
    this.#assertOpen()
    const res = readEnvelope(fns.get(this.#h, key))
    if (!res || !res.found) return null
    // Text values arrive as a plain JSON string ("s"), binary as base64 ("v").
    if (res.v !== undefined) return Buffer.from(res.v, "base64")
    return Buffer.from(res.s ?? "", "utf8")
  }

  /**
   * Get the values for many keys in one FFI call, aligned to `keys`: each entry
   * is a Buffer, or null if that key is absent. The batched counterpart to
   * get() — used by the *Records searches so fetching N values is one crossing.
   */
  getMany(keys) {
    this.#assertOpen()
    const res = readEnvelope(fns.getMany(this.#h, JSON.stringify(keys)))
    return (res ?? []).map((rec) => {
      if (!rec || !rec.found) return null
      if (rec.v !== undefined) return Buffer.from(rec.v, "base64")
      return Buffer.from(rec.s ?? "", "utf8")
    })
  }

  /** Whether key exists. */
  has(key) {
    this.#assertOpen()
    return readEnvelope(fns.has(this.#h, key)) === true
  }

  /** Delete key (no-op if absent). */
  delete(key) {
    this.#assertOpen()
    readEnvelope(fns.delete(this.#h, key))
  }

  /** Sorted keys with the given primary-key prefix. */
  prefixScan(prefix) {
    this.#assertOpen()
    return readEnvelope(fns.prefixScan(this.#h, prefix)) ?? []
  }

  /**
   * Primary keys whose value in the secondary index `name` equals `val`
   * (multi-value).
   * limit: 0 = all (ascending); N>0 = first N ascending; N<0 = last |N| descending.
   */
  secIndex(name, val, limit = 0) {
    this.#assertOpen()
    return (
      readEnvelope(fns.byIndex(this.#h, name, JSON.stringify(val), limit)) ?? []
    )
  }

  /**
   * Primary keys whose (string) value in the secondary index `name` starts with
   * `prefix`.
   * limit is applied per distinct index value (grouped): 0 = all matches flat;
   * N>0 = first N of each value ascending; N<0 = last |N| of each value descending.
   */
  secIndexPrefix(name, prefix, limit = 0) {
    this.#assertOpen()
    return readEnvelope(fns.byIndexPrefix(this.#h, name, prefix, limit)) ?? []
  }

  /** Primary keys whose value in the secondary index `name` is within [lo, hi]. */
  secIndexRange(name, lo, hi) {
    this.#assertOpen()
    return (
      readEnvelope(
        fns.byIndexRange(this.#h, name, JSON.stringify(lo), JSON.stringify(hi)),
      ) ?? []
    )
  }

  /** Indexes lingering in records after a soft-drop (until Reindex). */
  secIndexDropped() {
    this.#assertOpen()
    return readEnvelope(fns.droppedIndexes(this.#h)) ?? []
  }

  /** Indexes not yet back-filled over pre-existing records. */
  secIndexProspective() {
    this.#assertOpen()
    return readEnvelope(fns.prospectiveIndexes(this.#h)) ?? []
  }

  /**
   * Delete every key strictly less than `cutoff` (the cutoff key itself is
   * kept). Keys are compared lexically, so the caller's key design decides what
   * the range means. Async — runs off the event loop; resolves to the number of
   * keys removed. Does not reclaim disk (call compact() for that).
   */
  removeByPkLess(cutoff) {
    this.#assertOpen()
    return callAsync(fns.removeByPkLess, this.#h, cutoff)
  }

  /**
   * Delete every key strictly greater than `cutoff` (the cutoff key itself is
   * kept). Async; resolves to the number of keys removed.
   */
  removeByPkGreater(cutoff) {
    this.#assertOpen()
    return callAsync(fns.removeByPkGreater, this.#h, cutoff)
  }

  /** Reclaim dead records (async — runs off the event loop). */
  compact() {
    this.#assertOpen()
    return callAsync(fns.compact, this.#h)
  }

  /** Back-fill Extract-based indexes over history + purge dropped (async). */
  reindex() {
    this.#assertOpen()
    return callAsync(fns.reindex, this.#h)
  }

  /** Flush and close. */
  close() {
    if (this.#closed) return
    this.#closed = true
    readEnvelope(fns.close(this.#h))
  }

  /** Close and delete all of the store's files. */
  drop() {
    if (this.#closed) throw new Error("nteedb: database is closed")
    this.#closed = true
    readEnvelope(fns.drop(this.#h))
  }

  /**
   * Search a secondary index and return records {key, value: Buffer} in one
   * call — the keys query plus a single batched getMany, not one get per key.
   * limit: 0 = all; N>0 = first N ascending; N<0 = last |N| descending.
   */
  secIndexRecords(name, val, limit = 0) {
    const keys = this.secIndex(name, val, limit)
    const vals = this.getMany(keys)
    return keys.map((key, i) => ({ key, value: vals[i] }))
  }

  /**
   * Search by secondary-index prefix (string index) and return records
   * {key, value: Buffer}. limit as secIndexPrefix (grouped per distinct value);
   * records come back ordered by (index value, then selected primary key).
   */
  secIndexPrefixRecords(name, prefix, limit = 0) {
    const keys = this.secIndexPrefix(name, prefix, limit)
    const vals = this.getMany(keys)
    return keys.map((key, i) => ({ key, value: vals[i] }))
  }

  /** Search by primary-key prefix and return records {key, value: Buffer}. */
  prefixScanRecords(prefix) {
    const keys = this.prefixScan(prefix)
    const vals = this.getMany(keys)
    return keys.map((key, i) => ({ key, value: vals[i] }))
  }
}

export default NteeDB
