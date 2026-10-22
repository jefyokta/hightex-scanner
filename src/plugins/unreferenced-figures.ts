import { walk } from "../context.js";
import type { FigureGraph, ScanDiagnostic } from "../types.js";
import { definePlugin } from "./types.js";

const REF_TO_KIND = {
  imageFigure: "images",
  figureTable: "tables",
  equation: "equations",
} as const;

export const unreferencedFigures = definePlugin({
  id: "unreferenced-figures",
  version: "1.0.0",
  label: "Checking figure references",
  async run(ctx, { signal }) {
    const referred = {
      images: new Set<string>(),
      tables: new Set<string>(),
      equations: new Set<string>(),
    };
    for (const { id } of ctx.chapters)
      walk(
        ctx.contents[id] ?? [],
        (node) => {
          if (
            node.type !== "refComponent" ||
            typeof node.attrs?.link !== "string"
          )
            return;
          const kind = REF_TO_KIND[node.attrs.ref as keyof typeof REF_TO_KIND];
          if (kind) referred[kind].add(node.attrs.link);
        },
        signal,
      );
    return {
      images: ctx.images.filter((x) => !x.id || !referred.images.has(x.id)),
      tables: ctx.tables.filter((x) => !x.id || !referred.tables.has(x.id)),
      equations: ctx.equations.filter(
        (x) => !x.id || !referred.equations.has(x.id),
      ),
    };
  },
  diagnostics(result) {
    return Object.entries(result).flatMap(([kind, figures]) =>
      figures.map(
        (figure: FigureGraph): ScanDiagnostic => ({
          code: "unreferenced_figure",
          severity: "warning",
          pluginId: "unreferenced-figures",
          chapterId: figure.chapterId,
          path: figure.path,
          message: `${kind}: ${figure.id || "(missing ID)"} is not referenced`,
        }),
      ),
    );
  },
});
