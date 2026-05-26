import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { discoverProject } from "../src/discover.ts";

const fixture = (name: string) => resolve(__dirname, "fixtures", name);

describe("discoverProject", () => {
  it("discovers direct-binding server / client pairs", () => {
    const { servers, bindings } = discoverProject(fixture("basic-direct"));

    expect(servers).toHaveLength(1);
    expect(servers[0]?.exportName).toBe("AppType");
    expect(servers[0]?.routeCount).toBe(5);

    expect(bindings).toHaveLength(1);
    expect(bindings[0]?.variableName).toBe("backendClient");
  });

  it("detects factory-pattern bindings (const X = createXClient(...))", () => {
    const { bindings } = discoverProject(fixture("factory"));

    const names = bindings.map((b) => b.variableName).sort();
    expect(names).toContain("orgClient");
  });

  it("detects bindings via aliased hc import", () => {
    const { bindings } = discoverProject(fixture("aliased-hc"));

    const names = bindings.map((b) => b.variableName).sort();
    expect(names).toContain("widgetClient");
  });

  it("discovers server / client pairs across monorepo packages", () => {
    const { servers, bindings } = discoverProject(fixture("monorepo"));

    expect(servers).toHaveLength(1);
    const apiServer = servers[0];
    expect(apiServer?.exportName).toBe("AppType");
    // Server is correctly attributed to the API package (not the repo root).
    expect(apiServer?.packageDir.endsWith("apps/api")).toBe(true);

    expect(bindings).toHaveLength(1);
    const webBinding = bindings[0];
    expect(webBinding?.variableName).toBe("backendClient");
    // Binding is attributed to the web package — not the API package the
    // AppType lives in. This is what makes per-package config scoping
    // useful in a monorepo.
    expect(webBinding?.clientPackageDir.endsWith("apps/web")).toBe(true);
    expect(webBinding?.server.exportName).toBe("AppType");
  });
});
