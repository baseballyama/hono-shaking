// Progress spinner driven by a worker thread.
//
// The CLI's hot phases (discoverProject, loadProgram, extractRoutes,
// findCallsites) run synchronously in the main thread for tens of seconds at
// a time. A plain `setInterval` spinner on the main thread freezes during
// those phases because timers can't fire while sync code is running. To keep
// the spinner ticking we move it to a worker thread that has its own event
// loop and writes directly to the parent's stderr (workers inherit stderr by
// default in Node).
//
// The spinner is suppressed when stderr is not a TTY (CI, file redirection)
// — the caller emits the same phase labels as one-shot `# ...` lines instead.

import { Worker } from "node:worker_threads";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INTERVAL_MS = 80;

// Erase to end of line (`\x1b[K`) so a shorter next label doesn't leave
// trailing characters from the previous longer one.
const CLEAR_LINE = "\r\x1b[K";

const WORKER_CODE = `
const FRAMES = ${JSON.stringify(FRAMES)};
const INTERVAL_MS = ${INTERVAL_MS};
const CLEAR_LINE = ${JSON.stringify(CLEAR_LINE)};
const { parentPort } = require("node:worker_threads");

let label = "";
let frame = 0;
let timer = null;

const render = () => {
  process.stderr.write(CLEAR_LINE + FRAMES[frame % FRAMES.length] + " " + label);
  frame++;
};

parentPort.on("message", (msg) => {
  if (msg && msg.type === "label") {
    label = msg.text;
    render();
    return;
  }
  if (msg && msg.type === "log") {
    // Print a permanent line above the live spinner row, then keep spinning.
    process.stderr.write(CLEAR_LINE + msg.text + "\\n");
    render();
    return;
  }
  if (msg && msg.type === "stop") {
    if (timer) clearInterval(timer);
    process.stderr.write(CLEAR_LINE);
    parentPort.postMessage({ type: "stopped" });
  }
});

timer = setInterval(render, INTERVAL_MS);
`;

export interface Spinner {
  /** Replace the live (bottom) line label. */
  update: (text: string) => void;
  /** Print a permanent line above the spinner row. The spinner keeps running. */
  log: (text: string) => void;
  /**
   * Stop the spinner. Resolves once the worker has cleared its line so the
   * caller can write to stdout / stderr afterwards without racing.
   */
  stop: (finalLine?: string) => Promise<void>;
}

const noopSpinner = (initial: string): Spinner => {
  process.stderr.write(`# ${initial}\n`);
  return {
    update: (text) => process.stderr.write(`# ${text}\n`),
    log: (text) => process.stderr.write(`${text}\n`),
    stop: async (final) => {
      if (final != null) process.stderr.write(`${final}\n`);
    },
  };
};

interface WorkerReply {
  type?: unknown;
}

export const startSpinner = (initialText: string): Spinner => {
  if (!process.stderr.isTTY) {
    return noopSpinner(initialText);
  }

  const worker = new Worker(WORKER_CODE, { eval: true });
  // The spinner must never keep the process alive on its own.
  worker.unref();
  worker.postMessage({ type: "label", text: initialText });

  let stopped = false;

  return {
    update: (text) => {
      if (stopped) return;
      worker.postMessage({ type: "label", text });
    },
    log: (text) => {
      if (stopped) {
        process.stderr.write(`${text}\n`);
        return;
      }
      worker.postMessage({ type: "log", text });
    },
    stop: async (finalLine) => {
      if (stopped) {
        if (finalLine != null) process.stderr.write(`${finalLine}\n`);
        return;
      }
      stopped = true;

      // Round-trip with the worker: it has to acknowledge the stop and clear
      // its line *before* we terminate it. Otherwise an in-flight render can
      // leave a stray frame on the current row.
      await new Promise<void>((resolve) => {
        const onMessage = (msg: WorkerReply): void => {
          if (msg != null && typeof msg === "object" && msg.type === "stopped") {
            worker.off("message", onMessage);
            resolve();
          }
        };
        worker.on("message", onMessage);
        worker.postMessage({ type: "stop" });
      });
      await worker.terminate();

      if (finalLine != null) process.stderr.write(`${finalLine}\n`);
    },
  };
};
