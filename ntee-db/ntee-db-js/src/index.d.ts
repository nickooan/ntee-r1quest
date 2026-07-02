export type ValueKind = 'string' | 'number';

export interface IndexDef {
  /** Index name (used in byIndex queries and as the key in PutIndexed values). */
  name: string;
  /** Value type stored in the index. */
  kind: ValueKind;
  /**
   * Optional dotted JSON path; when set, the index value is derived
   * automatically from each record's JSON value (the "scan itself" mode), and
   * reindex() can back-fill it over historical records.
   */
  jsonPath?: string;
}

export interface OpenOptions {
  /** Values >= this many bytes are stored in the blob side file. 0 = 64 KiB default; negative disables blobs. */
  blobThreshold?: number;
  /** fsync on every write (durable but slower) vs. periodic flush. */
  syncEveryWrite?: boolean;
  /** Rewrite the index hint after this many writes (also on close/compact). 0 disables periodic rewrites. */
  hintEveryN?: number;
  /** Secondary indexes to maintain. */
  indexes?: IndexDef[];
}

/** A value: a Buffer, or a string (encoded as UTF-8). */
export type Value = Buffer | string;

export interface Record {
  key: string;
  value: Buffer | null;
}

export declare class NteeDB {
  private constructor(handle: number);

  /** Open (creating if needed) a store at `dir`. */
  static open(dir: string, opts?: OpenOptions): NteeDB;
  /** Delete every file of the store at `dir` (no DB need be open). */
  static destroy(dir: string): void;

  /** Store `value` under `key`, with optional secondary index values. */
  put(key: string, value: Value, ix?: { [index: string]: string | number }): void;
  /** Get the value for `key`, or null if absent. */
  get(key: string): Buffer | null;
  /** Whether `key` exists. */
  has(key: string): boolean;
  /** Delete `key` (no-op if absent). */
  delete(key: string): void;

  /** Sorted keys with the given primary-key prefix. */
  prefixScan(prefix: string): string[];
  /**
   * Primary keys whose value in `name` equals `val` (multi-value).
   * @param limit 0 = all (ascending); N>0 = first N ascending; N<0 = last |N| descending.
   */
  byIndex(name: string, val: string | number, limit?: number): string[];
  /**
   * Primary keys whose (string) value in `name` starts with `prefix`.
   * @param limit applied per distinct index value (grouped): 0 (default) = all
   * matches flat; N>0 = first N of each value ascending; N<0 = last |N| of each
   * value descending.
   */
  byIndexPrefix(name: string, prefix: string, limit?: number): string[];
  /** Primary keys whose value in `name` is within [lo, hi]. */
  byIndexRange(name: string, lo: string | number, hi: string | number): string[];

  /** Indexes lingering in records after a soft-drop (until reindex). */
  droppedIndexes(): string[];
  /** Indexes not yet back-filled over pre-existing records. */
  prospectiveIndexes(): string[];

  /**
   * Delete every key strictly less than `cutoff` (cutoff kept). Lexical key
   * comparison; runs off the event loop. Resolves to the number removed. Does
   * not reclaim disk — call compact() for that.
   */
  removeByPkLess(cutoff: string): Promise<number>;
  /**
   * Delete every key strictly greater than `cutoff` (cutoff kept). Runs off the
   * event loop; resolves to the number removed.
   */
  removeByPkGreater(cutoff: string): Promise<number>;

  /** Reclaim dead records (runs off the event loop). */
  compact(): Promise<void>;
  /** Back-fill Extract-based indexes over history + purge dropped (off the event loop). */
  reindex(): Promise<void>;

  /** Flush and close. */
  close(): void;
  /** Close and delete all of the store's files. */
  drop(): void;

  /** Search by index, returning records {key, value} in one call. limit as byIndex. */
  searchByIndex(name: string, val: string | number, limit?: number): Record[];
  /** Search by primary-key prefix, returning records {key, value}. */
  searchByPrefix(prefix: string): Record[];
  /**
   * Search by index prefix (string index), returning records {key, value}
   * ordered by (index value, then primary key). limit as byIndexPrefix (grouped).
   */
  searchByIndexPrefix(name: string, prefix: string, limit?: number): Record[];
}

export default NteeDB;
