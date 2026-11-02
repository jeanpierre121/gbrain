/**
 * Fork carry (run/full-facts): an owner-trusted reader (facts.trust_local_reads on the stdio pipe) reads private facts
 * with `remote: true`, so the hot-memory cache must keep it apart from a world-only reader of the same
 * source and session. A shared entry would serve the owner's private facts to the world-only reader.
 */
import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';
import { PGLiteEngine } from '../src/core/pglite-engine.ts';
import { getBrainHotMemoryMeta, __resetHotMemoryCacheForTests } from '../src/core/facts/meta-hook.ts';
import { dispatchToolCall } from '../src/mcp/dispatch.ts';
import { asOwner } from './helpers/owner-tier.ts';

const PRIVATE_FACT = 'PRIVATE-FACT the owner keeps to themselves';
const WORLD_FACT = 'WORLD-FACT anyone may read';
const SESSION = 'session-1';

let engine: PGLiteEngine;

beforeAll(async () => {
  engine = new PGLiteEngine();
  await engine.connect({});
  await engine.initSchema();
  for (const [fact, visibility] of [[PRIVATE_FACT, 'private'], [WORLD_FACT, 'world']] as const) {
    await asOwner(engine, tx => tx.insertFact(
      { fact, kind: 'fact', entity_slug: 'people/alice-example', source: 'test', visibility, source_session: SESSION },
      { source_id: 'default' },
    ));
  }
}, 120_000);

afterAll(async () => { await engine.disconnect(); });
beforeEach(() => { __resetHotMemoryCacheForTests(); });

async function factsFor(trustedFactReads: boolean): Promise<string[]> {
  const result = await dispatchToolCall(engine, 'get_stats', {}, {
    remote: true, sourceId: 'default', sessionId: SESSION, trustedFactReads, metaHook: getBrainHotMemoryMeta,
  });
  const meta = result._meta as { brain_hot_memory?: { facts: Array<{ fact: string }> } } | undefined;
  return (meta?.brain_hot_memory?.facts ?? []).map(f => f.fact).sort();
}

test('a world-only reader never gets the entry an owner-trusted reader warmed', async () => {
  expect(await factsFor(true)).toEqual([PRIVATE_FACT, WORLD_FACT]);
  expect(await factsFor(false)).toEqual([WORLD_FACT]);
});

test('an owner-trusted reader still gets private facts after a world-only reader warmed the cache', async () => {
  expect(await factsFor(false)).toEqual([WORLD_FACT]);
  expect(await factsFor(true)).toEqual([PRIVATE_FACT, WORLD_FACT]);
});
