import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { discoverProject } from '../src/discover.ts';

const fixture = (name: string) => resolve(__dirname, 'fixtures', name);

describe('discoverProject', () => {
  it('discovers direct-binding server / client pairs', () => {
    const { servers, bindings } = discoverProject(fixture('basic-direct'));

    expect(servers).toHaveLength(1);
    expect(servers[0]?.exportName).toBe('AppType');
    expect(servers[0]?.routeCount).toBe(5);

    expect(bindings).toHaveLength(1);
    expect(bindings[0]?.variableName).toBe('backendClient');
  });

  it('detects factory-pattern bindings (const X = createXClient(...))', () => {
    const { bindings } = discoverProject(fixture('factory'));

    const names = bindings.map((b) => b.variableName).sort();
    expect(names).toContain('orgClient');
  });

  it('detects bindings via aliased hc import', () => {
    const { bindings } = discoverProject(fixture('aliased-hc'));

    const names = bindings.map((b) => b.variableName).sort();
    expect(names).toContain('widgetClient');
  });
});
