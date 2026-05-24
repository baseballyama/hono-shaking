// Line-based progress reporter with periodic heartbeats from a worker thread.
//
// The main-thread work (TypeScript Compiler API, fs walks) is synchronous and
// can hold the event loop for many seconds. A pure main-thread spinner can't
// animate during that window. An in-place worker-thread spinner using `\r`
// also fails under `pnpm dlx` / `npx`, which line-buffer the child's stderr
// and need a `\n` to flush.
//
// Compromise: a worker thread emits a newline-terminated heartbeat every
// few seconds while a step is in progress. Each line independently flushes
// through any wrapping runner, and the user sees the elapsed counter tick
// up so they know the tool isn't frozen.

import { writeSync } from "node:fs";
import { Worker } from "node:worker_threads";

import { dim, gray, green } from "./colors.ts";

const HEARTBEAT_INTERVAL_MS = 2000;
const HEARTBEAT_FIRST_DELAY_MS = 1500;

const writeStderr = (s: string): void => {
  writeSync(2, s);
};

const tick = green("✓");

const fmtElapsed = (start: number): string => {
  const elapsed = Date.now() - start;
  if (elapsed < 1000) return `${elapsed}ms`;
  return `${(elapsed / 1000).toFixed(1)}s`;
};

// The heartbeat runs in a worker thread so it ticks independently of the
// main thread's synchronous workload. A SharedArrayBuffer flag stops it
// without an asynchronous message round-trip — the worker checks the flag
// at the top of each tick and exits cleanly when set.
// Important: write through fs.writeSync(2, ...) directly. Worker's
// process.stderr.write routes through a parent-side stream that doesn't
// drain while the main thread is blocked in synchronous work — exactly the
// situation that motivates the heartbeat. fd 2 is shared across threads in
// Node, so a direct write reaches the terminal regardless of main's state.
const HEARTBEAT_WORKER_SOURCE = `
const fs = require("node:fs");
const { workerData } = require("node:worker_threads");
const out = (s) => fs.writeSync(2, s);
const stopFlag = new Int32Array(workerData.buffer);
const startedAt = Date.now();
const intervalMs = workerData.intervalMs;
const firstDelayMs = workerData.firstDelayMs;

const tick = () => {
  if (Atomics.load(stopFlag, 0) !== 0) return;
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  out("   … working " + elapsed + "s\\n");
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
        intervalMs: HEARTBEAT_INTERVAL_MS,
        firstDelayMs: HEARTBEAT_FIRST_DELAY_MS,
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
      writeStderr(`${tick} ${message} ${dim(`(${fmtElapsed(t)})`)}\n`);
    },
  };
};

export const info = (line: string): void => {
  writeStderr(`${line}\n`);
};

// gray is imported because we want it to be tree-shake-stable even though
// it isn't used directly in this file yet; future heartbeat formatting may
// switch to gray for elapsed time.
void gray;
