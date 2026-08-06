import { describe, test, expect } from 'bun:test';
import {
  factsWorldOnly,
  readableFactVisibilities,
} from '../src/core/facts/reader-trust.ts';

describe('factsWorldOnly', () => {
  test('trusted local callers see all (remote strictly false)', () => {
    expect(factsWorldOnly({ remote: false })).toBe(false);
    expect(factsWorldOnly({ remote: false, trustedFactReads: false })).toBe(false);
  });

  test('untrusted remote callers are world-only', () => {
    expect(factsWorldOnly({ remote: true })).toBe(true);
    expect(factsWorldOnly({ remote: true, trustedFactReads: false })).toBe(true);
  });

  test('FAIL-CLOSED: an omitted remote flag is world-only, never trusted', () => {
    // The cast-bypass guard: a context that lost its remote flag (forgotten
    // threading, `as` cast) degrades to world-only reads instead of leaking
    // private facts. Trusted local callers must pass remote:false explicitly.
    expect(factsWorldOnly({})).toBe(true);
    expect(factsWorldOnly({ trustedFactReads: false })).toBe(true);
  });

  test('trustedFactReads is an explicit owner grant — it elevates even an ambiguous context', () => {
    expect(factsWorldOnly({ trustedFactReads: true })).toBe(false);
  });

  test('owner-trusted remote reads bypass the world-only filter', () => {
    expect(factsWorldOnly({ remote: true, trustedFactReads: true })).toBe(false);
  });

  test('trustedFactReads only matters when remote (no effect locally)', () => {
    expect(factsWorldOnly({ remote: false, trustedFactReads: true })).toBe(false);
  });
});

describe('readableFactVisibilities', () => {
  test("world-only readers get the ['world'] filter", () => {
    expect(readableFactVisibilities({ remote: true })).toEqual(['world']);
    // Fail-closed: an ambiguous context filters too.
    expect(readableFactVisibilities({})).toEqual(['world']);
  });

  test('trusted readers get undefined (no filter — all rows)', () => {
    expect(readableFactVisibilities({ remote: false })).toBeUndefined();
    expect(readableFactVisibilities({ remote: true, trustedFactReads: true })).toBeUndefined();
  });
});
