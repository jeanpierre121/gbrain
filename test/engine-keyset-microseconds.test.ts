import { describe, expect, test, beforeAll } from 'bun:test';
import { PGLiteEngine } from '../src/core/pglite-engine.ts';

/**
 * Keyset pagination cursor precision (found 2026-08-28 on the email-facts run).
 *
 * `listPages` returns `updated_at` as a JS Date (millisecond precision) while
 * the column stores microseconds. A caller feeding that Date back as the
 * `updatedAfterKeyset` cursor used to hit `p.updated_at > cursor` for every
 * row in the cursor's millisecond (the last row of each batch re-selected;
 * a batch of same-millisecond rows never advanced). The predicate now treats
 * the cursor's whole millisecond as the tiebreak bucket.
 */
describe('listPages keyset walk with microsecond timestamps', () => {
  let engine: PGLiteEngine;
  const N = 25;

  beforeAll(async () => {
    engine = new PGLiteEngine();
    await engine.connect({});
    await engine.initSchema();
    for (let i = 0; i < N; i++) {
      const slug = `ks/page-${String(i).padStart(2, '0')}`;
      await engine.putPage(slug, { type: 'note', title: slug, compiled_truth: `${slug} body`, frontmatter: {} });
      // All 25 rows inside ONE millisecond, one microsecond apart.
      await engine.executeRaw(
        `UPDATE pages SET updated_at = ('2026-08-10T12:00:00.000100Z'::timestamptz + ($1::int * interval '1 microsecond')) WHERE slug = $2 AND source_id = 'default'`,
        [i, slug],
      );
    }
  });

  async function walk(): Promise<{ seen: string[]; batches: number }> {
    const seen: string[] = [];
    let keyset: { updatedAt: string; slug: string } | undefined;
    let batches = 0;
    while (batches < 20) {
      batches++;
      const batch = await engine.listPages({
        type: 'note' as never,
        sourceId: 'default',
        limit: 10,
        sort: 'updated_asc',
        ...(keyset ? { updatedAfterKeyset: keyset } : {}),
      });
      if (batch.length === 0) break;
      for (const p of batch) seen.push(p.slug);
      const last = batch[batch.length - 1];
      keyset = { updatedAt: new Date(last.updated_at).toISOString(), slug: last.slug };
      if (batch.length < 10) break;
    }
    return { seen, batches };
  }

  test('yields every row exactly once and terminates', async () => {
    const { seen, batches } = await walk();
    expect(seen).toHaveLength(N);
    expect(new Set(seen).size).toBe(N);
    expect(batches).toBeLessThanOrEqual(4);
    // Within the millisecond, rows come back ordered by slug.
    expect(seen).toEqual([...seen].sort());
  });

  test('rows in a later millisecond come after the whole bucket', async () => {
    await engine.putPage('ks/later', { type: 'note', title: 'later', compiled_truth: 'later', frontmatter: {} });
    await engine.executeRaw(
      `UPDATE pages SET updated_at = '2026-08-10T12:00:00.001000Z'::timestamptz WHERE slug = 'ks/later' AND source_id = 'default'`,
    );
    const { seen } = await walk();
    expect(seen).toHaveLength(N + 1);
    expect(seen[seen.length - 1]).toBe('ks/later');
  });
});
