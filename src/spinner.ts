// Minimal spinner with no runtime dependency. The spinner is *only* active
// when stderr is a TTY — under CI or shell redirection it degrades to a
// single one-shot log line so logs stay clean and diff-able. The caller is
// responsible for never starting a spinner when emitting JSON output, since
// JSON consumers usually pipe stdout but read stderr too.

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INTERVAL_MS = 80;

export interface Spinner {
  /** Replace the spinner's label without resetting the animation. */
  update: (text: string) => void;
  /** Stop the spinner. If `finalLine` is given, it's written in place of the spinner. */
  stop: (finalLine?: string) => void;
}

const noopSpinner = (finalLine: string | null): Spinner => {
  if (finalLine != null) process.stderr.write(`${finalLine}\n`);
  return {
    update: (text) => {
      // Non-TTY: each label change becomes its own line so log scrapers can read it.
      process.stderr.write(`# ${text}\n`);
    },
    stop: (final) => {
      if (final != null) process.stderr.write(`${final}\n`);
    },
  };
};

export const startSpinner = (initialText: string): Spinner => {
  if (!process.stderr.isTTY) {
    return noopSpinner(`# ${initialText}`);
  }

  let text = initialText;
  let frame = 0;
  let stopped = false;

  const render = (): void => {
    if (stopped) return;
    process.stderr.write(`\r${FRAMES[frame % FRAMES.length]} ${text}`);
    frame++;
  };

  render();
  const timer = setInterval(render, INTERVAL_MS);

  return {
    update: (next: string) => {
      text = next;
      // Re-render immediately so the new label is visible without waiting for
      // the next tick.
      render();
    },
    stop: (finalLine?: string) => {
      stopped = true;
      clearInterval(timer);
      // Clear the current line completely before printing the final output.
      process.stderr.write("\r[K");
      if (finalLine != null) process.stderr.write(`${finalLine}\n`);
    },
  };
};
