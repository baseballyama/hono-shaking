// Line-based progress reporter with periodic heartbeats from a worker thread.
//
// The main-thread work (TypeScript Compiler API, fs walks) is synchronous and
// can hold the event loop for many seconds. A pure main-thread spinner cannot
// animate during that window, so we run the heartbeat in a worker thread.
//
// The worker writes via `fs.writeSync(2, ...)` directly to fd 2. `process
// .stderr.write` from a worker routes through a parent-side stream that
// doesn't drain while the main thread is blocked in synchronous work, which
// was the root cause of every earlier "the spinner just freezes" bug.
//
// Output style depends on whether fd 2 is a TTY:
//
//   * TTY: in-place spinner with carriage return + erase-line. Animates
//     smoothly because each tick redraws the same row.
//   * Non-TTY (CI logs, file redirection, line-buffered runners): one new
//     `… working Xs` line every two seconds. Each line is newline-terminated
//     so it lands on the screen immediately.
//
// `done()` clears the spinner line in TTY mode before printing the `✓`
// result so the spinner doesn't leak into the final report.

import { writeSync } from "node:fs";
import { isatty } from "node:tty";
import { Worker } from "node:worker_threads";

import { dim, green } from "./colors.ts";

const HEARTBEAT_TTY_INTERVAL_MS = 80;
const HEARTBEAT_TTY_FIRST_DELAY_MS = 80;
const HEARTBEAT_PIPE_INTERVAL_MS = 2000;
const HEARTBEAT_PIPE_FIRST_DELAY_MS = 1500;

const STDERR_IS_TTY = isatty(2);
const CLEAR_LINE = "\r\x1b[K";

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
const isTty = workerData.isTty;
const intervalMs = workerData.intervalMs;
const firstDelayMs = workerData.firstDelayMs;
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const CLEAR_LINE = "\\r\\x1b[K";
let frame = 0;

const tick = () => {
  if (Atomics.load(stopFlag, 0) !== 0) return;
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  if (isTty) {
    // Carriage-return + erase-line + spinner; no trailing newline so the
    // next tick rewrites the same row.
    fs.writeSync(2, CLEAR_LINE + " " + FRAMES[frame % FRAMES.length] + " working " + elapsed + "s");
    frame++;
  } else {
    fs.writeSync(2, "   … working " + elapsed + "s\\n");
  }
};

setTimeout(() => {
  if (Atomics.load(stopFlag, 0) !== 0) return;
  tick();
  setInterval(tick, intervalMs);
}, firstDelayMs);
`;

interface Heartbeat {
  stop: () => void;
}

const startHeartbeat = (): Heartbeat | null => {
  try {
    const buffer = new SharedArrayBuffer(4);
    const flag = new Int32Array(buffer);
    const worker = new Worker(HEARTBEAT_WORKER_SOURCE, {
      eval: true,
      workerData: {
        buffer,
        isTty: STDERR_IS_TTY,
        intervalMs: STDERR_IS_TTY ? HEARTBEAT_TTY_INTERVAL_MS : HEARTBEAT_PIPE_INTERVAL_MS,
        firstDelayMs: STDERR_IS_TTY ? HEARTBEAT_TTY_FIRST_DELAY_MS : HEARTBEAT_PIPE_FIRST_DELAY_MS,
      },
    });
    worker.unref();
    return {
      stop: () => {
        Atomics.store(flag, 0, 1);
        void worker.terminate();
      },
    };
  } catch {
    return null;
  }
};

export interface StepHandle {
  /** Mark this step done, printing `✓ <message> (elapsed)`. */
  done: (message: string) => void;
}

export const startStep = (label: string): StepHandle => {
  writeStderr(`⏳ ${label}\n`);
  const t = Date.now();
  const heartbeat = startHeartbeat();
  return {
    done: (message) => {
      heartbeat?.stop();
      // In TTY mode we own the current line with the spinner; erase it so the
      // ✓ summary lands cleanly. In non-TTY mode the heartbeats are real
      // separate lines and we just append.
      if (STDERR_IS_TTY) {
        writeStderr(CLEAR_LINE);
      }
      writeStderr(`${tickIcon} ${message} ${dim(`(${fmtElapsed(t)})`)}\n`);
    },
  };
};

export const info = (line: string): void => {
  writeStderr(`${line}\n`);
};
