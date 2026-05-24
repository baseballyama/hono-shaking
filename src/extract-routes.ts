import { resolve } from 'node:path';

import ts from 'typescript';

import { type LoadedProgram, loadProgram } from './ts-program.ts';
import type { DefinedRoute, HttpMethod } from './types.ts';

const METHOD_KEYS = new Set(['get', 'post', 'put', 'delete', 'patch', 'options', 'head', 'all']);

const toMethod = (key: string): HttpMethod | null => {
  if (!key.startsWith('$')) return null;
  const lower = key.slice(1);
  if (!METHOD_KEYS.has(lower)) return null;
  return lower.toUpperCase() as HttpMethod;
};

export interface ExtractOptions {
  tsconfigPath: string;
  /** Source file that exports the AppType (the chained `app.route(...).route(...)`). */
  appTypeFile: string;
  /** Name of the type alias exported from `appTypeFile`. Defaults to `AppType` when null. */
  exportName: string | null;
}

const flattenTypes = (type: ts.Type): ts.Type[] => {
  if (type.isUnion()) return type.types.flatMap((t) => flattenTypes(t));
  if (type.isIntersection()) return type.types.flatMap((t) => flattenTypes(t));
  return [type];
};

/**
 * `app.route(...)` chaining accumulates the schema as a *union* in Hono's 2nd
 * type parameter. Walking the alias as-is would only see properties common to
 * all members (i.e. none); we have to enumerate each union member and merge
 * their schema properties.
 */
const collectHonoSchemaTypes = (appTypeAlias: ts.Type, checker: ts.TypeChecker): ts.Type[] => {
  const schemas: ts.Type[] = [];
  for (const branch of flattenTypes(appTypeAlias)) {
    const typeArgs =
      (branch as ts.TypeReference).typeArguments ??
      checker.getTypeArguments(branch as ts.TypeReference);

    if (typeArgs != null && typeArgs.length >= 2) {
      const schema = typeArgs[1];
      if (schema != null) schemas.push(schema);
    }
  }
  return schemas;
};

/**
 * Resolve the AppType, walk Hono's schema record `{ [path]: { $get: ..., $post: ... } }`,
 * and emit a flat `DefinedRoute[]` sorted by path then method.
 */
export const extractRoutes = (options: ExtractOptions): DefinedRoute[] => {
  const { tsconfigPath, appTypeFile } = options;
  const exportName = options.exportName ?? 'AppType';
  const loaded: LoadedProgram = loadProgram(tsconfigPath);
  const { program, checker } = loaded;

  const absAppTypeFile = resolve(appTypeFile);
  const sourceFile = program.getSourceFiles().find((sf) => resolve(sf.fileName) === absAppTypeFile);
  if (sourceFile == null) {
    throw new Error(
      `AppType source file not found in program: ${absAppTypeFile}\nMake sure the tsconfig includes this file.`,
    );
  }

  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (moduleSymbol == null) {
    throw new Error(`Module symbol not found for: ${absAppTypeFile}`);
  }
  const moduleExports = checker.getExportsOfModule(moduleSymbol);
  const target = moduleExports.find((s) => s.name === exportName);
  if (target == null) {
    throw new Error(
      `Export "${exportName}" not found in ${absAppTypeFile}. ` +
        `Available exports: ${moduleExports.map((e) => e.name).join(', ')}.`,
    );
  }

  const declaredType = checker.getDeclaredTypeOfSymbol(target);
  const appType =
    declaredType != null && (declaredType.flags & ts.TypeFlags.Any) === 0 ? declaredType : null;
  if (appType == null) {
    throw new Error(`Could not resolve type for export "${exportName}"`);
  }

  const schemaTypes = collectHonoSchemaTypes(appType, checker);
  if (schemaTypes.length === 0) {
    throw new Error(
      `Could not extract Hono schema from "${exportName}". Is it a Hono<E, S, ...> type?`,
    );
  }

  const seen = new Set<string>();
  const routes: DefinedRoute[] = [];

  for (const schema of schemaTypes) {
    // Each union member of the schema is an object `{ [path]: { $method: Endpoint, ... } }`.
    for (const branch of flattenTypes(schema)) {
      const pathSymbols = checker.getPropertiesOfType(branch);
      for (const pathSym of pathSymbols) {
        const path = pathSym.name;
        if (!path.startsWith('/')) continue;
        const pathType = checker.getTypeOfSymbolAtLocation(pathSym, sourceFile);
        for (const methodBranch of flattenTypes(pathType)) {
          const methodSymbols = checker.getPropertiesOfType(methodBranch);
          for (const ms of methodSymbols) {
            const method = toMethod(ms.name);
            if (method == null) continue;
            const key = `${method} ${path}`;
            if (seen.has(key)) continue;
            seen.add(key);
            routes.push({ method, path, source: absAppTypeFile });
          }
        }
      }
    }
  }

  routes.sort((a, b) => {
    const byPath = a.path.localeCompare(b.path);
    return byPath === 0 ? a.method.localeCompare(b.method) : byPath;
  });
  return routes;
};
