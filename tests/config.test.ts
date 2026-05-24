import { describe, expect, it } from "vitest";

import { buildIgnoreFilter, defineConfig } from "../src/config.ts";
import type { CallSiteRef, DefinedRoute } from "../src/types.ts";

const route = (method: DefinedRoute["method"], path: string, source = "/srv.ts"): DefinedRoute => ({
  method,
  path,
  source,
});

const call = (method: CallSiteRef["method"], path: string, file = "/cli.ts"): CallSiteRef => ({
  method,
  path,
  file,
  line: 1,
  column: 1,
  matchedClientName: "c",
});

describe("buildIgnoreFilter", () => {
  it("matches a literal path", () => {
    const filter = buildIgnoreFilter(
      defineConfig({
        ignore: {
          routes: [{ method: null, path: "/foo", serverAppTypeFile: null, reason: null }],
          orphans: null,
        },
      }),
      "/",
    );
    expect(filter.isRouteIgnored(route("GET", "/foo"))).toBe(true);
    expect(filter.isRouteIgnored(route("GET", "/bar"))).toBe(false);
  });

  it("matches `*` as one segment and `**` as any depth", () => {
    const filter = buildIgnoreFilter(
      defineConfig({
        ignore: {
          routes: [
            { method: null, path: "/api/v1/*", serverAppTypeFile: null, reason: null },
            { method: null, path: "/api/v2/**", serverAppTypeFile: null, reason: null },
          ],
          orphans: null,
        },
      }),
      "/",
    );
    expect(filter.isRouteIgnored(route("GET", "/api/v1/users"))).toBe(true);
    expect(filter.isRouteIgnored(route("GET", "/api/v1/users/123"))).toBe(false);
    expect(filter.isRouteIgnored(route("GET", "/api/v2/users"))).toBe(true);
    expect(filter.isRouteIgnored(route("GET", "/api/v2/users/123"))).toBe(true);
    expect(filter.isRouteIgnored(route("GET", "/api/v3/users"))).toBe(false);
  });

  it("respects method filter", () => {
    const filter = buildIgnoreFilter(
      defineConfig({
        ignore: {
          routes: [{ method: "POST", path: "/x", serverAppTypeFile: null, reason: null }],
          orphans: null,
        },
      }),
      "/",
    );
    expect(filter.isRouteIgnored(route("POST", "/x"))).toBe(true);
    expect(filter.isRouteIgnored(route("GET", "/x"))).toBe(false);
  });

  it("filters orphans by file glob", () => {
    const filter = buildIgnoreFilter(
      defineConfig({
        ignore: {
          routes: null,
          orphans: [
            {
              method: "GET",
              path: "/token",
              file: "**/tiptap/Editor.svelte",
              reason: null,
            },
          ],
        },
      }),
      "/",
    );
    expect(filter.isOrphanIgnored(call("GET", "/token", "/x/y/tiptap/Editor.svelte"))).toBe(true);
    expect(filter.isOrphanIgnored(call("GET", "/token", "/other.ts"))).toBe(false);
  });
});
