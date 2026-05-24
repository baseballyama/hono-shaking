import { describe, expect, it } from 'vitest';

import { diffRoutes } from '../src/diff.ts';
import type { CallSiteRef, DefinedRoute } from '../src/types.ts';

const route = (method: DefinedRoute['method'], path: string): DefinedRoute => ({
  method,
  path,
  source: '/srv.ts',
});

const call = (method: CallSiteRef['method'], path: string, line = 1): CallSiteRef => ({
  method,
  path,
  file: '/client.ts',
  line,
  column: 1,
  matchedClientName: 'c',
});

describe('diffRoutes', () => {
  it('partitions defined / called into used + unused + orphan', () => {
    const defined = [route('GET', '/a'), route('POST', '/a'), route('GET', '/dead')];
    const called = [call('GET', '/a'), call('POST', '/a', 2), call('GET', '/typo')];

    const result = diffRoutes(defined, called);

    expect(result.unused).toEqual([route('GET', '/dead')]);
    expect(result.used.map((u) => `${u.route.method} ${u.route.path}`)).toEqual([
      'GET /a',
      'POST /a',
    ]);
    expect(result.orphanCalls).toEqual([call('GET', '/typo')]);
  });

  it('groups multiple call sites under one used route', () => {
    const defined = [route('GET', '/x')];
    const called = [call('GET', '/x', 1), call('GET', '/x', 2), call('GET', '/x', 3)];

    const result = diffRoutes(defined, called);
    expect(result.used).toHaveLength(1);
    expect(result.used[0]?.callSites).toHaveLength(3);
  });

  it('treats different methods on the same path as distinct routes', () => {
    const defined = [route('GET', '/x'), route('POST', '/x')];
    const called = [call('GET', '/x')];

    const result = diffRoutes(defined, called);
    expect(result.used.map((u) => u.route.method)).toEqual(['GET']);
    expect(result.unused.map((r) => r.method)).toEqual(['POST']);
  });
});
