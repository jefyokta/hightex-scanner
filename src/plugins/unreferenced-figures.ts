import { alpha, walk } from "../context.js";
import type { FigureGraph, HeadingGraph, ScanDiagnostic } from "../types.js";
import { definePlugin } from "./types.js";

const REF_TO_KIND = {
  imageFigure: "images",
  figureTable: "tables",
  equation: "equations",
  head: "headings",
} as const;

const LABELS = {
  images: "Gambar",
  tables: "Tabel",
  equations: "Persamaan",
  headings: "Lampiran",
} as const;

export const unreferencedFigures = definePlugin({
  id: "unreferenced-figures",
  version: "2.0.0",
  label: "Checking figure references",
  async run(ctx, { signal }) {
    const referred = {
      images: new Set<string>(),
      tables: new Set<string>(),
      equations: new Set<string>(),
      headings: new Set<string>(),
    };
    const attachments = new Set<string>();
    const headings: HeadingGraph[] = [];
    for (const { id, attachment } of ctx.chapters) {
      const isAttachment = attachment ?? id === "attachment";
      if (isAttachment) attachments.add(id);
      let heading = 0;
      walk(
        ctx.contents[id] ?? [],
        (node, path) => {
          if (
            isAttachment &&
            node.type === "heading" &&
            node.attrs?.level === 1
          ) {
            heading++;
            headings.push({
              id: typeof node.attrs.id === "string" ? node.attrs.id : "",
              chapterId: id,
              text: node.content ?? [],
              pos: heading,
              numbering: String(heading),
              path,
              level: 1,
            });
          }
          if (
            node.type !== "refComponent" ||
            typeof node.attrs?.link !== "string"
          )
            return;
          if (!Object.hasOwn(REF_TO_KIND, String(node.attrs.ref))) return;
          const kind = REF_TO_KIND[node.attrs.ref as keyof typeof REF_TO_KIND];
          if (kind) referred[kind].add(node.attrs.link);
        },
        signal,
      );
    }
    return {
      images: ctx.images.filter(
        (x) =>
          !attachments.has(x.chapterId) &&
          (!x.id || !referred.images.has(x.id)),
      ),
      tables: ctx.tables.filter(
        (x) =>
          !attachments.has(x.chapterId) &&
          (!x.id || !referred.tables.has(x.id)),
      ),
      equations: ctx.equations.filter(
        (x) =>
          !attachments.has(x.chapterId) &&
          (!x.id || !referred.equations.has(x.id)),
      ),
      headings: headings.filter((x) => !x.id || !referred.headings.has(x.id)),
    };
  },
  diagnostics(result) {
    return (Object.keys(result) as (keyof typeof result)[]).flatMap((kind) =>
      result[kind].map(
        (figure: FigureGraph): ScanDiagnostic => ({
          code: "unreferenced_figure",
          severity: "warning",
          pluginId: "unreferenced-figures",
          chapterId: figure.chapterId,
          ...(figure.id ? { nodeId: figure.id } : {}),
          path: figure.path,
          message: `${LABELS[kind]} ${kind === "headings" ? alpha(figure.pos) : figure.numbering} belum dirujuk dalam teks`,
        }),
      ),
    );
  },
});
