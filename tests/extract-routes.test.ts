import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { extractRoutes } from '../src/extract-routes.ts';

const fixture = (name: string) => resolve(__dirname, 'fixtures', name);

describe('extractRoutes', () => {
  it('lists every (method, path) defined in the AppType', () => {
    const routes = extractRoutes({
      tsconfigPath: `${fixture('basic-direct')}/tsconfig.json`,
      appTypeFile: `${fixture('basic-direct')}/server.ts`,
      exportName: null,
    });

    const keys = routes.map((r) => `${r.method} ${r.path}`).sort();
    expect(keys).toEqual([
      'DELETE /dead/route',
      'GET /users',
      'GET /users/:id',
      'POST /users',
      'PUT /users/:id',
    ]);
  });

  it('uses `AppType` as the default export name when null is passed', () => {
    const routes = extractRoutes({
      tsconfigPath: `${fixture('basic-direct')}/tsconfig.json`,
      appTypeFile: `${fixture('basic-direct')}/server.ts`,
      exportName: null,
    });
    expect(routes.length).toBeGreaterThan(0);
  });

  it('throws when the named export is missing', () => {
    expect(() =>
      extractRoutes({
        tsconfigPath: `${fixture('basic-direct')}/tsconfig.json`,
        appTypeFile: `${fixture('basic-direct')}/server.ts`,
        exportName: 'NotARealType',
      }),
    ).toThrow(/Export "NotARealType" not found/);
  });
});
