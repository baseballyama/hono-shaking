// Minimal ANSI color helpers. Zero runtime dependency. Colors are silenced
// when:
//   - stdout is not a TTY (piped output / CI logs), or
//   - the standard `NO_COLOR` env var is set (https://no-color.org/), or
//   - `FORCE_COLOR=0`.
//
// We only color stdout because that's where the report goes; stderr
// (spinner, diagnostics) has its own coloring decisions handled separately.

const stripAnsi = (s: string): string => s;

const colorEnabled =
  process.stdout.isTTY === true && process.env.NO_COLOR == null && process.env.FORCE_COLOR !== "0";

const wrap = (open: number, close: number) => {
  if (!colorEnabled) return stripAnsi;
  const start = `\x1b[${open}m`;
  const end = `\x1b[${close}m`;
  return (s: string): string => `${start}${s}${end}`;
};

export const bold = wrap(1, 22);
export const dim = wrap(2, 22);
export const red = wrap(31, 39);
export const green = wrap(32, 39);
export const yellow = wrap(33, 39);
export const blue = wrap(34, 39);
export const magenta = wrap(35, 39);
export const cyan = wrap(36, 39);
export const gray = wrap(90, 39);

import type { HttpMethod } from "./types.ts";

// HTTP method colors borrowed from the conventional REST API doc palette:
// safe verbs lean green/blue, write verbs lean yellow, destructive verbs red.
const METHOD_COLOR: Record<HttpMethod, (s: string) => string> = {
  GET: green,
  HEAD: green,
  OPTIONS: gray,
  POST: blue,
  PUT: yellow,
  PATCH: cyan,
  DELETE: red,
  ALL: magenta,
};

export const colorMethod = (m: HttpMethod): string => METHOD_COLOR[m](m.padEnd(7));

export const colorsEnabled = (): boolean => colorEnabled;
