export type ValueKind = "string" | "number"

export interface IndexDef {
  /** Index name (used in secIndex queries and as the key in put's ix values). */
  name: string
  /** Value type stored in the index. */
  kind: ValueKind
  /**
   * Optional dotted JSON path; when set, the index value is derived
   * automatically from each record's JSON value (the "scan itself" mode), and
   * reindex() can back-fill it over historical records.
   */
  jsonPath?: string
  /**
   * Cap on records sharing one value in this index. A write that pushes a
   * value's group over the cap evicts the oldest record(s) — lowest primary
   * key in the group — as a full, durable delete (the record leaves the store
   * and every index; design time-ordered keys so lowest pk = oldest).
   * 0 or omitted = unlimited.
   */
  maxPerValue?: number
}

export interface OpenOptions {
  /** Values >= this many bytes are stored in the blob side file. 0 = 64 KiB default; negative disables blobs. */
  blobThreshold?: number
  /** fsync on every write (durable but slower) vs. periodic flush. */
  syncEveryWrite?: boolean
  /** Rewrite the index hint after this many writes (also on close/compact). 0 disables periodic rewrites. */
  hintEveryN?: number
  /**
   * How value-returning reads decode values. 'json' (default) parses JSON values
   * into objects/arrays/scalars, with a Buffer fallback for binary/non-JSON;
   * 'buffer' returns byte-exact Buffers for everything. Governs get / getMany /
   * the *Records searches; key-only queries are unaffected.
   */
  valueFormat?: "json" | "buffer"
  /** Secondary indexes to maintain. */
  indexes?: IndexDef[]
}

/** A value: a Buffer, or a string (encoded as UTF-8). */
export type Value = Buffer | string

/**
 * A read value: under valueFormat 'json' a parsed JSON value (or a Buffer for
 * binary/non-JSON); under 'buffer' a Buffer. `unknown` because the concrete type
 * depends on the store's valueFormat — narrow or cast at the call site.
 */
export type ReadValue = unknown

export interface Record {
  key: string
  value: ReadValue
}

export declare class NteeDB {
  private constructor(handle: number)

  /** Open (creating if needed) a store at `dir`. */
  static open(dir: string, opts?: OpenOptions): NteeDB
  /** Delete every file of the store at `dir` (no DB need be open). */
  static destroy(dir: string): void

  /** Store `value` under `key`, with optional secondary index values. */
  put(
    key: string,
    value: Value,
    ix?: { [index: string]: string | number },
  ): void
  /**
   * Append many records in one batch (one FFI crossing, one lock, one fsync in
   * durable mode). Applied in array order; an invalid item rejects the whole
   * batch with nothing written. Runs off the event loop; resolves to the
   * number of records once all are appended.
   */
  putMany(
    items: {
      key: string
      value: Value
      ix?: { [index: string]: string | number }
    }[],
  ): Promise<number>

  /** Get the value for `key`, or null if absent. Type per valueFormat (see ReadValue). */
  get(key: string): ReadValue | null
  /**
   * Get the values for many keys in one FFI call, aligned to `keys`: each entry
   * is a value (per valueFormat), or null if that key is absent.
   */
  getMany(keys: string[]): (ReadValue | null)[]
  /** Whether `key` exists. */
  has(key: string): boolean
  /** Delete `key` (no-op if absent). */
  delete(key: string): void

  /** Sorted keys with the given primary-key prefix. */
  prefixScan(prefix: string): string[]
  /**
   * Primary keys whose value in the secondary index `name` equals `val` (multi-value).
   * @param limit 0 = all (ascending); N>0 = first N ascending; N<0 = last |N| descending.
   */
  secIndex(name: string, val: string | number, limit?: number): string[]
  /**
   * Primary keys whose (string) value in the secondary index `name` starts with `prefix`.
   * @param limit applied per distinct index value (grouped): 0 (default) = all
   * matches flat; N>0 = first N of each value ascending; N<0 = last |N| of each
   * value descending.
   */
  secIndexPrefix(name: string, prefix: string, limit?: number): string[]
  /** Primary keys whose value in the secondary index `name` is within [lo, hi]. */
  secIndexRange(
    name: string,
    lo: string | number,
    hi: string | number,
  ): string[]

  /** Indexes lingering in records after a soft-drop (until reindex). */
  secIndexDropped(): string[]
  /** Indexes not yet back-filled over pre-existing records. */
  secIndexProspective(): string[]

  /**
   * Delete every key strictly less than `cutoff` (cutoff kept). Lexical key
   * comparison; runs off the event loop. Resolves to the number removed. Does
   * not reclaim disk — call compact() for that.
   */
  removeByPkLess(cutoff: string): Promise<number>
  /**
   * Delete every key strictly greater than `cutoff` (cutoff kept). Runs off the
   * event loop; resolves to the number removed.
   */
  removeByPkGreater(cutoff: string): Promise<number>

  /** Reclaim dead records (runs off the event loop). */
  compact(): Promise<void>
  /** Back-fill Extract-based indexes over history + purge dropped (off the event loop). */
  reindex(): Promise<void>

  /** Flush and close. */
  close(): void
  /** Close and delete all of the store's files. */
  drop(): void

  /**
   * Search a secondary index, returning records {key, value} in one call (keys
   * query + one batched getMany). limit as secIndex.
   */
  secIndexRecords(name: string, val: string | number, limit?: number): Record[]
  /**
   * Search by secondary-index prefix (string index), returning records
   * {key, value} ordered by (index value, then primary key). limit as
   * secIndexPrefix (grouped).
   */
  secIndexPrefixRecords(name: string, prefix: string, limit?: number): Record[]
  /** Search by primary-key prefix, returning records {key, value}. */
  prefixScanRecords(prefix: string): Record[]
}

export default NteeDB
