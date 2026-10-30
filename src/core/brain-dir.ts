/**
 * src/core/brain-dir.ts — the ONE place that decides where a cycle's
 * filesystem phases run (`gbrain dream`, the autopilot-cycle and
 * autopilot-global-maintenance job handlers, and the per-phase job wrappers).
 *
 * Resolution order and the eight reason codes:
 *
 *   explicit path given
 *     ├─ relative, and the caller is a job handler (explicitMustBeAbsolute)
 *     │                            ▶ { dir: null,       reason: 'explicit_relative' }
 *     │                              (#7630: a relative path names the worker's
 *     │                               cwd, so it is no checkout; no fall-through)
 *     ├─ exists on disk ───────────▶ { dir: explicit,   reason: 'explicit' }
 *     └─ missing ──────────────────▶ { dir: null,       reason: 'explicit_missing' }
 *                                     (the CALLER decides: the CLI exits 1,
 *                                      a job handler fails the job — this
 *                                      module never exits the process)
 *   sourceId given (and an engine)
 *     ├─ local_path absolute and on disk ▶ { dir: local_path, reason: 'source_path' }
 *     └─ no local_path / relative / not on disk ▶ { dir: null, reason: 'source_no_path' }
 *                                     (NEVER falls through to the global key:
 *                                      that path belongs to the default brain
 *                                      and would mix scopes — #2227)
 *   otherwise, the global `sync.repo_path` key (and an engine)
 *     ├─ configured, absolute, exists ▶ { dir: repo_path, reason: 'global' }
 *     └─ configured but relative or missing ▶ { dir: null, reason: 'global_missing' }
 *   nothing configured ────────────▶ { dir: null,       reason: 'none' }
 *
 * A null `dir` means "no on-disk checkout here": filesystem phases skip with
 * `no_brain_dir` and the DB-only phases still run. Before this module, the
 * job handlers read `sync.repo_path` unchecked, so a brain whose checkout
 * lives on another machine (a laptop path inside a container) threw
 * "Directory not found" inside every filesystem phase instead of skipping.
 *
 * Never walks cwd for a `.git`: only the explicit / source / config signals
 * are trusted. A STORED path (a source's local_path, `sync.repo_path`) must be
 * absolute (upstream #7630): a relative one names whatever directory gbrain
 * runs from, so it is treated as no checkout. Never throws on a missing path; a database error from the
 * sources or config read propagates (the caller's job fails with it).
 */

import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { BrainEngine } from './engine.ts';
import { fetchSource } from './sources-load.ts';

export type BrainDirReason =
  | 'explicit'
  | 'explicit_missing'
  | 'explicit_relative'
  | 'source_path'
  | 'source_no_path'
  | 'global'
  | 'global_missing'
  | 'none';

export interface BrainDirResolution {
  /** Absolute checkout path, or null when no usable checkout exists. */
  dir: string | null;
  reason: BrainDirReason;
  /**
   * The path that was consulted but not usable (diagnostics only): the
   * explicit path for `explicit_missing` / `explicit_relative`, the source's `local_path` for a
   * `source_no_path` whose path is configured but absent, the config value
   * for `global_missing`.
   */
  configured?: string;
}

/** Config key of the legacy (pre-multi-source) default checkout. */
export const GLOBAL_REPO_PATH_KEY = 'sync.repo_path';

export interface ResolveBrainDirOpts {
  /**
   * Job handlers set this: a relative explicit repoPath in a job payload
   * names the worker's cwd (#7630), so it resolves to no checkout instead of
   * being resolved against cwd. The CLI (`gbrain dream --dir .`) leaves it
   * off: a relative path the user typed is resolved to absolute.
   */
  explicitMustBeAbsolute?: boolean;
}

export async function resolveBrainDir(
  engine: BrainEngine | null,
  explicit: string | null | undefined,
  sourceId?: string,
  opts: ResolveBrainDirOpts = {},
): Promise<BrainDirResolution> {
  if (explicit) {
    if (opts.explicitMustBeAbsolute && !isAbsolute(explicit)) {
      return { dir: null, reason: 'explicit_relative', configured: explicit };
    }
    if (!existsSync(explicit)) {
      return { dir: null, reason: 'explicit_missing', configured: explicit };
    }
    // Absolute so downstream writeFileSync(join(brainDir, slug)) can't land
    // at cwd when explicit is `.` / `./brain`.
    return { dir: resolve(explicit), reason: 'explicit' };
  }

  if (engine && sourceId) {
    const src = await fetchSource(engine, sourceId);
    const localPath =
      typeof src?.local_path === 'string' && src.local_path.length > 0 ? src.local_path : null;
    if (localPath && isAbsolute(localPath) && existsSync(localPath)) {
      return { dir: resolve(localPath), reason: 'source_path' };
    }
    return { dir: null, reason: 'source_no_path', ...(localPath ? { configured: localPath } : {}) };
  }

  if (engine) {
    const configured = (await engine.getConfig(GLOBAL_REPO_PATH_KEY)) ?? null;
    if (configured && isAbsolute(configured) && existsSync(configured)) {
      return { dir: resolve(configured), reason: 'global' };
    }
    if (configured) {
      return { dir: null, reason: 'global_missing', configured };
    }
  }

  return { dir: null, reason: 'none' };
}
