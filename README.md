# @hightex/scanner

A HighTex document validation engine that runs directly on a server or in a browser bundle. It does not depend on React, Electron, a database, or the Tiptap runtime, and it does not create workers.

The package provides ESM JavaScript and TypeScript declarations for Node.js 20+, Bun, and browser bundlers. It has no runtime dependencies. The manifest currently uses `private: true`; registry publishing is not enabled.

## Usage

```js
import { createScanContext, runScan } from "@hightex/scanner";

const context = createScanContext({
  chapters: [
    {
      id: "1",
      title: "Introduction",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Two  spaces." }],
        },
      ],
    },
  ],
});
const report = await runScan(context);
console.log(JSON.stringify(report));
```

The model returned by `parseHighTexV2()` from `@hightex/importer` can be passed directly to `createScanContext(model)`. Neither package depends on the other. The host can supply chapter titles, ordering, `numbering`, and `attachment` metadata before building the context.

## Context contract

Input contains `chapters: { id, title?, content, numbering?, attachment? }[]`. Chapter order is preserved; IDs must be nonempty and unique. Content uses Tiptap-shaped JSON (`type`, `attrs`, `text`, `marks`, `content`) through local structural types, without importing the editor.

`createScanContext()` traverses JSON to derive `imageFigure`, `figureTable`, and `blockMath` graphs. Each graph includes its ID, caption, chapter ID, numbering, and node path. Chapter numbers default to local IDs. The chapter ID `attachment` enables attachment numbering by default; attachment headings use letters, falling back to `A` before the first level-one heading.

Image and table counters continue throughout each chapter. Equation numbering continues across the entire document, matching the desktop scanner. Input content is not mutated; do not modify it during a scan. Cycles, reused node objects at multiple tree positions, and trees deeper than 100 levels are rejected.

## Built-in plugins and reports

- `punctuation` (v1.1): repeated spaces, whitespace before punctuation, missing spaces after punctuation, repeated punctuation, and unusual dot counts. Code blocks and inline code are skipped. Paragraph positions start at 1. Each issue and diagnostic includes the paragraph's `nodeId` when available, its `path`, and the exact `range` of the offending characters within the paragraph. Built-in messages currently use Indonesian.
- `unreferenced-figures` (v2): figures not referenced through `refComponent`. Reference types are `imageFigure`, `figureTable`, and `equation` for `blockMath` nodes. Images, tables, and equations in attachment chapters are automatically excluded from findings; their graphs remain available in the context. Level-one attachment headings must be referenced with `ref: "head"`. Unreferenced attachment headings appear in the result's `headings` array and emit `unreferenced_figure` diagnostics, including when the heading has no ID. Other headings are ignored. References are collected from every chapter, including attachments.

Attachment status is retained in `context.chapters[].attachment`. It follows the input's `attachment` flag, defaulting to `true` only for the chapter ID `attachment`; use `attachment: true` for other IDs such as `document.attachment`. Explicit `attachment: false` overrides the default. Heading findings include the heading text, level, chapter ID, node path, and a chapter-local one-based position and numeric `numbering` string. Consumers should include `headings` alongside `images`, `tables`, and `equations` when displaying or counting findings.

Unreferenced-figure diagnostic messages include the Indonesian label and display number, such as `Gambar 2.1 belum dirujuk dalam teks`, `Tabel 2.1 belum dirujuk dalam teks`, `Persamaan 3 belum dirujuk dalam teks`, or `Lampiran A belum dirujuk dalam teks`. Attachment display numbers use letters (`A`–`Z`, `AA`, …); heading result `numbering` values remain numeric strings.

Both emit `warning` diagnostics. These plugins do not cover every academic rule, PDF rendering, WebP decoding, or every citation/asset target. Add host plugins for additional validation rules.

`runScan()` returns:

```ts
{
  scannerVersion: string;
  status: "completed" | "failed" | "cancelled";
  complete: boolean;
  plugins: { id: string; version: string }[];
  completed: string[];
  errors: { pluginId: string; message: string }[];
  results: Partial<ScanResults>;
  diagnostics: ScanDiagnostic[];
}
```

Diagnostics contain `code`, `severity`, `pluginId`, `message`, and optional `chapterId`, `nodeId`, `path`, `paragraph`, or `range` locations. Both built-in plugins include `nodeId` when the target has a nonempty string `attrs.id`; punctuation targets the paragraph, and unreferenced figures target the figure or attachment heading. Missing node IDs are omitted, with `path` still available. Findings do not make execution fail: `complete: true` means every selected plugin finished. The host decides whether to accept a document based on its severity, code, or plugin-result policy.

A plugin failure produces `failed` and an incomplete report while allowing later plugins to run. Cancellation produces `cancelled` and always marks the report incomplete. Duplicate plugin IDs or missing versions are configuration errors that reject the Promise.

## Locate a finding in the desktop editor

Punctuation diagnostics identify both the paragraph and the erroneous character range:

