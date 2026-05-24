import { dirname, resolve } from "node:path";

import ts from "typescript";

export interface LoadedProgram {
  program: ts.Program;
  checker: ts.TypeChecker;
  configPath: string;
  rootDir: string;
}

/**
 * Parse a tsconfig.json and build the corresponding ts.Program. We use the
 * standard `typescript` package's Compiler API — not tsc directly — so projects
 * that run their build / type-check via tsgo are unaffected.
 */
export const loadProgram = (tsconfigPath: string): LoadedProgram => {
  const configPath = resolve(tsconfigPath);
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, undefined, {
    fileExists: ts.sys.fileExists.bind(ts.sys),
    readFile: ts.sys.readFile.bind(ts.sys),
    readDirectory: ts.sys.readDirectory.bind(ts.sys),
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
    getCurrentDirectory: () => dirname(configPath),
    onUnRecoverableConfigFileDiagnostic: (d) => {
      throw new Error(
        `tsconfig load error: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`,
      );
    },
  });

  if (parsed == null) {
    throw new Error(`Failed to parse tsconfig: ${configPath}`);
  }

  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
    ...(parsed.projectReferences != null && {
      projectReferences: parsed.projectReferences,
    }),
  });

  return {
    program,
    checker: program.getTypeChecker(),
    configPath,
    rootDir: dirname(configPath),
  };
};
