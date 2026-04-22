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
2. **If CI fails with `Missing: @emnapi/*` (or any transitive from the wasm32-wasi / `@napi-rs` / tailwind-oxide forest), or if vitest/next/rolldown fail at runtime with `Cannot find module '@*/binding-linux-x64-gnu'`, regenerate the lockfile inside a clean linux/amd64 container.** Do NOT retry on macOS — it produces a lockfile with only darwin-arm64 platform entries.

   Two hard requirements on Apple silicon:
   - `--platform linux/amd64` — forces x86_64 emulation. Without this, the default arm64 Linux container records only the arm64 Linux bindings (missing the x64 binding CI needs). Confirm with `uname -m` → `x86_64`.
   - **Isolated build directory** — do NOT mount the repo root directly. If the host's `node_modules` is visible to the container, npm records only the platforms installed in that (macOS-arm64) tree. Copy only `package.json` to a scratch dir inside the container, regen there, copy the lockfile back.

   Canonical command:

   ```bash
   docker run --rm --platform linux/amd64 -v "$PWD":/src node:22-bookworm bash -lc '
     set -e
     mkdir -p /build && cp /src/package.json /build/package.json
     cd /build
     npm install --package-lock-only
     npm ci --dry-run
     cp /build/package-lock.json /src/package-lock.json
   '
   ```

   A correct lockfile is ~18k lines and contains resolved entries for every `@rolldown/binding-*`, `@tailwindcss/oxide-*`, `@next/swc-*`, `lightningcss-*`, and `@unrs/resolver-binding-*` platform variant — not just the one matching your host. If `grep '"node_modules/@rolldown/binding-linux-x64-gnu"' package-lock.json` returns empty, the regen is broken; redo it.

3. **Do NOT run `npm install` on macOS between the Docker regen and the commit.** The host install will silently rewrite the lockfile back to the macOS shape (this happened in commit `244ce24` and had to be re-fixed by `a0998b0`). If you need `node_modules` populated locally, run `npm ci` (not `npm install`) — `npm ci` installs from the lockfile without rewriting it.

4. Commit the lockfile directly from the state the Docker container produced. Verify with `git diff --stat package-lock.json` before committing — Linux-shape diffs confined to the wasm32-wasi / `@emnapi` / `@napi-rs` / lightningcss / tailwind-oxide forest are expected; changes to `next`, `react`, `drizzle`, `@neondatabase`, `typescript`, `vitest`, `playwright`, etc. are a red flag (check for unintended major-version drift).

### Do not

- Re-run CI hoping the error goes away — lockfile state is deterministic; same input → same failure.
- Delete `package-lock.json` in CI or switch CI to `npm install` — that defeats the lockfile's purpose.
- Use `npm install --force` on macOS to "fix" it — produces a different inconsistent lockfile.
- Regenerate on macOS and push — see root cause above; this is how we keep getting stuck in this loop.

### Two failure shapes to recognise

- **`npm error Missing: @emnapi/...`** at the `npm ci` step → lockfile is missing nested bundleDependency entries. Root cause: lockfile generated on macOS without the wasm32-wasi binding tree.
- **Runtime `Cannot find module '@*/binding-linux-x64-gnu'`** after `npm ci` succeeded (typically from `vitest`, `next build`, or anything touching rolldown) → lockfile lists the x64 binding as optional but has no resolved entry for it, so `npm ci` silently skips installing it. Root cause: lockfile was generated on arm64 (either macOS-arm64 host, or a Linux container without `--platform linux/amd64`), OR the host's `node_modules` was mounted and polluted the resolution.

Both are the same underlying bug: lockfile does not reflect the CI runner's platform. Fix is always the Docker regen in step 2.

### Known repeat offender

`@emnapi/*`, `@napi-rs/wasm-runtime`, `@tybys/wasm-util`, `@rolldown/binding-linux-x64-gnu`, `@tailwindcss/oxide-linux-x64-gnu`, `@next/swc-linux-x64-gnu`, `@unrs/resolver-binding-linux-x64-gnu`. Any time CI complains about any of these, it is the lockfile drift — go straight to the Docker regen.
