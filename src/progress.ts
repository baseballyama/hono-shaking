// Line-based progress reporter.
//
// We deliberately do not draw an in-place spinner. Earlier versions used a
// carriage-return spinner running in a worker thread, which animated nicely
// in a real terminal but went silent under `pnpm dlx` / `npx`: those runners
// line-buffer the child process's stderr, and our `\r`-only writes never had
// a newline to trigger a flush. So even though the work was progressing,
// from the user's perspective the tool looked frozen.
//
// One-line-per-step is universal: a real terminal, a CI log, a pnpm dlx
// runner, and a piped redirection all show the same progressing output.
// We also use `fs.writeSync(2, ...)` so each line lands on stderr immediately
// without going through Node's Writable buffering, which is what the runner
// layers above us actually sample.

import { writeSync } from "node:fs";

import { dim, green } from "./colors.ts";

const writeStderr = (s: string): void => {
  writeSync(2, s);
};

const tick = green("✓");

const ms = (start: number): string => {
  const elapsed = Date.now() - start;
  if (elapsed < 1000) return `${elapsed}ms`;
  return `${(elapsed / 1000).toFixed(1)}s`;
};

export interface StepHandle {
  /** Mark this step done, printing `✓ <message> (elapsed)`. */
  done: (message: string) => void;
}

/**
 * Print `⏳ label` as a "step starting" line and return a handle. Call
 * `handle.done(message)` once the step finishes to print `✓ message (Xs)`.
 */
export const startStep = (label: string): StepHandle => {
  writeStderr(`⏳ ${label}\n`);
  const t = Date.now();
  return {
    done: (message) => writeStderr(`${tick} ${message} ${dim(`(${ms(t)})`)}\n`),
  };
};

/** Print a one-shot informational line on stderr (no progress association). */
export const info = (line: string): void => {
  writeStderr(`${line}\n`);
};
