# Contributing

PRs welcome. This is a small public utility — the goal is to keep it small and useful.

## Dev setup

```sh
npm install
npm run lint
```

For end-to-end testing, point the CLI at a Chrome started with `--remote-debugging-port`. See [README.md](README.md) for examples.

## Coding style

ESLint with `eslint-config-google` (see `eslint.config.js`). Please run `npm run lint` and resolve any warnings before submitting. CI runs the same check on every push and PR.

## Scope guardrails

The tool is intentionally minimal: two source files, two runtime dependencies, no tests, no TypeScript, no build step. Please open an issue to discuss before proposing:

- A test framework or test suite.
- TypeScript, a build pipeline, or transpilation.
- New runtime dependencies.
- Major new features beyond the current CDP `Tracing` surface.

Bug fixes, small features that fit the existing shape, and documentation improvements don't need a prior issue — just send the PR.

## Releasing

trace-chrome is published to npm as `@jdapena/trace-chrome`. To cut a release:

```sh
npm run release
```

The script will check the working tree is clean, run lint, confirm `npm whoami`, prompt for a new version (`X.Y.Z`), then commit, tag (`vX.Y.Z`), `git push --follow-tags`, `npm publish`, and verify against the registry.

To roll back a half-done release before the push step:

```sh
git tag -d vX.Y.Z
git reset --hard HEAD~1
```

## AI-assisted contributions

Welcome. See [AGENTS.md](AGENTS.md) for an architectural overview that any AI coding assistant can read. Please review agent-generated code before submitting; the maintainer reads it as your work.
