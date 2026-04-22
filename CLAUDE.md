# wkg-kiosk-tool — project instructions

## npm lockfile must stay in sync (CI uses `npm ci`)

CI installs with `npm ci`, which fails hard if `package.json` and `package-lock.json` diverge — even by a single transitive entry. This has bitten us repeatedly (see commits `33766b0`, `0c71b07`, `c725acd`, `1187fac`), always with the same failure mode on Linux x64:

```
npm error Missing: @emnapi/core@1.9.2 from lock file
npm error Missing: @emnapi/runtime@1.9.2 from lock file
```

### Root cause

`@rolldown/binding-wasm32-wasi` (pulled in transitively via our dev-tooling chain) pins `@emnapi/core`/`@emnapi/runtime` at exactly `1.9.2` as nested deps. When the lockfile is generated on macOS (or any non-Linux host), npm may skip filling in the nested `node_modules/@rolldown/binding-wasm32-wasi/node_modules/@emnapi/*` entries because the wasm32-wasi binding isn't selected on the host platform. Linux CI then tries to install the binding, expects the nested entries, and `npm ci` bails.

### Pre-PR checklist (any change to `package.json`, `package-lock.json`, or any dep install)

1. **First try the cheap path:** `npm install --package-lock-only` to reconcile without touching `node_modules`.
2. **Verify:** `npm ci --dry-run`. If it reports any `Missing:` lines, the cheap path didn't fix it — go to step 3.
3. **Nuke + regenerate:** `rm package-lock.json && npm install`. This is the proven fix for the `@emnapi/*` drift. Verify again with `npm ci --dry-run` and `npx tsc --noEmit`.
4. Commit the updated `package-lock.json` in the same commit as the `package.json` change (or as a dedicated `fix(ci): regenerate package-lock.json` commit if no `package.json` change).

### Do not

- Re-run CI hoping the error goes away — the lockfile state is deterministic, the failure won't clear itself.
- Delete `package-lock.json` in CI or switch CI to `npm install` — that defeats the lockfile's purpose.
- Use `npm install --force` to paper over the problem — it creates a different inconsistent lockfile.

### Known repeat offender

`@emnapi/*` and `@napi-rs/wasm-runtime` — nested under `@rolldown/binding-wasm32-wasi` and `@tailwindcss/oxide-wasm32-wasi`. Any time CI complains about missing entries in this family, it's the same bug; go straight to step 3 above.
