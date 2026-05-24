// Lexical-scope resolution for the `hc` factory from `hono/client`.
//
// Users import `hc` under any name they like — `import { hc } from 'hono/client'`,
// `import { hc as createClient } from 'hono/client'`, or `import * as h from 'hono/client'`
// — and may even re-export it through a local barrel. We rely on the TypeScript
// symbol resolver to follow whichever shape the user chose, rather than matching
// the literal identifier `hc` at the call site.

import ts from 'typescript';

/**
 * `true` if the symbol, after following any alias chain, is the `hc` export of
 * Hono's client module. The file path check guards against unrelated symbols
 * that happen to also be named `hc`.
 */
export const isHonoClientHc = (symbol: ts.Symbol, checker: ts.TypeChecker): boolean => {
  let resolved = symbol;
  if ((resolved.flags & ts.SymbolFlags.Alias) !== 0) {
    resolved = checker.getAliasedSymbol(resolved);
  }
  if (resolved.name !== 'hc') return false;
  const decl = resolved.declarations?.[0];
  if (decl == null) return false;
  const fileName = decl.getSourceFile().fileName;
  // Cross-platform check that the declaration sits inside Hono's package.
  return /[/\\]hono[/\\]/.test(fileName);
};

/**
 * `true` if the given call-expression callee resolves to Hono's `hc`. Handles:
 *   - `hc<T>(...)`                       (direct import)
 *   - `createClient<T>(...)`             (aliased import)
 *   - `honoNs.hc<T>(...)`                (namespace import)
 *   - re-exports through any number of intermediate modules
 */
export const isHcCallee = (callee: ts.Expression, checker: ts.TypeChecker): boolean => {
  let symbolNode: ts.Node;
  if (ts.isIdentifier(callee)) {
    symbolNode = callee;
  } else if (ts.isPropertyAccessExpression(callee)) {
    symbolNode = callee.name;
  } else {
    return false;
  }
  const symbol = checker.getSymbolAtLocation(symbolNode);
  if (symbol == null) return false;
  return isHonoClientHc(symbol, checker);
};
