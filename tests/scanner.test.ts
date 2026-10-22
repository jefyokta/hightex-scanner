import { describe, expect, test } from "bun:test";
import {
  createScanContext,
  definePlugin,
  plugins,
  runScan,
  scan,
  type DocumentNode,
} from "../src/index.js";

const paragraph = (text: string): DocumentNode => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
const figure = (id: string): DocumentNode => ({
  type: "imageFigure",
  attrs: { id },
  content: [
    { type: "image", attrs: { src: "image-1" } },
    { type: "figcaption", content: [{ type: "text", text: "Caption" }] },
  ],
});
const context = (content: DocumentNode[] = []) =>
  createScanContext({ chapters: [{ id: "1", content }] });

describe("standalone scanner", () => {
  test("equation numbering continues across chapters like the desktop document", () => {
    const ctx = createScanContext({
      chapters: [
        { id: "1", content: [{ type: "blockMath", attrs: { id: "eq1" } }] },
        { id: "2", content: [{ type: "blockMath", attrs: { id: "eq2" } }] },
      ],
    });
    expect(ctx.equations.map((item) => item.numbering)).toEqual(["1", "2"]);
    expect(ctx.equations.map((item) => item.pos)).toEqual([1, 2]);
  });
  test("extracts graphs from JSON with captions, paths and equation reference semantics", async () => {
    const ctx = context([
      figure("fig"),
      {
        type: "figureTable",
        attrs: { id: "tbl" },
        content: [
          { type: "figcaption", content: [{ type: "text", text: "Table" }] },
        ],
      },
      { type: "blockMath", attrs: { id: "eq", latex: "x=1" } },
      {
        type: "paragraph",
        content: [
          { type: "refComponent", attrs: { ref: "imageFigure", link: "fig" } },
          { type: "refComponent", attrs: { ref: "equation", link: "eq" } },
        ],
      },
    ]);
    expect(ctx.images[0]).toMatchObject({
      id: "fig",
      numbering: "1.1",
      imgSrc: "image-1",
      path: [0],
    });
    expect(ctx.images[0].text[0].text).toBe("Caption");
    expect(ctx.equations[0].latex).toBe("x=1");
    const report = await runScan(ctx);
    expect(report.results["unreferenced-figures"]?.images).toHaveLength(0);
    expect(report.results["unreferenced-figures"]?.equations).toHaveLength(0);
    expect(report.results["unreferenced-figures"]?.tables).toHaveLength(1);
    expect(report.diagnostics[0]).toMatchObject({
      code: "unreferenced_figure",
      chapterId: "1",
      path: [1],
    });
  });

  test("numbers attachment figures with heading letters and retains nested paths", () => {
    const ctx = createScanContext({
      chapters: [
        {
          id: "attachment",
          content: [
            { type: "heading", attrs: { level: 1 } },
            figure("a"),
            { type: "heading", attrs: { level: 1 } },
            { type: "blockquote", content: [figure("b")] },
          ],
        },
      ],
    });
    expect(ctx.images.map((x) => x.numbering)).toEqual(["A.1", "B.2"]);
    expect(ctx.images[1].path).toEqual([3, 0]);
  });

  test("finds punctuation in nested paragraphs and skips code and inline code", async () => {
    const report = await runScan(
      context([
        { type: "blockquote", content: [paragraph("Ada  spasi ,ini!!")] },
        {
          type: "codeBlock",
          content: [{ type: "text", text: "ignore  this!!" }],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "ignore  inline!!",
              marks: [{ type: "code" }],
            },
          ],
        },
      ]),
    );
    expect(report.results.punctuation).toHaveLength(4);
    expect(report.complete).toBe(true);
    expect(report.status).toBe("completed");
    expect(report.diagnostics.every((x) => x.paragraph === 1)).toBe(true);
  });

  test("events retain progress/result/done order and custom results remain typed", async () => {
    const custom = definePlugin({
      id: "count",
      version: "1",
      label: "Count",
      run: (ctx) => ctx.chapters.length,
    });
    const events = [];
    for await (const event of scan([custom] as const, context()))
      events.push(event);
    expect(events.map((x) => x.type)).toEqual(["progress", "result", "done"]);
    const report = await runScan(context(), { plugins: [custom] as const });
    expect(report.results.count).toBe(1);
    expect(report.plugins).toEqual([{ id: "count", version: "1" }]);
  });

  test("plugin failure marks the report incomplete and remaining plugins still run", async () => {
    const broken = definePlugin({
      id: "broken",
      version: "1",
      label: "Broken",
      run() {
        throw new Error("failed");
      },
    });
    const report = await runScan(context([paragraph("A  B")]), {
      plugins: [broken, ...plugins],
    });
    expect(report.status).toBe("failed");
    expect(report.complete).toBe(false);
    expect(report.errors).toEqual([{ pluginId: "broken", message: "failed" }]);
    expect(report.completed).toEqual(["unreferenced-figures", "punctuation"]);
  });

  test.each([new Map(), /x/, new Error("x"), undefined, NaN, BigInt(1)])(
    "rejects non-JSON plugin output %p",
    async (value) => {
      const custom = definePlugin({
        id: "bad",
        version: "1",
        label: "Bad",
        run: () => value,
      });
      const report = await runScan(context(), { plugins: [custom] });
      expect(report.status).toBe("failed");
      expect(JSON.parse(JSON.stringify(report)).complete).toBe(false);
    },
  );

  test("rejects invalid diagnostic metadata", async () => {
    const custom = definePlugin({
      id: "bad",
      version: "1",
      label: "Bad",
      run: () => 1,
      diagnostics: () => [
        { code: "x", severity: "warning", pluginId: "wrong", message: "x" },
      ],
    });
    expect((await runScan(context(), { plugins: [custom] })).status).toBe(
      "failed",
    );
  });

  test("pre-aborted and mid-run cancellation never produce complete reports", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(
      (await runScan(context(), { signal: controller.signal })).status,
    ).toBe("cancelled");
    const during = new AbortController();
    const cancel = definePlugin({
      id: "cancel",
      version: "1",
      label: "Cancel",
      run: () => {
        during.abort();
        return 1;
      },
    });
    const report = await runScan(context(), {
      plugins: [cancel, ...plugins],
      signal: during.signal,
    });
    expect(report.complete).toBe(false);
    expect(report.status).toBe("cancelled");
    expect(report.completed).toEqual([]);
  });

  test("duplicate plugin and chapter IDs are rejected; prototype-like IDs are safe", async () => {
    await expect(
      runScan(context(), { plugins: [plugins[0], plugins[0]] }),
    ).rejects.toThrow("unique");
    expect(() =>
      createScanContext({
        chapters: [
          { id: "a", content: [] },
          { id: "a", content: [] },
        ],
      }),
    ).toThrow("unique");
    const ctx = createScanContext({
      chapters: [{ id: "__proto__", content: [] }],
    });
    expect(ctx.contents["__proto__"]).toEqual([]);
    const custom = definePlugin({
      id: "__proto__",
      version: "1",
      label: "Safe",
      run: () => 2,
    });
    expect(
      (await runScan(ctx, { plugins: [custom] })).results["__proto__"],
    ).toBe(2);
  });

  test("cycles are rejected and identical inputs produce identical JSON reports", async () => {
    const node: DocumentNode = { type: "paragraph", content: [] };
    node.content!.push(node);
    expect(() => context([node])).toThrow("tree");
    const ctx = context([figure("missing"), paragraph("A  B")]);
    expect(JSON.stringify(await runScan(ctx))).toBe(
      JSON.stringify(await runScan(ctx)),
    );
  });
});
