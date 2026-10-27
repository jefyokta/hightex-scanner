import type { ScanDiagnostic, ScanRange } from "./types.js";

/** Structural subset of a ProseMirror/Tiptap node; no editor dependency is needed. */
export interface DiagnosticEditorNode {
  readonly type: { readonly name: string };
  readonly attrs: Readonly<Record<string, unknown>>;
  readonly nodeSize: number;
  readonly childCount: number;
  readonly isLeaf: boolean;
  child(index: number): DiagnosticEditorNode;
}

export interface DiagnosticTarget extends ScanRange {
  nodeId?: string;
  nodeType: string;
  path: number[];
}

type LocatedNode = { node: DiagnosticEditorNode; pos: number; path: number[] };

function findById(
  parent: DiagnosticEditorNode,
  id: string,
  start = 0,
  path: number[] = [],
): LocatedNode | undefined {
  let pos = start;
  for (let index = 0; index < parent.childCount; index++) {
    const node = parent.child(index);
    const childPath = [...path, index];
    if (node.attrs.id === id) return { node, pos, path: childPath };
    const nested = findById(node, id, pos + 1, childPath);
    if (nested) return nested;
    pos += node.nodeSize;
  }
}

function findByPath(
  doc: DiagnosticEditorNode,
  path: readonly number[],
): LocatedNode | undefined {
  if (!path.length) return;
  let node = doc;
  let pos = -1;
  for (const index of path) {
    if (!Number.isInteger(index) || index < 0 || index >= node.childCount)
      return;
    pos++;
    for (let i = 0; i < index; i++) pos += node.child(i).nodeSize;
    node = node.child(index);
  }
  return { node, pos, path: [...path] };
}

/**
 * Resolve against the live editor document of diagnostic.chapterId, after navigation.
 * IDs take priority over snapshot paths. A missing ID returns undefined rather
 * than selecting another node at a stale path. ID-less nodes use their scan path.
 */
export function resolveDiagnosticTarget(
  doc: DiagnosticEditorNode,
  diagnostic: Pick<ScanDiagnostic, "nodeId" | "path" | "range">,
): DiagnosticTarget | undefined {
  const found = diagnostic.nodeId
    ? findById(doc, diagnostic.nodeId)
    : diagnostic.path
      ? findByPath(doc, diagnostic.path)
      : undefined;
  if (!found) return;

  const { node, pos, path } = found;
  let from = pos;
  let to = pos + node.nodeSize;
  if (diagnostic.range) {
    const range = diagnostic.range;
    if (
      node.isLeaf ||
      !Number.isInteger(range.from) ||
      !Number.isInteger(range.to) ||
      range.from < 0 ||
      range.to < range.from ||
      range.to > node.nodeSize - 2
    )
      return;
    from = pos + 1 + range.from;
    to = pos + 1 + range.to;
  }
  return {
    ...(typeof node.attrs.id === "string" && node.attrs.id
      ? { nodeId: node.attrs.id }
      : {}),
    nodeType: node.type.name,
    path,
    from,
    to,
  };
}
