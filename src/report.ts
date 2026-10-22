import {
  plugins as defaultPlugins,
  type ScanResults,
} from "./plugins/index.js";
import { scan } from "./scan.js";
import type {
  Plugin,
  PluginResults,
  ScanContext,
  ScanReport,
} from "./types.js";

export const SCANNER_VERSION = "0.1.0";

export function runScan(
  ctx: ScanContext,
  options?: { signal?: AbortSignal },
): Promise<ScanReport<ScanResults>>;
export function runScan<const P extends readonly Plugin[]>(
  ctx: ScanContext,
  options: { plugins: P; signal?: AbortSignal },
): Promise<ScanReport<PluginResults<P>>>;
export async function runScan(
  ctx: ScanContext,
  options: { plugins?: readonly Plugin[]; signal?: AbortSignal } = {},
): Promise<ScanReport> {
  const selected: readonly Plugin[] = options.plugins ?? defaultPlugins;
  const results: Record<string, unknown> = Object.create(null);
  const report: ScanReport = {
    scannerVersion: SCANNER_VERSION,
    status: "completed",
    complete: false,
    plugins: selected.map(({ id, version }) => ({ id, version })),
    completed: [],
    errors: [],
    results,
    diagnostics: [],
  };
  for await (const event of scan(selected, ctx, options)) {
    if (event.type === "result") {
      results[event.id] = event.data;
      report.completed.push(event.id);
      report.diagnostics.push(...event.diagnostics);
    } else if (event.type === "error") {
      report.status = "failed";
      report.errors.push({ pluginId: event.id, message: event.message });
    } else if (event.type === "cancelled") report.status = "cancelled";
    else if (event.type === "done")
      report.complete = report.errors.length === 0;
  }
  return report;
}
