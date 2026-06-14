import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('dashboard renderer avoids innerHTML for event-controlled strings', async () => {
  const source = await readFile('src/server/html.ts', 'utf8');
  assert.doesNotMatch(source, /innerHTML\s*=/);
  assert.match(source, /textContent/);
  assert.match(source, /x-swarmwatch-token/);
});

test('operator inbox preserves typed drafts across polling refreshes', async () => {
  const source = await readFile('src/server/html.ts', 'utf8');
  assert.match(source, /operatorDrafts/);
  assert.match(source, /operatorSignature/);
  assert.match(source, /input\.addEventListener\('input'/);
  assert.match(source, /if\(signature===operatorSignature\)return/);
});
