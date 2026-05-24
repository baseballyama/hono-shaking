import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { findCallsites } from '../src/find-callsites.ts';

const fixture = (name: string) => resolve(__dirname, 'fixtures', name);

const callsByKey = (calls: { method: string; path: string }[]) =>
  calls.map((c) => `${c.method} ${c.path}`).sort();

describe('findCallsites', () => {
  it('emits one call per `client.path.$method(...)` site', async () => {
    const calls = await findCallsites({
      tsconfigPath: `${fixture('basic-direct')}/tsconfig.json`,
      includeDir: fixture('basic-direct'),
      exclude: null,
      knownClientNames: null,
      restrictToClientNames: null,
      adapters: [],
    });

    expect(callsByKey(calls)).toEqual(['GET /users', 'POST /users', 'PUT /users/:id']);
    for (const c of calls) expect(c.matchedClientName).toBe('backendClient');
  });

  it('handles indirect access where the client sits in the middle of the chain', async () => {
    const calls = await findCallsites({
      tsconfigPath: `${fixture('indirect-access')}/tsconfig.json`,
      includeDir: fixture('indirect-access'),
      exclude: null,
      knownClientNames: null,
      restrictToClientNames: null,
      adapters: [],
    });

    expect(callsByKey(calls)).toEqual(['GET /items', 'GET /items/:id']);
  });

  it('detects calls inside .svelte files via the Svelte adapter', async () => {
    const calls = await findCallsites({
      tsconfigPath: `${fixture('svelte')}/tsconfig.json`,
      includeDir: fixture('svelte'),
      exclude: null,
      knownClientNames: null,
      restrictToClientNames: null,
      adapters: null,
    });

    expect(callsByKey(calls)).toEqual(['GET /posts', 'POST /posts']);
  });

  it('handles aliased hc import (import { hc as createClient })', async () => {
    const calls = await findCallsites({
      tsconfigPath: `${fixture('aliased-hc')}/tsconfig.json`,
      includeDir: fixture('aliased-hc'),
      exclude: null,
      knownClientNames: null,
      restrictToClientNames: null,
      adapters: [],
    });

    expect(callsByKey(calls)).toEqual(['GET /widgets', 'POST /widgets']);
    for (const c of calls) expect(c.matchedClientName).toBe('widgetClient');
  });

  it('detects calls inside .vue files via the Vue adapter', async () => {
    const calls = await findCallsites({
      tsconfigPath: `${fixture('vue')}/tsconfig.json`,
      includeDir: fixture('vue'),
      exclude: null,
      knownClientNames: null,
      restrictToClientNames: null,
      adapters: null,
    });

    expect(callsByKey(calls)).toEqual(['GET /things', 'PUT /things/:id']);
  });
});
