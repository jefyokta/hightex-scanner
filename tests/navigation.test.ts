import { expect, test } from "bun:test";
import {
  resolveDiagnosticTarget,
  type DiagnosticEditorNode,
} from "../src/index.js";

function leaf(
  name: string,
  nodeSize: number,
  id?: string,
): DiagnosticEditorNode {
  return {
    type: { name },
    attrs: id ? { id } : {},
    nodeSize,
    childCount: 0,
    isLeaf: true,
    child() {
      throw new Error("Leaf node has no children");
    },
  };
}

function branch(
  name: string,
  children: DiagnosticEditorNode[],
  id?: string,
): DiagnosticEditorNode {
  return {
    type: { name },
    attrs: id ? { id } : {},
    nodeSize: 2 + children.reduce((sum, node) => sum + node.nodeSize, 0),
    childCount: children.length,
    isLeaf: false,
    child: (index) => children[index],
  };
}

const figure = leaf("imageFigure", 1, "fig-1");
const quote = branch("blockquote", [
  branch("paragraph", [leaf("text", 8)], "paragraph-1"),
  branch("paragraph", [leaf("text", 3)]),
]);
const doc = branch("doc", [figure, quote]);

test("resolves the exact punctuation range within a nested paragraph by ID", () => {
  expect(
    resolveDiagnosticTarget(doc, {
      nodeId: "paragraph-1",
      path: [0],
      range: { from: 2, to: 5 },
    }),
  ).toEqual({
    nodeId: "paragraph-1",
    nodeType: "paragraph",
    path: [1, 0],
    from: 5,
    to: 8,
  });
});

test("node IDs continue to locate the target after preceding nodes are inserted", () => {
  const edited = branch("doc", [
    branch("paragraph", [leaf("text", 4)]),
    figure,
    quote,
  ]);
  expect(
    resolveDiagnosticTarget(edited, {
      nodeId: "paragraph-1",
      path: [1, 0],
      range: { from: 2, to: 5 },
    }),
  ).toMatchObject({ path: [2, 0], from: 11, to: 14 });
});

test("figures resolve to their complete node range", () => {
  expect(resolveDiagnosticTarget(doc, { nodeId: "fig-1" })).toEqual({
    nodeId: "fig-1",
    nodeType: "imageFigure",
    path: [0],
    from: 0,
    to: 1,
  });
});

test("ID-less nodes use nested paths without changing the diagnostic", () => {
  const diagnostic = { path: [1, 1], range: { from: 0, to: 3 } };
  expect(resolveDiagnosticTarget(doc, diagnostic)).toEqual({
    nodeType: "paragraph",
    path: [1, 1],
    from: 13,
    to: 16,
  });
  expect(diagnostic).toEqual({ path: [1, 1], range: { from: 0, to: 3 } });
});

test("removed IDs never fall back to an unrelated node at the previous path", () => {
  expect(
    resolveDiagnosticTarget(doc, { nodeId: "deleted", path: [1, 0] }),
  ).toBeUndefined();
  expect(resolveDiagnosticTarget(doc, {})).toBeUndefined();
});

test.each(
  [[], [-1], [2], [1, 99], [1.5], [1, 0, 10]].map((path) => ({ path })),
)("invalid or missing paths return undefined: %p", ({ path }) => {
  expect(resolveDiagnosticTarget(doc, { path })).toBeUndefined();
});

test.each([
  { from: -1, to: 1 },
  { from: 5, to: 2 },
  { from: 0.5, to: 1 },
  { from: 0, to: 9 },
  { from: NaN, to: 1 },
])("invalid or stale text ranges return undefined: %p", (range) => {
  expect(
    resolveDiagnosticTarget(doc, { nodeId: "paragraph-1", range }),
  ).toBeUndefined();
});

test("inline leaf nodes cannot have content-relative diagnostic ranges", () => {
  expect(
    resolveDiagnosticTarget(doc, {
      nodeId: "fig-1",
      range: { from: 0, to: 0 },
    }),
  ).toBeUndefined();
});
