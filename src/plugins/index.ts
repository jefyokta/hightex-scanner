import { punctuation } from "./punctuation.js";
import { unreferencedFigures } from "./unreferenced-figures.js";
import type { PluginResults, ScanEvent as Event } from "../types.js";
export { punctuation, unreferencedFigures };
export { definePlugin } from "./types.js";
export const plugins = [unreferencedFigures, punctuation] as const;
export type ScanResults = PluginResults<typeof plugins>;
export type DefaultScanEvent = Event<typeof plugins>;
