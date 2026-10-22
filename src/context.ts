import {
  checkCancelled,
  type DocumentNode,
  type ScanContext,
  type ScanInput,
} from "./types.js";

export function walk(
  nodes: readonly DocumentNode[],
  visit: (node: DocumentNode, path: number[]) => void,
  signal?: AbortSignal,
): void {
  const stack = nodes
    .map((node, index) => ({ node, path: [index], depth: 0 }))
    .reverse();
  const seen = new Set<DocumentNode>();
  while (stack.length) {
    checkCancelled(signal);
    const { node, path, depth } = stack.pop()!;
    if (depth > 100 || seen.has(node))
      throw new Error("Invalid or excessively nested document tree");
    seen.add(node);
    visit(node, path);
    for (let i = (node.content?.length ?? 0) - 1; i >= 0; i--)
      stack.push({
        node: node.content![i],
        path: [...path, i],
        depth: depth + 1,
      });
  }
}

function alpha(value: number): string {
  let result = "";
  for (let n = Math.max(1, value); n > 0; n = Math.floor((n - 1) / 26))
    result = String.fromCharCode(65 + ((n - 1) % 26)) + result;
  return result;
}
const string = (value: unknown): string =>
  typeof value === "string" ? value : "";

export function createScanContext(
  input: ScanInput,
  options: { signal?: AbortSignal } = {},
): ScanContext {
  const ctx: ScanContext = {
    chapters: [],
    contents: Object.create(null),
    images: [],
    tables: [],
    equations: [],
  };
  const ids = new Set<string>();
  let equation = 0;
  for (const [index, chapter] of input.chapters.entries()) {
    checkCancelled(options.signal);
    if (!chapter.id || ids.has(chapter.id))
      throw new Error("Chapter IDs must be nonempty and unique");
    ids.add(chapter.id);
    ctx.chapters.push({
      id: chapter.id,
      title: chapter.title ?? `Chapter ${index + 1}`,
    });
    const content = [...chapter.content];
    ctx.contents[chapter.id] = content;
    let image = 0,
      table = 0,
      heading = 0;
    const attachment = chapter.attachment ?? chapter.id === "attachment";
    walk(
      content,
      (node, path) => {
        if (node.type === "heading" && node.attrs?.level === 1) heading++;
        if (!["imageFigure", "figureTable", "blockMath"].includes(node.type))
          return;
        const prefix = attachment
          ? alpha(heading)
          : (chapter.numbering ?? chapter.id);
        const pos =
          node.type === "imageFigure"
            ? ++image
            : node.type === "figureTable"
              ? ++table
              : ++equation;
        const caption =
          node.type === "figureTable" ? node.content?.[0] : node.content?.[1];
        const graph = {
          id: string(node.attrs?.id),
          chapterId: chapter.id,
          path,
          text: node.type === "blockMath" ? [] : (caption?.content ?? []),
          pos,
          numbering:
            node.type === "blockMath" ? String(pos) : `${prefix}.${pos}`,
        };
        if (node.type === "imageFigure")
          ctx.images.push({
            ...graph,
            imgSrc: string(
              node.content?.find((child) => child.type === "image")?.attrs?.src,
            ),
          });
        else if (node.type === "figureTable") ctx.tables.push(graph);
        else ctx.equations.push({ ...graph, latex: string(node.attrs?.latex) });
      },
      options.signal,
    );
  }
  return ctx;
}
