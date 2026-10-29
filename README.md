# Multi-host manager (Paseo plugin)

Design: `docs/design/IMPLEMENTATION.md`.

## Develop
- `npm ci`
- `npm run typecheck`, `npm run lint`, `npm test`
- `npm run pack:check` lists the files the npm package would contain (must include `npm-shrinkwrap.json` and `OVERVIEW.md`, not `testenv`, `docs` or `.local`).
- Integration tests need the two-host test environment: `node testenv/up.mjs`, then `npm run test:integration`, then `node testenv/down.mjs`. See `testenv/` (`npm ci` there first).
- Test an install like a registry install: `npm pack`, then install the tarball on a hub. A directory plugin resolves modules from ancestor `node_modules` and can pass by accident.
