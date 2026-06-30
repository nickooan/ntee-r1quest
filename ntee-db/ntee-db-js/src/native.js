// Loads the platform-specific libnteedb shared library and declares the C ABI
// via koffi. Every C function returns a malloc'd JSON-envelope C-string; we use
// a koffi "disposable" return type so koffi decodes it to a JS string and frees
// the C memory automatically (via our nteedb_free).
import koffi from 'koffi';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function libraryPath() {
  const osName = process.platform === 'win32' ? 'windows' : process.platform; // darwin | linux | windows
  const goarch = process.arch === 'x64' ? 'amd64' : process.arch; // x64→amd64, arm64→arm64
  const ext = process.platform === 'darwin' ? 'dylib' : process.platform === 'win32' ? 'dll' : 'so';
  return path.join(here, '..', 'prebuilds', `${osName}-${goarch}`, `libnteedb.${ext}`);
}

const lib = koffi.load(libraryPath());

const free = lib.func('nteedb_free', 'void', ['void *']);

// A NUL-terminated string that koffi decodes to a JS string and frees with our
// allocator after each call (no leaks, no manual decode). Anonymous (no name) so
// re-evaluating this module — e.g. across jest suites, which share koffi's
// process-global type registry — never throws "duplicate type name".
const Str = koffi.disposable('str', free);

const def = (name, args) => lib.func(name, Str, args);

export const fns = {
  open: def('nteedb_open', ['str', 'str']),
  close: def('nteedb_close', ['uint']),
  drop: def('nteedb_drop', ['uint']),
  destroy: def('nteedb_destroy', ['str']),
  put: def('nteedb_put', ['uint', 'str', 'void *', 'int', 'str']),
  get: def('nteedb_get', ['uint', 'str']),
  has: def('nteedb_has', ['uint', 'str']),
  delete: def('nteedb_delete', ['uint', 'str']),
  prefixScan: def('nteedb_prefix_scan', ['uint', 'str']),
  byIndex: def('nteedb_by_index', ['uint', 'str', 'str', 'int']),
  byIndexPrefix: def('nteedb_by_index_prefix', ['uint', 'str', 'str']),
  byIndexRange: def('nteedb_by_index_range', ['uint', 'str', 'str', 'str']),
  compact: def('nteedb_compact', ['uint']),
  reindex: def('nteedb_reindex', ['uint']),
  droppedIndexes: def('nteedb_dropped_indexes', ['uint']),
  prospectiveIndexes: def('nteedb_prospective_indexes', ['uint']),
};

// readEnvelope parses the JSON envelope string, returning `result` or throwing `err`.
export function readEnvelope(s) {
  const env = JSON.parse(s);
  if (env.err) throw new Error(env.err);
  return env.result;
}

// callAsync runs a koffi function off the event loop (libuv thread) and resolves
// with its parsed result.
export function callAsync(fn, ...args) {
  return new Promise((resolve, reject) => {
    fn.async(...args, (err, s) => {
      if (err) return reject(err);
      try {
        resolve(readEnvelope(s));
      } catch (e) {
        reject(e);
      }
    });
  });
}
