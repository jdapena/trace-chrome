# AGENTS.md

Notes for contributors and AI coding agents working on `trace-chrome`.

## Scope

This is a small Node.js CLI that captures Chrome tracing data over the Chrome DevTools Remote Debugging Protocol. It is intentionally tiny: two source files, two runtime dependencies, no tests, no TypeScript, no build step. The value of the tool is its smallness — please open an issue before proposing additions like a test framework, type system, build pipeline, or new runtime dependency.

For end-user instructions, see [README.md](README.md). For contribution workflow, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Dev workflow

- `npm install` — install deps.
- `npm run lint` — ESLint with `eslint-config-google` over `bin/trace-chrome` and `lib/*.js`. The same check runs in CI on every push and PR.
- Run locally against a Chrome started with `--remote-debugging-port=9222`:
  `node bin/trace-chrome -p 9222 > out.json` (Ctrl+C to stop).

There is no test suite.

## Architecture

Two files do all the work:

- `bin/trace-chrome` — CLI entry point. Uses `commander` to parse flags into a `traceConfig` containing connection-level settings (output file, memory-dump mode/interval) and a nested `trace_params` matching the Chrome DevTools Protocol `Tracing.start` shape (`{ traceConfig: {...}, streamFormat: 'json' }`). `--memory_dump_mode` implicitly forces `includedCategories` to `['*']` when unset and appends `disabled-by-default-memory-infra`.
- `lib/trace-chrome.js` — CDP client built on `chrome-remote-interface`. Three exports: `setCriOptions(host, port)`, `showCategories()`, and `captureTrace(traceConfig)`. `captureTrace` opens a CRI client, accumulates events from `Tracing.dataCollected` into `data.traceEvents` (mirrored as `data.trace_events` for back-compat), and on `Tracing.tracingComplete` writes JSON to `output_file` or stdout. Tracing is started immediately after subscribing and is ended by a `SIGINT` handler — operators stop capture with Ctrl+C. If memory dumping is enabled, a `setInterval` calls `Tracing.requestMemoryDump` until SIGINT; `dump_memory_at_stop` triggers one final dump before `Tracing.end()`.

## Notes when modifying

- Diagnostic output goes to stderr (`console.error`) so stdout stays clean for the JSON payload when no `-O` is given. Preserve this split.
- `trace_params.traceConfig` keys (`includedCategories`, `excludedCategories`, `enableSystrace`, …) are passed through verbatim to Chrome via `chrome-remote-interface`. Don't reshape them — they're the CDP wire format.
- The CLI exits via SIGINT, not a normal termination path. Avoid changes that would mask `SIGINT` or block its handler.
