/**
 * Fact-read visibility trust.
 *
 * Fact rows are tagged `private` | `world`. Remote/untrusted callers — anything
 * not strictly `remote: false` — see only `world` rows, the posture that keeps a
 * published or HTTP-served brain from leaking private claims to strangers.
 *
 * But the stdio MCP server is an unauthenticated LOCAL pipe: on a single-owner
 * machine the caller IS the owner, yet it still defaults `remote: true` for
 * safety, so the owner's own agent is denied the owner's own private facts
 * (e.g. `find_trajectory` returns empty over MCP even though the facts exist).
 *
 * `trustedFactReads` is a narrow, READ-ONLY trust elevation, deliberately
 * DECOUPLED from `remote` so every other remote protection — file_upload
 * confinement, source isolation, fence stripping, takes-holder scoping — stays
 * fully in force. The stdio MCP server sets it ONLY when the brain owner opts
 * in via the `facts.trust_local_reads` config (default off). The HTTP/published
 * transport never sets it, so a served brain stays world-only regardless.
 */
export interface FactReaderTrust {
  /**
   * Mirrors OperationContext.remote. FAIL-CLOSED: anything not strictly
   * `false` is remote/untrusted — an omitted flag (cast-bypassed context,
   * caller that forgot to thread it) degrades to world-only reads, never to
   * a private-fact leak. Trusted local callers must pass `remote: false`
   * explicitly.
   */
  remote?: boolean;
  /** Owner opt-in: this remote caller may read private facts. */
  trustedFactReads?: boolean;
}

/** True when the reader is restricted to `visibility = 'world'` rows. */
export function factsWorldOnly(t: FactReaderTrust): boolean {
  return t.remote !== false && t.trustedFactReads !== true;
}

/**
 * Visibility filter for list-style fact reads: `['world']` when the reader is
 * world-only, `undefined` (no filter — all rows) when it is trusted.
 */
export function readableFactVisibilities(
  t: FactReaderTrust,
): ('private' | 'world')[] | undefined {
  return factsWorldOnly(t) ? ['world'] : undefined;
}
