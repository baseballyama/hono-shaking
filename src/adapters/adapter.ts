/** 1-based line, 1-based column in the original source. */
export interface OriginalPosition {
  line: number;
  column: number;
}

export interface TransformedScript {
  /** Virtual TypeScript source produced from the framework file. */
  code: string;
  /**
   * Map a 1-based line / 0-based column in the virtual code back to the
   * 1-based line / 1-based column in the original file. Return `null` when
   * the position cannot be remapped.
   */
  resolvePosition: (line: number, column: number) => OriginalPosition | null;
}

export interface FrameworkAdapter {
  /** Adapter identifier shown in diagnostics (e.g. `svelte`, `vue`). */
  name: string;
  /** Supported file extensions without the leading dot. */
  extensions: string[];
  matches: (filePath: string) => boolean;
  /**
   * Transform a framework file into a virtual TypeScript source. Returning
   * `null` skips the file (parse error, no embedded script block, etc.).
   */
  transform: (filePath: string, content: string) => TransformedScript | null;
}
