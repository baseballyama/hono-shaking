import type { FrameworkAdapter, TransformedScript } from "./adapter.ts";
import { importPeer } from "./peer-resolver.ts";

interface ScriptBlock {
  content: string;
  loc: { start: { line: number; column: number; offset: number } };
  lang?: string;
}

interface SfcDescriptor {
  script: ScriptBlock | null;
  scriptSetup: ScriptBlock | null;
}

type VueParseFn = (source: string, options: { filename: string }) => { descriptor: SfcDescriptor };

/**
 * Build a Vue adapter if `@vue/compiler-sfc` is installed. We pull only
 * `<script>` and `<script setup>` blocks out of the SFC — `<template>` and
 * `<style>` are irrelevant for hc detection — and concatenate them, tracking
 * which original line each generated line came from.
 */
export const createVueAdapter = async (): Promise<FrameworkAdapter | null> => {
  let parse: VueParseFn;
  try {
    const mod = await importPeer("@vue/compiler-sfc");
    if (mod == null || typeof mod !== "object") return null;
    const fn = (mod as Record<string, unknown>).parse;
    if (typeof fn !== "function") return null;
    parse = fn as VueParseFn;
  } catch (err) {
    if (process.env.HONO_SHAKING_DEBUG != null) {
      console.warn(`vue adapter unavailable: ${String(err)}`);
    }
    return null;
  }

  return {
    name: "vue",
    extensions: ["vue"],
    matches: (file) => file.endsWith(".vue"),
    transform: (file, content): TransformedScript | null => {
      let descriptor: SfcDescriptor;
      try {
        descriptor = parse(content, { filename: file }).descriptor;
      } catch (err) {
        console.warn(`hono-shaking: vue parse failed for ${file}: ${String(err)}`);
        return null;
      }

      // Stash one entry per generated line so we can answer "where did this
      // line come from in the original SFC?" without re-parsing.
      const generatedToOriginalLine: number[] = [];
      const generatedLines: string[] = [];

      const appendBlock = (block: ScriptBlock | null): void => {
        if (block == null) return;
        const lines = block.content.split(/\r?\n/);
        const startLine = block.loc.start.line;
        for (let i = 0; i < lines.length; i++) {
          generatedToOriginalLine.push(startLine + i);
          generatedLines.push(lines[i] ?? "");
        }
      };

      appendBlock(descriptor.script);
      appendBlock(descriptor.scriptSetup);

      if (generatedLines.length === 0) return null;

      return {
        code: generatedLines.join("\n"),
        resolvePosition: (line, column) => {
          const idx = line - 1;
          const origLine = generatedToOriginalLine[idx];
          if (origLine == null) return null;
          // Columns are not adjusted: we concatenate script bodies verbatim,
          // so column N in the generated code is column N in the original.
          return { line: origLine, column: column + 1 };
        },
      };
    },
  };
};
