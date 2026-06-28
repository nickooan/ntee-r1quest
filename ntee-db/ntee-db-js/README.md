# @ntee/ntee-db (Node.js binding)

In-process Node.js binding for **nteedb** — a pure-Go embedded log-structured
KV store with prefix search and secondary indexes. The Go core is exposed as a
C-shared library and loaded via [koffi](https://koffi.dev) (FFI). No separate
process; same model as `lmdb`/`better-sqlite3` (prebuilt native binaries per
platform).

## Usage

```js
import { NteeDB } from '@ntee/ntee-db';

const db = NteeDB.open('/path/to/store', {
  blobThreshold: 64 * 1024,     // values >= this go to the blob side file
  indexes: [
    { name: 'traceId', kind: 'string' },                    // explicit values
    { name: 'kind', kind: 'string', jsonPath: 'kind' },     // auto-derived from JSON
  ],
});

// write (value is a Buffer or string; 3rd arg = explicit index values)
db.put('call:1', JSON.stringify({ kind: 'request' }), { traceId: 'T1' });

// read content back
const buf = db.get('call:1');           // Buffer | null

// search → keys, then get; or searchByIndex → records in one call
db.byIndex('traceId', 'T1');            // ['call:1', ...]
db.searchByIndex('kind', 'request');    // [{ key, value: Buffer }, ...]
db.prefixScan('call:');                 // sorted keys
db.byIndexRange('status', 200, 299);    // numeric range

// maintenance (off the event loop)
await db.compact();                     // reclaim dead records
await db.reindex();                     // back-fill jsonPath indexes over history; purge dropped

db.close();                             // or db.drop() to delete the store
```

## API

| Method | Returns | Notes |
|---|---|---|
| `NteeDB.open(dir, opts?)` | `NteeDB` | creates if missing |
| `NteeDB.destroy(dir)` | `void` | delete a store's files (no open handle) |
| `put(key, value, ix?)` | `void` | `value`: Buffer\|string; `ix`: `{name: string\|number}` |
| `get(key)` | `Buffer \| null` | |
| `has(key)` / `delete(key)` | `boolean` / `void` | |
| `prefixScan(prefix)` | `string[]` | sorted keys |
| `byIndex / byIndexPrefix / byIndexRange` | `string[]` | primary keys |
| `searchByIndex / searchByPrefix` | `{key, value}[]` | keys + content |
| `droppedIndexes / prospectiveIndexes` | `string[]` | schema state |
| `compact()` / `reindex()` | `Promise<void>` | run off the event loop |
| `close()` / `drop()` | `void` | |

## Notes / limitations

- **Index values from JS**: pass them explicitly via `put(..., ix)`, or declare a
  `jsonPath` so the value is derived from the record (the only form `reindex()`
  can back-fill). JS-function extractors are not supported.
- **Marshaling**: values cross the boundary as bytes; `get` decodes base64
  internally and returns a `Buffer`.
- Errors from the store surface as thrown `Error`s.

## Building the native lib

Prebuilt binaries live in `prebuilds/<os>-<arch>/`. To (re)build for the host:

```sh
npm run build:native      # runs ../capi/build.sh → prebuilds/<os>-<arch>/
npm test
```

Cross-OS binaries are produced by building **on each OS** (CI matrix); there is
no cross-compile step (the Go + cgo source is identical per platform).
