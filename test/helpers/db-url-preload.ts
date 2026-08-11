/**
 * Pre-test setup: drop `GBRAIN_DATABASE_URL` from the test process env so no
 * test — however it is invoked — can reach the operator's real brain.
 *
 * Why this exists. On 2026-08-06 the e2e file
 * `test/e2e/pglite-cli-exit.serial.test.ts` wrote its fixtures into the
 * production brain. Two pages (`alpha`, `beta`) landed in `pages` at
 * 07:49:15Z, and one second later the fixture's `gbrain sync` overwrote the
 * `default` row in `sources` — `local_path` repointed at the test's throwaway
 * `$TMPDIR/gbrain-pglite-exit-src-*` git repo and `last_commit` set to that
 * repo's seed commit. When the tempdir was reaped, `sources.default.local_path`
 * became a dangling path, which silently killed `put_page` write-through
 * (`write-through.ts` returns `skipped: 'repo_not_found'` for a non-null but
 * missing `local_path`) and broke bare `gbrain sync` / `sync_brain`.
 *
 * How a hermetic test reached production. The fixture is careful: it makes its
 * own `GBRAIN_HOME` tempdir and runs `gbrain init --pglite`. `init` honours
 * `--pglite` and does build a PGLite brain in that tempdir. But every command
 * AFTER init goes through `loadConfig()`, and `loadConfig()` calls
 * `effectiveEnvDatabaseUrl()` first (`src/core/config.ts`), which returns
 * `GBRAIN_DATABASE_URL` unconditionally. A non-empty URL there forces
 * `engine: 'postgres'` and clears `database_path`, overriding the PGLite config
 * that `init` just wrote. So the subsequent `gbrain sync` imported the fixture
 * repo into whatever `GBRAIN_DATABASE_URL` pointed at. The fixture built its
 * subprocess env as `{ ...process.env, GBRAIN_HOME: tmpHome }` and stripped the
 * provider API keys but not the DB URL, so the operator's exported production
 * URL rode straight through.
 *
 * Why the existing guards did not catch it. `scripts/run-e2e.sh` already
 * scrubs every `GBRAIN_*` var except `GBRAIN_HOME` (added 2026-06-17,
 * v0.42.50.0), so `bun run test:e2e` was never the exposed path. The exposure
 * is the ordinary developer/agent habit of running one file directly —
 * `bun test test/e2e/pglite-cli-exit.serial.test.ts` — which bypasses the
 * wrapper entirely. `scripts/run-unit-parallel.sh` and `run-unit-shard.sh`
 * scrub nothing either, so the whole unit suite ran with the production URL
 * exported as well.
 *
 * Fix: unset the var once, globally, before any test file loads. That covers
 * all three invocation paths (wrapper, shard runner, bare `bun test <file>`)
 * and, because test files build subprocess envs by spreading `process.env`
 * AFTER preload has run, it covers spawned CLI subprocesses too.
 *
 * Deliberately narrow — `GBRAIN_DATABASE_URL` only:
 *   - `DATABASE_URL` is the e2e suite's real target (the docker-compose
 *     Postgres; see `test/e2e/helpers.ts`, which reads `DATABASE_URL` and
 *     guards it with `assertSafeE2eDatabaseUrl`). Clearing it here would break
 *     every Postgres-backed e2e file.
 *   - Tests that want a DB URL set one themselves — via `withEnv(...)` or an
 *     explicit save/assign/restore — which runs long after this preload and is
 *     unaffected.
 *
 * Imported by `bunfig.toml` via `preload = ["./test/helpers/db-url-preload.ts", ...]`.
 */
if (process.env.GBRAIN_DATABASE_URL) {
  if (process.env.GBRAIN_DEBUG_PRELOAD === '1') {
    console.error('[db-url-preload] cleared inherited GBRAIN_DATABASE_URL');
  }
  delete process.env.GBRAIN_DATABASE_URL;
}
