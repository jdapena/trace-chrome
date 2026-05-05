# AGENTS.md

Notes for contributors and AI coding agents working on `trace-chrome`.

## Scope

This is a small Node.js CLI that captures Chrome tracing data over the Chrome DevTools Remote Debugging Protocol. It is intentionally tiny: three source files, two runtime dependencies, no tests, no TypeScript, no build step. The value of the tool is its smallness — please open an issue before proposing additions like a test framework, type system, build pipeline, or new runtime dependency.

For end-user instructions, see [README.md](README.md). For contribution workflow, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Dev workflow

- `npm install` — install deps.
- `npm run lint` — ESLint with `eslint-config-google` over `bin/trace-chrome` and `lib/*.js`. The same check runs in CI on every push and PR.
- Run locally against a Chrome started with `--remote-debugging-port=9222`:
  `node bin/trace-chrome -p 9222 > out.json` (Ctrl+C to stop).

There is no test suite.

## Architecture

Three files do all the work:

- `bin/trace-chrome` — CLI entry point. Uses `commander` to parse flags. Calls `traceChrome.buildTraceConfig(opts)` to produce a `traceConfig` containing connection-level settings (output file, memory-dump mode/interval) and a nested `trace_params` matching the Chrome DevTools Protocol `Tracing.start` shape (`{ traceConfig: {...}, streamFormat: 'json' }`). `--memory_dump_mode` implicitly forces `includedCategories` to `['*']` when unset and appends `disabled-by-default-memory-infra`. With `--ui [port]` (default 9223, bound to `--ui-host 127.0.0.1`) the CLI delegates to `lib/web-ui.js` instead of capturing immediately.
- `lib/trace-chrome.js` — CDP client built on `chrome-remote-interface`. Public exports: `setCriOptions(host, port)`, `showCategories()`, `captureTrace(traceConfig)`, plus `buildTraceConfig(opts, {log})`, `getCategories()` (returns `{regular, disabledByDefault}`), and `startCapture(traceConfig)` returning `{stop(), startedAt}`. `startCapture` opens a CRI client, accumulates events from `Tracing.dataCollected` into `data.traceEvents` (mirrored as `data.trace_events` for back-compat), starts tracing, and resolves its `stop()` promise on `Tracing.tracingComplete` (or with `incomplete: true` if the client disconnects first). `captureTrace` is a thin SIGINT-driven wrapper around `startCapture` that writes the result JSON to `output_file` or stdout — preserving the original CLI behaviour. If memory dumping is enabled, a `setInterval` calls `Tracing.requestMemoryDump` until stop; `dump_memory_at_stop` triggers one final dump before `Tracing.end()`.
- `lib/web-ui.js` — minimal HTTP server (`node:http` only, zero new runtime deps) exporting `startWebUi({host, port})`. Endpoints: `GET /` (inline HTML page), `GET /api/state`, `GET /api/categories`, `POST /api/start` (body is the same shape as CLI opts; expanded via `buildTraceConfig`), `POST /api/stop` (returns the trace JSON as a downloadable response). The page is a single inline HTML/CSS/JS template literal — no static assets, no framework. The "Stop, Download & Open in Perfetto" button uses Perfetto's documented `postMessage` handshake (open `https://ui.perfetto.dev/#!/`, await a `PING`, post back the trace ArrayBuffer). Single trace at a time; module-level `activeHandle` is the source of truth. Web mode installs its own `SIGINT` handler that gracefully stops any in-flight trace and shuts the server down.

## Notes when modifying

- Diagnostic output goes to stderr (`console.error`) so stdout stays clean for the JSON payload when no `-O` is given. Preserve this split.
- `trace_params.traceConfig` keys (`includedCategories`, `excludedCategories`, `enableSystrace`, …) are passed through verbatim to Chrome via `chrome-remote-interface`. Don't reshape them — they're the CDP wire format.
- The CLI exits via SIGINT, not a normal termination path. Avoid changes that would mask `SIGINT` or block its handler. `startCapture` itself never installs a SIGINT handler — that lives in `captureTrace` (CLI immediate path) and in `startWebUi` (web mode), and the two never coexist in a single process.
- The web UI is intended for localhost use. Default bind is `127.0.0.1`; allowing `0.0.0.0` should keep the existing stderr warning so it's obvious the start/stop control is reachable from the network.
