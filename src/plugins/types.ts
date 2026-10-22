import type { Plugin } from "../types.js";
export const definePlugin = <const Id extends string, Result>(
  plugin: Plugin<Id, Result>,
): Plugin<Id, Result> => plugin;
