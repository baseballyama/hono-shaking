// Progress reporter.
//
// Output style:
//
//   ⏳ Discovering server / client pairs…
//
// While the step runs the line is rewritten on every tick — the cursor jumps
// up and erases the previous frame, then a new one is written:
//
//   ⠼ Discovering server / client pairs… (7.3s)
//
// On completion the line is rewritten one last time as:
//
//   ✓ Discovered 5 servers / 10 bindings (17.7s)
//
// Net result: each step occupies a single visible row that transitions
// ⏳ → spinner+elapsed → ✓. The user sees one line per finished step,
// not a scrolling wall of heartbeats.
//
// Implementation notes:
//
//   * The rewrite uses `\x1b[1A\x1b[2K` (cursor up + erase line) followed by
//     the new frame and a newline. Each frame is newline-terminated, so it
//     flushes through line-buffered runners like `pnpm dlx`. Any terminal
//     that interprets ANSI escapes will overwrite the previous row in
//     place.
//   * `process.env.CI != null` (and the `dumb` TERM) opt out of the
//     overwrite trick — CI loggers tend to strip ANSI escapes and the
//     literal bytes would clutter the log. In that mode we just print
//     ⏳ start and ✓ end, no heartbeat.
//   * The heartbeat runs in a worker thread because the main-thread
//     work (TypeScript Compiler API, fs walks) is synchronous and would
//     starve a main-thread timer.
//   * The worker writes via `fs.writeSync(2, ...)` directly to fd 2.
//     `process.stderr.write` from a worker is routed through a
//     parent-side stream that doesn't drain while the main thread is
//     blocked, which used to make every previous spinner go silent.

import { writeSync } from "node:fs";
import { Worker } from "node:worker_threads";

import { dim, green } from "./colors.ts";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const TICK_INTERVAL_MS = 100;
const FIRST_TICK_DELAY_MS = 100;

const CURSOR_UP_AND_ERASE = "\x1b[1A\x1b[2K";

// `pnpm dlx` and a real interactive terminal both render ANSI fine, so we
// default to fancy overwrite. CI loggers often strip ANSI, which would leave
// raw escape bytes in their output — opt out via the conventional `CI` env.
const useFancyOverwrite =
  process.env.CI == null && process.env.TERM !== "dumb" && process.env.NO_COLOR == null;

const writeStderr = (s: string): void => {
  writeSync(2, s);
};

const tickIcon = green("✓");

const fmtElapsed = (start: number): string => {
  const elapsed = Date.now() - start;
  if (elapsed < 1000) return `${elapsed}ms`;
  return `${(elapsed / 1000).toFixed(1)}s`;
};

const HEARTBEAT_WORKER_SOURCE = `
const fs = require("node:fs");
const { workerData } = require("node:worker_threads");
const stopFlag = new Int32Array(workerData.buffer);
const startedAt = Date.now();
const label = workerData.label;
const frames = workerData.frames;
const intervalMs = workerData.intervalMs;
const firstDelayMs = workerData.firstDelayMs;
const CURSOR_UP_AND_ERASE = ${JSON.stringify(CURSOR_UP_AND_ERASE)};
let frame = 0;

const tick = () => {
  if (Atomics.load(stopFlag, 0) !== 0) return;
  // Bump the tick counter so the parent knows the spinner has taken over
  // the previous row and needs to erase it before printing the ✓ summary.
  Atomics.add(stopFlag, 1, 1);
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  const sp = frames[frame % frames.length];
  fs.writeSync(2, CURSOR_UP_AND_ERASE + " " + sp + " " + label + " (" + elapsed + "s)\\n");
  frame++;
};

setTimeout(() => {
  if (Atomics.load(stopFlag, 0) !== 0) return;
  tick();
  setInterval(tick, intervalMs);
}, firstDelayMs);
`;

interface Heartbeat {
  /** Stop the heartbeat. Returns the number of frames the worker emitted. */
  stop: () => number;
}

const startHeartbeat = (label: string): Heartbeat | null => {
  try {
    // Two Int32 slots: [0] is the stop flag, [1] is the tick counter.
    const buffer = new SharedArrayBuffer(8);
    const flag = new Int32Array(buffer);
    const worker = new Worker(HEARTBEAT_WORKER_SOURCE, {
      eval: true,
      workerData: {
        buffer,
        label,
        frames: FRAMES,
        intervalMs: TICK_INTERVAL_MS,
        firstDelayMs: FIRST_TICK_DELAY_MS,
      },
    });
    worker.unref();
    return {
      stop: () => {
        Atomics.store(flag, 0, 1);
        void worker.terminate();
        return Atomics.load(flag, 1);
      },
    };
  } catch {
    return null;
  }
};

export interface StepHandle {
  /** Mark this step done, rewriting the step's row as `✓ message (elapsed)`. */
  done: (message: string) => void;
}

export const startStep = (label: string): StepHandle => {
  writeStderr(`⏳ ${label}\n`);
  const t = Date.now();
  const heartbeat = useFancyOverwrite ? startHeartbeat(label) : null;
  return {
    done: (message) => {
      heartbeat?.stop();
      if (useFancyOverwrite) {
        // Whether or not the worker actually ticked, the previous line is
        // exactly one row above the cursor (the ⏳ initial line or the
        // most recent spinner frame). Erase it so ✓ replaces it cleanly.
        writeStderr(CURSOR_UP_AND_ERASE);
      }
      writeStderr(`${tickIcon} ${message} ${dim(`(${fmtElapsed(t)})`)}\n`);
    },
  };
};

export const info = (line: string): void => {
  writeStderr(`${line}\n`);
};
