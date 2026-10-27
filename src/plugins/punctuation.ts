import {
  checkCancelled,
  type DocumentNode as JSONContent,
  type ScanRange,
} from "../types.js";
import { definePlugin } from "./types.js";

function textOf(node: JSONContent): string {
  return node.type === "text"
    ? (node.text ?? "")
    : (node.content ?? []).map(textOf).join("").trim();
}

const CONTEXT = 30;
const FILL = "▮";
const SKIP_NODES = new Set(["codeBlock"]);
const INLINE_ATOMS = new Set([
  "refComponent",
  "cite",
  "variable",
  "mathInline",
  "dots",
]);

export type PunctuationIssue = {
  chapter: { index: number; title: string; id: string };
  paragraph: number;
  nodeId?: string;
  path: number[];
  range: ScanRange;
  message: string;
  excerpt: { before: string; match: string; after: string };
};

type Rule = { pattern: RegExp; message: (m: string) => string };

const rules: Rule[] = [
  { pattern: / {2,}/g, message: () => "Spasi ganda" },
  {
    pattern: /\s+[,.;:!?]/g,
    message: (m) => `Ada spasi sebelum tanda baca "${m.trim()}"`,
  },
  {
    pattern: /[,;:](?=\p{L})/gu,
    message: (m) => `Tidak ada spasi setelah "${m}"`,
  },
  { pattern: /([,;:!?])\1+/g, message: (m) => `Tanda baca berulang "${m}"` },
  {
    pattern: /(?<!\.)\.\.(?!\.)|\.{4,}/g,
    message: (m) => `Jumlah titik tidak wajar "${m}"`,
  },
];

type Paragraph = {
  text: string;
  checkable: string;
  offsets: number[];
  nodeId?: string;
  path: number[];
};

function inlineSize(node: JSONContent): number {
  if (node.type === "text") return node.text?.length ?? 0;
  if (node.type === "hardBreak" || INLINE_ATOMS.has(node.type)) return 1;
  return node.content
    ? 2 + node.content.reduce((sum, child) => sum + inlineSize(child), 0)
    : 1;
}

function paragraphOf(node: JSONContent, path: number[]): Paragraph {
  let text = "";
  let checkable = "";
  let offset = 0;
  const offsets: number[] = [];

  for (const child of node.content ?? []) {
    if (child.type === "text") {
      const raw = child.text ?? "";
      const isCode = child.marks?.some((m) => m.type === "code");
      text += raw;
      checkable += isCode ? FILL.repeat(raw.length) : raw;
      for (let i = 0; i < raw.length; i++) offsets.push(offset + i);
      offset += raw.length;
    } else if (child.type === "hardBreak") {
      text += "\n";
      checkable += "\n";
      offsets.push(offset++);
    } else {
      const raw = textOf(child) || FILL;
      text += raw;
      checkable += FILL.repeat(raw.length);
      for (let i = 0; i < raw.length; i++) offsets.push(offset);
      offset += inlineSize(child);
    }
  }

  const start = text.length - text.trimStart().length;
  const end = text.trimEnd().length;
  return {
    text: text.slice(start, end),
    checkable: checkable.slice(start, end),
    offsets: offsets.slice(start, end),
    ...(typeof node.attrs?.id === "string" && node.attrs.id
      ? { nodeId: node.attrs.id }
      : {}),
    path,
  };
}

function collectParagraphs(
  nodes: JSONContent[],
  out: Paragraph[] = [],
  signal?: AbortSignal,
  parentPath: number[] = [],
): Paragraph[] {
  for (const [index, node] of nodes.entries()) {
    checkCancelled(signal);
    if (node.type && SKIP_NODES.has(node.type)) continue;

    const path = [...parentPath, index];
    if (node.type === "paragraph") out.push(paragraphOf(node, path));
    else if (node.content?.length)
      collectParagraphs(node.content, out, signal, path);
  }
  return out;
}

function excerptOf(text: string, index: number, length: number) {
  const start = Math.max(0, index - CONTEXT);
  const end = Math.min(text.length, index + length + CONTEXT);

  return {
    before: (start > 0 ? "…" : "") + text.slice(start, index),
    match: text.slice(index, index + length),
    after: text.slice(index + length, end) + (end < text.length ? "…" : ""),
  };
}

export const punctuation = definePlugin({
  id: "punctuation",
  version: "1.1.0",
  label: "Tanda baca",

  async run(ctx, { signal }) {
    const issues: PunctuationIssue[] = [];

    ctx.chapters.forEach(({ id, title }, ci) => {
      const chapter = { index: ci + 1, title, id };
      const paragraphs = collectParagraphs(ctx.contents[id] ?? [], [], signal);

      paragraphs.forEach(({ text, checkable, offsets, nodeId, path }, pi) => {
        if (!text) return;

        for (const rule of rules) {
          for (const m of checkable.matchAll(rule.pattern)) {
            issues.push({
              chapter,
              paragraph: pi + 1,
              ...(nodeId ? { nodeId } : {}),
              path,
              range: {
                from: offsets[m.index],
                to: offsets[m.index + m[0].length - 1] + 1,
              },
              message: rule.message(m[0]),
              excerpt: excerptOf(text, m.index, m[0].length),
            });
          }
        }
      });
    });

    return issues;
  },
  diagnostics(issues) {
    return issues.map((issue) => ({
      code: "punctuation",
      severity: "warning" as const,
      pluginId: "punctuation",
      chapterId: issue.chapter.id,
      ...(issue.nodeId ? { nodeId: issue.nodeId } : {}),
      path: issue.path,
      range: issue.range,
      paragraph: issue.paragraph,
      message: issue.message,
    }));
  },
});
