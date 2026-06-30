// Ergonomic Node.js wrapper around the nteedb C-shared library.
import { fns, readEnvelope, callAsync } from './native.js';

/**
 * NteeDB is an open handle to a store. Construct via NteeDB.open().
 */
export class NteeDB {
  #h;
  #closed = false;

  constructor(handle) {
    this.#h = handle;
  }

  /**
   * Open (creating if needed) a store at `dir`.
   * opts: { blobThreshold?, syncEveryWrite?, hintEveryN?, indexes?: [{name, kind:'string'|'number', jsonPath?}] }
   */
  static open(dir, opts = {}) {
    const handle = readEnvelope(fns.open(dir, JSON.stringify({ ...opts, dir })));
    return new NteeDB(handle);
  }

  /** Delete every file of the store at `dir` (no DB need be open). */
  static destroy(dir) {
    readEnvelope(fns.destroy(dir));
  }

  #assertOpen() {
    if (this.#closed) throw new Error('nteedb: database is closed');
  }

  /** Store value (Buffer | string) under key, with optional secondary index values. */
  put(key, value, ix) {
    this.#assertOpen();
    const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const ixJSON = ix ? JSON.stringify(ix) : '';
    readEnvelope(fns.put(this.#h, key, buf, buf.length, ixJSON));
  }

  /** Get the value for key as a Buffer, or null if absent. */
  get(key) {
    this.#assertOpen();
    const res = readEnvelope(fns.get(this.#h, key));
    if (!res || !res.found) return null;
    return Buffer.from(res.value ?? '', 'base64');
  }

  /** Whether key exists. */
  has(key) {
    this.#assertOpen();
    return readEnvelope(fns.has(this.#h, key)) === true;
  }

  /** Delete key (no-op if absent). */
  delete(key) {
    this.#assertOpen();
    readEnvelope(fns.delete(this.#h, key));
  }

  /** Sorted keys with the given primary-key prefix. */
  prefixScan(prefix) {
    this.#assertOpen();
    return readEnvelope(fns.prefixScan(this.#h, prefix)) ?? [];
  }

  /**
   * Primary keys whose value in `name` equals `val` (multi-value).
   * limit: 0 = all (ascending); N>0 = first N ascending; N<0 = last |N| descending.
   */
  byIndex(name, val, limit = 0) {
    this.#assertOpen();
    return readEnvelope(fns.byIndex(this.#h, name, JSON.stringify(val), limit)) ?? [];
  }

  /** Primary keys whose (string) value in `name` starts with `prefix`. */
  byIndexPrefix(name, prefix) {
    this.#assertOpen();
    return readEnvelope(fns.byIndexPrefix(this.#h, name, prefix)) ?? [];
  }

  /** Primary keys whose value in `name` is within [lo, hi]. */
  byIndexRange(name, lo, hi) {
    this.#assertOpen();
    return readEnvelope(fns.byIndexRange(this.#h, name, JSON.stringify(lo), JSON.stringify(hi))) ?? [];
  }

  /** Indexes lingering in records after a soft-drop (until Reindex). */
  droppedIndexes() {
    this.#assertOpen();
    return readEnvelope(fns.droppedIndexes(this.#h)) ?? [];
  }

  /** Indexes not yet back-filled over pre-existing records. */
  prospectiveIndexes() {
    this.#assertOpen();
    return readEnvelope(fns.prospectiveIndexes(this.#h)) ?? [];
  }

  /** Reclaim dead records (async — runs off the event loop). */
  compact() {
    this.#assertOpen();
    return callAsync(fns.compact, this.#h);
  }

  /** Back-fill Extract-based indexes over history + purge dropped (async). */
  reindex() {
    this.#assertOpen();
    return callAsync(fns.reindex, this.#h);
  }

  /** Flush and close. */
  close() {
    if (this.#closed) return;
    this.#closed = true;
    readEnvelope(fns.close(this.#h));
  }

  /** Close and delete all of the store's files. */
  drop() {
    if (this.#closed) throw new Error('nteedb: database is closed');
    this.#closed = true;
    readEnvelope(fns.drop(this.#h));
  }

  /**
   * Search by index and return records {key, value: Buffer} in one call.
   * limit: 0 = all; N>0 = first N ascending; N<0 = last |N| descending.
   */
  searchByIndex(name, val, limit = 0) {
    return this.#withValues(this.byIndex(name, val, limit));
  }

  /** Search by primary-key prefix and return records {key, value: Buffer}. */
  searchByPrefix(prefix) {
    return this.#withValues(this.prefixScan(prefix));
  }

  #withValues(keys) {
    return keys.map((key) => ({ key, value: this.get(key) }));
  }
}

export default NteeDB;
