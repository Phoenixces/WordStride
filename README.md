# WordStride

A cyberpunk English typing trainer. Practice by letter, build speed, and discover word meanings as you type.

Set per-key targets, track your progress, and learn definitions and usage after each correctly submitted word. Progress is saved in your browser.

Built with React, TypeScript, Vite, and plain CSS.

## Quick start

Requires Node.js 20.19+ (or 22.12+ on Node 22).

```sh
npm install
npm run dev
```

## Commands

| Command | Purpose |
| --- | --- |
| `npm test` | Run unit and integration tests |
| `npm run build` | Check types and build to `dist/` |
| `npm run test:e2e` | Run browser tests¹ |
| `npm run data:check` | Verify the English word dataset |
| `npm run data:build` | Regenerate word files from the pinned source |

¹ Run `npx playwright install chromium` once before browser tests.

## References

- Design documents: [Overview](design-docs/01-overview.md) · [Architecture](design-docs/03-architecture.md)
- [English dataset source and licensing](third-party/zxcvbn/SOURCE.md)
- [Free Dictionary API](https://dictionaryapi.dev/) — definitions and usage
