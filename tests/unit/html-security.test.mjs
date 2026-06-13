import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('dashboard renderer avoids innerHTML for event-controlled strings', async () => {
  const source = await readFile('src/server/html.ts', 'utf8');
  assert.doesNotMatch(source, /innerHTML\s*=/);
  assert.match(source, /textContent/);
  assert.match(source, /x-swarmwatch-token/);
});
