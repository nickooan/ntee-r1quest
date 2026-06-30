import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NteeDB } from '../src/index.js';

async function withDB(opts, fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'nteedb-'));
  const db = NteeDB.open(dir, opts);
  try {
    await fn(db, dir);
  } finally {
    try { db.close(); } catch {}
    await rm(dir, { recursive: true, force: true });
  }
}

test('put/get/has/delete round-trip', async () => {
  await withDB({}, (db) => {
    db.put('alpha', Buffer.from('one'));
    db.put('beta', 'two'); // string accepted
    assert.equal(db.get('alpha').toString(), 'one');
    assert.equal(db.get('beta').toString(), 'two');
    assert.equal(db.has('beta'), true);
    assert.equal(db.get('missing'), null);

    db.put('alpha', Buffer.from('ONE'));
    assert.equal(db.get('alpha').toString(), 'ONE');

    db.delete('alpha');
    assert.equal(db.get('alpha'), null);
    assert.equal(db.has('alpha'), false);
  });
});

test('prefix scan', async () => {
  await withDB({}, (db) => {
    for (const k of ['input:Get', 'input:GetProperty', 'input:GetPropertyNames', 'api:/x', 'input:SetX']) {
      db.put(k, 'v');
    }
    assert.deepEqual(db.prefixScan('input:GetP'), ['input:GetProperty', 'input:GetPropertyNames']);
    assert.equal(db.prefixScan('input:').length, 4);
  });
});

test('binary values survive (blob path)', async () => {
  await withDB({ blobThreshold: 32 }, (db) => {
    const big = Buffer.alloc(4096, 0xab);
    db.put('blob', big);
    assert.ok(db.get('blob').equals(big));
  });
});

test('secondary indexes: explicit values, multi-value, range, prefix', async () => {
  await withDB({ indexes: [{ name: 'traceId', kind: 'string' }, { name: 'status', kind: 'number' }] }, (db) => {
    db.put('call:1', '{}', { traceId: 'T1', status: 200 });
    db.put('call:2', '{}', { traceId: 'T1', status: 404 });
    db.put('call:3', '{}', { traceId: 'T2', status: 200 });

    assert.deepEqual(db.byIndex('traceId', 'T1'), ['call:1', 'call:2']);
    assert.deepEqual(db.byIndexRange('status', 200, 299), ['call:1', 'call:3']);
    assert.deepEqual(db.byIndexPrefix('traceId', 'T'), ['call:1', 'call:2', 'call:3']);

    db.delete('call:1');
    assert.deepEqual(db.byIndex('traceId', 'T1'), ['call:2']);
  });
});

test('byIndex limit + direction (first N asc / last N desc)', async () => {
  await withDB({ indexes: [{ name: 'traceId', kind: 'string' }] }, (db) => {
    for (let i = 1; i <= 6; i++) db.put(`call:${i}`, '{}', { traceId: 'T' });
    assert.deepEqual(db.byIndex('traceId', 'T'), ['call:1', 'call:2', 'call:3', 'call:4', 'call:5', 'call:6']);
    assert.deepEqual(db.byIndex('traceId', 'T', 3), ['call:1', 'call:2', 'call:3']); // first 3 asc
    assert.deepEqual(db.byIndex('traceId', 'T', -2), ['call:6', 'call:5']); // last 2 desc
    assert.deepEqual(db.byIndex('traceId', 'T', 100), ['call:1', 'call:2', 'call:3', 'call:4', 'call:5', 'call:6']); // clamps
    assert.deepEqual(db.byIndex('traceId', 'missing', -5), []);
    const recent = db.searchByIndex('traceId', 'T', -2);
    assert.deepEqual(recent.map((r) => r.key), ['call:6', 'call:5']);
  });
});

test('jsonPath extractor + searchByIndex returns records', async () => {
  await withDB({ indexes: [{ name: 'kind', kind: 'string', jsonPath: 'kind' }] }, (db) => {
    db.put('r1', JSON.stringify({ kind: 'request', n: 1 }));
    db.put('r2', JSON.stringify({ kind: 'history', n: 2 }));
    db.put('r3', JSON.stringify({ kind: 'request', n: 3 }));

    const recs = db.searchByIndex('kind', 'request');
    assert.deepEqual(recs.map((r) => r.key), ['r1', 'r3']);
    assert.equal(JSON.parse(recs[0].value.toString()).n, 1);
  });
});

test('reopen restores state', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nteedb-'));
  try {
    const db = NteeDB.open(dir, {});
    db.put('a', '1');
    db.put('b', '2');
    db.delete('b');
    db.close();

    const db2 = NteeDB.open(dir, {});
    assert.equal(db2.get('a').toString(), '1');
    assert.equal(db2.get('b'), null);
    db2.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('async compact and reindex', async () => {
  await withDB({ indexes: [{ name: 'kind', kind: 'string', jsonPath: 'kind' }] }, async (db) => {
    db.put('r1', JSON.stringify({ kind: 'a' }));
    db.put('r1', JSON.stringify({ kind: 'a' })); // dead record
    db.put('r2', JSON.stringify({ kind: 'b' }));
    await db.compact();
    assert.deepEqual(db.byIndex('kind', 'a'), ['r1']);
    await db.reindex();
    assert.deepEqual(db.byIndex('kind', 'b'), ['r2']);
  });
});

test('error surfaces as thrown Error', async () => {
  await withDB({ indexes: [{ name: 'status', kind: 'number' }] }, (db) => {
    assert.throws(() => db.put('k', 'v', { unknownIndex: 'x' }), /unknown index/);
    assert.throws(() => db.byIndex('nope', 'x'), /unknown index/);
  });
});

test('drop deletes the store', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nteedb-'));
  try {
    const db = NteeDB.open(dir, {});
    db.put('a', '1');
    db.drop();
    const db2 = NteeDB.open(dir, {});
    assert.equal(db2.has('a'), false);
    db2.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('no memory leak across many calls (RSS stays bounded)', async () => {
  await withDB({}, (db) => {
    const big = Buffer.alloc(64 * 1024, 0x7a); // 64 KiB
    for (let i = 0; i < 50; i++) db.put('k' + i, big);
    if (global.gc) global.gc();
    const before = process.memoryUsage().rss;
    for (let i = 0; i < 20000; i++) {
      const v = db.get('k' + (i % 50));
      assert.equal(v.length, big.length);
    }
    if (global.gc) global.gc();
    const after = process.memoryUsage().rss;
    // 20k gets of a 64 KiB value would balloon RSS if the C buffers leaked.
    const growthMB = (after - before) / (1024 * 1024);
    assert.ok(growthMB < 64, `RSS grew ${growthMB.toFixed(1)} MB across 20k gets (possible leak)`);
  });
});
