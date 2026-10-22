import {
  checkCancelled,
  ScanCancelledError,
  type Plugin,
  type ScanContext,
  type ScanDiagnostic,
  type ScanEvent,
} from "./types.js";

/** Reject values JSON.stringify would silently lose or convert. */
function jsonValue(
  value: unknown,
  ancestors = new Set<object>(),
  depth = 0,
): void {
  if (depth > 100) throw new Error("Plugin output exceeds maximum depth");
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object")
    throw new Error("Plugin output must contain only JSON values");
  if (ancestors.has(value)) throw new Error("Plugin output contains a cycle");
  const prototype = Object.getPrototypeOf(value);
  if (
    !Array.isArray(value) &&
    prototype !== Object.prototype &&
    prototype !== null
  )
    throw new Error("Plugin output must contain plain objects");
  ancestors.add(value);
  for (const item of Object.values(value))
    jsonValue(item, ancestors, depth + 1);
  ancestors.delete(value);
}

export function validatePlugins(plugins: readonly Plugin[]): void {
  const ids = new Set<string>();
  for (const plugin of plugins) {
    if (!plugin.id || !plugin.version || ids.has(plugin.id))
      throw new Error(
        "Plugins require unique nonempty IDs and explicit versions",
      );
    ids.add(plugin.id);
  }
}

function validateDiagnostics(
  items: readonly ScanDiagnostic[],
  pluginId: string,
): void {
  if (!Array.isArray(items))
    throw new Error("Plugin diagnostics must be an array");
  for (const item of items) {
    if (
      !item ||
      item.pluginId !== pluginId ||
      typeof item.code !== "string" ||
      !item.code ||
      typeof item.message !== "string" ||
      !["warning", "error"].includes(item.severity) ||
      (item.chapterId !== undefined && typeof item.chapterId !== "string") ||
      (item.paragraph !== undefined &&
        (!Number.isInteger(item.paragraph) || item.paragraph < 1)) ||
      (item.path !== undefined &&
        (!Array.isArray(item.path) ||
          item.path.some(
            (x: unknown) =>
              typeof x !== "number" || !Number.isInteger(x) || x < 0,
          )))
    )
      throw new Error("Invalid plugin diagnostic");
  }
}

export async function* scan<const P extends readonly Plugin[]>(
  plugins: P,
  ctx: ScanContext,
  options: { signal?: AbortSignal } = {},
): AsyncGenerator<ScanEvent<P>> {
  validatePlugins(plugins);
  for (const plugin of plugins) {
    if (options.signal?.aborted) {
      yield { type: "cancelled" };
      return;
    }
    yield { type: "progress", id: plugin.id, label: plugin.label };
    try {
      checkCancelled(options.signal);
      const data = await plugin.run(ctx, options);
      checkCancelled(options.signal);
      const diagnostics = plugin.diagnostics?.(data) ?? [];
      jsonValue(data);
      jsonValue(diagnostics);
      validateDiagnostics(diagnostics, plugin.id);
      // Each plugin's result is created from that same plugin; the generic mapped
      // union cannot retain this correlation inside a heterogeneous loop.
      yield JSON.parse(
        JSON.stringify({ type: "result", id: plugin.id, data, diagnostics }),
      ) as ScanEvent<P>;
    } catch (error) {
      if (options.signal?.aborted || error instanceof ScanCancelledError) {
        yield { type: "cancelled" };
        return;
      }
      yield {
        type: "error",
        id: plugin.id,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
  if (options.signal?.aborted) {
    yield { type: "cancelled" };
    return;
  }
  yield { type: "done" };
}
