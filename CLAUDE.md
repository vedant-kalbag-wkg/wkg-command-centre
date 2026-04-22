# wkg-kiosk-tool — project instructions

## npm lockfile must stay in sync (CI uses `npm ci`)

CI installs with `npm ci`, which fails hard if `package.json` and `package-lock.json` diverge — even by a single transitive entry. This has bitten us repeatedly (see commits `33766b0`, `0c71b07`, `c725acd`, `1187fac`, `a0998b0`), always with the same failure shape on Linux x64:

```
npm error Missing: @emnapi/core@1.x.x from lock file
npm error Missing: @emnapi/runtime@1.x.x from lock file
```

### Root cause — macOS vs Linux platform skew

npm's lockfile records resolved entries for packages installed on the host where `npm install` ran. Two of our transitive deps — `@rolldown/binding-wasm32-wasi` and `@tailwindcss/oxide-wasm32-wasi` — have `bundleDependencies`/nested deps on `@emnapi/core` and `@emnapi/runtime`. Their install path differs by host:

- **On macOS (especially arm64):** npm picks the darwin-native binding and skips the wasm32-wasi binding. The `@emnapi/*` entries nested under the wasm32-wasi packages never make it into the lockfile.
- **On Linux x64 (GitHub Actions runner):** npm pulls in the wasm32-wasi binding and **requires** the nested `@emnapi/*` entries to be recorded in the lockfile.

A lockfile generated on macOS can look internally consistent and pass `npm ci --dry-run` locally, yet still fail `npm ci` on Linux CI. **Lockfile correctness is host-dependent.**

### Pre-PR checklist (any change to `package.json`, `package-lock.json`, or any dep install)

1. **Try the cheap path first (on macOS, fine):** `npm install --package-lock-only` → `npm ci --dry-run`. If dry-run is clean AND CI passes, you're done. Beware: macOS `--dry-run` can show false greens.
2. **If CI fails with `Missing: @emnapi/*` (or any transitive from the wasm32-wasi / `@napi-rs` / tailwind-oxide forest), regenerate the lockfile inside Linux.** Do NOT retry on macOS — it produces the same broken shape. Use Docker to match the CI runner:

   ```bash
   docker run --rm -v "$PWD":/app -w /app node:22-bookworm \
     bash -lc 'rm -f package-lock.json && npm install --package-lock-only && npm ci --dry-run'
   ```

   Check that `npm ci --dry-run` ends in `up to date` inside the container.

3. **Do NOT run `npm install` on macOS between the Docker regen and the commit.** The host install will silently rewrite the lockfile back to the macOS shape (this happened in commit `244ce24` and had to be re-fixed by `a0998b0`). If you need `node_modules` populated locally, run `npm ci` (not `npm install`) — `npm ci` installs from the lockfile without rewriting it.

4. Commit the lockfile directly from the state the Docker container produced. Verify with `git diff --stat package-lock.json` before committing — Linux-shape diffs confined to the wasm32-wasi / `@emnapi` / `@napi-rs` / lightningcss / tailwind-oxide forest are expected; changes to `next`, `react`, `drizzle`, `@neondatabase`, `typescript`, `vitest`, `playwright`, etc. are a red flag (check for unintended major-version drift).

### Do not

- Re-run CI hoping the error goes away — lockfile state is deterministic; same input → same failure.
- Delete `package-lock.json` in CI or switch CI to `npm install` — that defeats the lockfile's purpose.
- Use `npm install --force` on macOS to "fix" it — produces a different inconsistent lockfile.
- Regenerate on macOS and push — see root cause above; this is how we keep getting stuck in this loop.

### Known repeat offender

`@emnapi/*`, `@napi-rs/wasm-runtime`, and `@tybys/wasm-util` — nested under `@rolldown/binding-wasm32-wasi` and `@tailwindcss/oxide-wasm32-wasi`. Any time CI complains about `Missing: ...` entries in this family, it's the same bug: go straight to the Docker regen in step 2.