```ts
{
  pluginId: "punctuation",
  code: "punctuation",
  severity: "warning",
  message: "Spasi ganda",
  chapterId: "document.1",
  nodeId: "paragraph-1",
  path: [0],
  paragraph: 1,
  range: { from: 3, to: 5 }, // The two spaces in "Ada  spasi".
}
```

`range` uses zero-based UTF-16 offsets within the target node's content, before trimming, with an exclusive `to`. These are not absolute editor positions. Line breaks and HighTex inline atoms (`refComponent`, `cite`, `variable`, `mathInline`, and `dots`) occupy one editor position each; formatting marks do not add positions. Masked inline content is not checked for punctuation. `path` consists of zero-based child indexes starting at the chapter's content. A graph's `pos` remains its numbering counter, not an editor position.

`resolveDiagnosticTarget(editor.state.doc, diagnostic)` converts a diagnostic into an absolute ProseMirror/Tiptap range without importing an editor runtime. The return value contains `{ nodeId?, nodeType, path, from, to }`. IDs are resolved against the live editor tree, so preceding insertions do not invalidate a node's location. If a specified ID no longer exists, the helper returns `undefined`; only ID-less diagnostics use the snapshot path. Missing paths, out-of-bounds paths, and ranges that no longer fit also return `undefined`. With no character `range`, the target covers the entire node.

In hightex-desktop, retain `event.diagnostics` in `useScan()` and pass the clicked diagnostic to the navigation handler. Switch to `diagnostic.chapterId` first, including its document/version route, and wait for that chapter's editor to load before resolving the target. The helper does not change chapters or editor state.

```tsx
import { resolveDiagnosticTarget } from "@hightex/scanner";

// Run after the diagnostic's chapter has loaded in the editor.
const target = resolveDiagnosticTarget(editor.state.doc, diagnostic);
if (target) {
  if (diagnostic.range) {
    editor.chain()
      .focus()
      .setTextSelection({ from: target.from, to: target.to })
      .scrollIntoView()
      .run();
  } else {
    editor.chain()
      .focus()
      .setNodeSelection(target.from)
      .scrollIntoView()
      .run();
  }
}
```

Node IDs must be unique within a chapter. Character ranges and ID-less paths describe the scanned snapshot; rescan after editing the affected content to refresh highlights. The helper is also available for custom diagnostics that follow this location contract.

## Custom plugins and events

```js
import { definePlugin, runScan, scan } from "@hightex/scanner";

const count = definePlugin({
  id: "chapter-count",
  version: "1.0.0",
  label: "Chapter count",
  run: (context) => context.chapters.length,
});
const report = await runScan(context, { plugins: [count] });
for await (const event of scan([count], context)) {
  // progress → result/error → done; cancellation ends with cancelled.
  console.log(event);
}
```

A plugin may provide `diagnostics(result)`. Results and diagnostics must contain ordinary JSON values. Map, RegExp, Error, Date, undefined, BigInt, nonfinite numbers, functions, and cycles are rejected as plugin failures. Results are copied before being returned. Public types preserve literal plugin IDs and custom result types.

`runScan`, `scan`, `createScanContext`, and `walk` accept an AbortSignal. Cancellation is cooperative: asynchronous plugins should honor the signal; synchronous plugins cannot be interrupted from the same event loop. Use host-managed workers or processes for hard deadlines. The library does not fetch data, access the filesystem, or execute plugins found in an archive. Only trusted host code supplies plugins.

## Development

Install Node.js 20+, npm, and Bun, then run:

```sh
npm install
npm run build
npm test
npm run typecheck
```

The package builds independently of the desktop application and the importer.

## Prepare a release version

Run inside this package:

```sh
npm run release:version -- patch
npm run release:version -- minor
npm run release:version -- major
npm run release:version -- 1.0.0
npm run release:version -- preminor --preid=beta
```

The command runs typecheck and tests first, bumps `package.json` and any existing npm lockfile, synchronizes `SCANNER_VERSION`, then rebuilds `dist`. It uses npm's `preversion` and `version` hooks. Keep lifecycle scripts enabled. Bun, pnpm, and Yarn lockfiles require a separate update with their own package manager.

The command prepares files locally without publishing, creating a Git commit/tag, or pushing. If a post-bump build fails, fix the error and run `npm run build` before packing. Built-in plugin versions are independent of the package version and are not changed automatically. See [npm's version lifecycle](https://docs.npmjs.com/cli/v11/commands/npm-version/).

Inspect and package the build:

```sh
npm pack --dry-run
npm pack
```

The `prepack` hook builds and synchronizes version metadata. The `files` allowlist includes `dist` and `README.md`; `.npmignore` lists source, tests, release tooling, configuration, lockfiles, secrets, and other development artifacts. The resulting tarball contains compiled JavaScript, declarations, the README, and package metadata. See [npm's package file rules](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#files).

Registry publishing remains disabled by `private: true`. Enable publishing deliberately in this package's own repository when it is ready for release.
