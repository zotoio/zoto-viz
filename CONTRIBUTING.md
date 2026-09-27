# Contributing

See [docs/contributing.md](docs/contributing.md) (or the Contributing page on the docs site).

Each regression test must prove it catches its bug: the PR body shows the test red with the fix reverted and green with it applied. See [docs/revert-proofs-archive.md](docs/revert-proofs-archive.md) for catch-up proof locations and [docs/contributing.md](docs/contributing.md#regression-tests) for the runner workflow.

```bash
cd web && pnpm test && pnpm build
.venv/bin/pytest tests
cd docs && pnpm install && pnpm build
```
