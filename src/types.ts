/** Structural JSON contract compatible with Tiptap content, without editor dependencies. */
export interface DocumentNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: {
    type: string;
    attrs?: Record<string, unknown>;
    [key: string]: unknown;
  }[];
  content?: DocumentNode[];
  [key: string]: unknown;
}

export interface ScanChapter {
  id: string;
  title?: string;
  content: readonly DocumentNode[];
  /** Optional display number; fallback is the chapter ID. */
  numbering?: string;
  attachment?: boolean;
}
export interface ScanInput {
  chapters: readonly ScanChapter[];
}
export interface FigureGraph {
  id: string;
  chapterId: string;
  text: DocumentNode[];
  pos: number;
  numbering: string;
  path: number[];
}
export interface ImageGraph extends FigureGraph {
  imgSrc: string;
}
export interface TableGraph extends FigureGraph {}
export interface EquationGraph extends FigureGraph {
  latex: string;
}
export interface HeadingGraph extends FigureGraph {
  level: number;
}
export interface ScanContext {
  chapters: { id: string; title: string; attachment?: boolean }[];
  contents: Record<string, DocumentNode[]>;
  images: ImageGraph[];
  tables: TableGraph[];
  equations: EquationGraph[];
}
export interface ScanRange {
  from: number;
  to: number;
}
export interface ScanDiagnostic {
  code: string;
  severity: "warning" | "error";
  pluginId: string;
  message: string;
  chapterId?: string;
  /** Target node's attrs.id, when present. */
  nodeId?: string;
  path?: number[];
  paragraph?: number;
  /** UTF-16 offsets within the target node's content; `to` is exclusive. */
  range?: ScanRange;
}
export interface Plugin<Id extends string = string, Result = unknown> {
  id: Id;
  version: string;
  label: string;
  run(
    ctx: ScanContext,
    options: { signal?: AbortSignal },
  ): Result | Promise<Result>;
  diagnostics?(result: Result): readonly ScanDiagnostic[];
}
export type PluginResults<P extends readonly Plugin[]> = {
  [K in P[number] as K["id"]]: Awaited<ReturnType<K["run"]>>;
};
export type ScanEvent<P extends readonly Plugin[] = readonly Plugin[]> =
  | { type: "progress"; id: P[number]["id"]; label: string }
  | {
      [K in P[number] as K["id"]]: {
        type: "result";
        id: K["id"];
        data: Awaited<ReturnType<K["run"]>>;
        diagnostics: readonly ScanDiagnostic[];
      };
    }[P[number]["id"]]
  | { type: "error"; id: string; message: string }
  | { type: "cancelled" }
  | { type: "done" };
export interface ScanReport<Results = Record<string, unknown>> {
  scannerVersion: string;
  status: "completed" | "failed" | "cancelled";
  complete: boolean;
  plugins: { id: string; version: string }[];
  completed: string[];
  errors: { pluginId: string; message: string }[];
  results: Partial<Results>;
  diagnostics: ScanDiagnostic[];
}

export class ScanCancelledError extends Error {
  constructor() {
    super("Scan cancelled");
    this.name = "ScanCancelledError";
  }
}
export function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ScanCancelledError();
}
