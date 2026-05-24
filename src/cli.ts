#!/usr/bin/env node
import { dirname, relative, resolve } from "node:path";
import { parseArgs } from "node:util";

import { bold, colorMethod, cyan, dim, gray, green, red, yellow } from "./colors.ts";
import {
  buildIgnoreFilter,
  findConfigFile,
  type HonoUnusedConfig,
  type IgnoreFilter,
  loadConfig,
} from "./config.ts";
import { diffRoutes } from "./diff.ts";
import { type DiscoveryResult, discoverProject } from "./discover.ts";
import { extractRoutes } from "./extract-routes.ts";
import { findCallsites, listAdapters } from "./find-callsites.ts";
import { info, startStep } from "./progress.ts";
import type { DiffResult } from "./types.ts";

const HELP_TEXT = `Usage: hono-shaking [options]

Default (no arguments): auto-detect against the current working directory.
Equivalent to passing \`--root .\`.

Auto-detect mode:
  --root <dir>               Repository root to auto-discover server/client
                             pairs (defaults to "."). Scans for
                             "export type X = typeof Y" (servers) and
                             "hc<X>(...)" (clients), then resolves each
                             hc<T> to a server via the TS Compiler API.

Manual mode (specify all four):
  --server-tsconfig <path>   tsconfig.json of the server-side package
  --app-type-file <path>     Source file that exports the AppType
  --client-tsconfig <path>   tsconfig.json of the client-side package
  --client-dir <path>        Directory to scan for hc client call sites

Optional:
  --app-type-export <name>   Type export name (manual mode, default: AppType)
  --client-name <name>       Extra hc client root identifier name (repeatable).
                             Auto-detected from .ts; specify only when
                             referenced exclusively from .svelte / .vue.
  --exclude <substring>      Skip files containing this substring (repeatable)
  --json                     Emit JSON instead of human-readable output
  --show-used                Also list used routes (verbose)
  --per-binding              In auto mode, also print per-client breakdown.
                             Default is aggregated-by-server (a route is
                             "used" if ANY consumer calls it).
  --config <path>            Explicit config file path. Default: search cwd
                             (then --root) for hono-shaking.config.{ts,...}.
  --no-config                Skip config file auto-discovery.
  --allow-unused             Exit 0 even when unused routes are found
                             (default is exit 1).
  --fail-on-orphans          Exit 1 if any orphan call sites exist.
  -h, --help                 Show this help

Exit codes:
  0  No unused routes (and no orphans if --fail-on-orphans is set).
  1  Unused routes found, or orphans with --fail-on-orphans.
  2  Invocation / configuration error.

Framework support:
  - .svelte files require "svelte" + "svelte2tsx" (installed automatically
    via optionalDependencies; npm/pnpm/yarn pull them in unless excluded).
  - .vue files require "@vue/compiler-sfc" (same).

About tsgo (typescript-go):
  This tool uses the standard "typescript" package Compiler API to read
  type info from your AppType. It does NOT invoke tsc as a binary, so
  projects that build / type-check via tsgo are unaffected — the bundled
  typescript runs alongside.
`;

const printHelp = (): void => {
  process.stdout.write(HELP_TEXT);
};

interface CommonArgs {
  exclude: string[];
  json: boolean;
  showUsed: boolean;
  allowUnused: boolean;
  failOnOrphans: boolean;
  configPath: string | null;
  noConfig: boolean;
}

interface ManualArgs extends CommonArgs {
  mode: "manual";
  serverTsconfig: string;
  appTypeFile: string;
  appTypeExport: string;
  clientTsconfig: string;
  clientDir: string;
  clientNames: string[];
}

interface AutoArgs extends CommonArgs {
  mode: "auto";
  root: string;
  perBinding: boolean;
}

type Args = ManualArgs | AutoArgs;

const parseCli = (): Args => {
  const { values } = parseArgs({
    options: {
      root: { type: "string" },
      "server-tsconfig": { type: "string" },
      "app-type-file": { type: "string" },
      "app-type-export": { type: "string", default: "AppType" },
      "client-tsconfig": { type: "string" },
      "client-dir": { type: "string" },
      "client-name": { type: "string", multiple: true },
      exclude: { type: "string", multiple: true },
      json: { type: "boolean", default: false },
      "show-used": { type: "boolean", default: false },
      "per-binding": { type: "boolean", default: false },
      config: { type: "string" },
      "no-config": { type: "boolean", default: false },
      "allow-unused": { type: "boolean", default: false },
      "fail-on-orphans": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  const common: CommonArgs = {
    exclude: values.exclude ?? [],
    json: values.json,
    showUsed: values["show-used"],
    allowUnused: values["allow-unused"],
    failOnOrphans: values["fail-on-orphans"],
    configPath: values.config ?? null,
    noConfig: values["no-config"],
  };

  const manualFlags: [string, string | undefined][] = [
    ["server-tsconfig", values["server-tsconfig"]],
    ["app-type-file", values["app-type-file"]],
    ["client-tsconfig", values["client-tsconfig"]],
    ["client-dir", values["client-dir"]],
  ];
  const manualProvided = manualFlags.filter(([, v]) => v != null);

  if (values.root != null || manualProvided.length === 0) {
    return {
      mode: "auto",
      root: values.root ?? ".",
      perBinding: values["per-binding"],
      ...common,
    };
  }

  const missing = manualFlags.filter(([, v]) => v == null).map(([k]) => `--${k}`);
  if (missing.length > 0) {
    process.stderr.write(
      `error: manual mode requires all four flags. Missing: ${missing.join(", ")}.\nTo auto-detect instead, drop the manual flags (or pass --root <dir>).\n\n`,
    );
    printHelp();
    process.exit(2);
  }

  return {
    mode: "manual",
    serverTsconfig: values["server-tsconfig"]!,
    appTypeFile: values["app-type-file"]!,
    appTypeExport: values["app-type-export"] ?? "AppType",
    clientTsconfig: values["client-tsconfig"]!,
    clientDir: values["client-dir"]!,
    clientNames: values["client-name"] ?? [],
    ...common,
  };
};

const cwd = process.cwd();
const rel = (p: string): string => relative(cwd, p) || p;

const tick = green("✓");
const cross = red("✗");

// ---- Output rendering ----

interface FilteredDiff {
  diff: DiffResult;
  ignoredUnused: DiffResult["unused"];
  ignoredOrphans: DiffResult["orphanCalls"];
}

const applyIgnoreFilter = (diff: DiffResult, filter: IgnoreFilter | null): FilteredDiff => {
  if (filter == null) {
    return { diff, ignoredUnused: [], ignoredOrphans: [] };
  }
  const ignoredUnused: DiffResult["unused"] = [];
  const keepUnused: DiffResult["unused"] = [];
  for (const r of diff.unused) {
    if (filter.isRouteIgnored(r)) ignoredUnused.push(r);
    else keepUnused.push(r);
  }
  const ignoredOrphans: DiffResult["orphanCalls"] = [];
  const keepOrphans: DiffResult["orphanCalls"] = [];
  for (const c of diff.orphanCalls) {
    if (filter.isOrphanIgnored(c)) ignoredOrphans.push(c);
    else keepOrphans.push(c);
  }
  return {
    diff: { unused: keepUnused, used: diff.used, orphanCalls: keepOrphans },
    ignoredUnused,
    ignoredOrphans,
  };
};

interface ServerAggregate {
  server: DiscoveryResult["servers"][number];
  consumers: { binding: DiscoveryResult["bindings"][number]; usedCount: number }[];
  diff: DiffResult;
  ignoredUnused: DiffResult["unused"];
  ignoredOrphans: DiffResult["orphanCalls"];
}

const formatServerLabel = (s: DiscoveryResult["servers"][number]): string =>
  `${rel(s.packageDir)} :: ${s.exportName}`;

const renderRouteList = (
  title: string,
  routes: { method: import("./types.ts").HttpMethod; path: string }[],
): string => {
  const lines: string[] = [];
  lines.push(`  ${bold(title)} ${dim(`(${routes.length})`)}`);
  for (const r of routes) {
    lines.push(`    ${colorMethod(r.method)} ${r.path}`);
  }
  return lines.join("\n");
};

const renderOrphanList = (title: string, calls: DiffResult["orphanCalls"]): string => {
  const lines: string[] = [];
  lines.push(`  ${bold(title)} ${dim(`(${calls.length})`)}`);
  for (const c of calls) {
    lines.push(`    ${colorMethod(c.method)} ${c.path}  ${dim(`(${rel(c.file)}:${c.line})`)}`);
  }
  return lines.join("\n");
};

const renderSummaryTable = (aggs: ServerAggregate[]): string => {
  const rows: {
    status: string;
    label: string;
    def: number;
    used: number;
    un: number;
    orphan: number;
  }[] = [];
  for (const a of aggs) {
    const defined = a.diff.unused.length + a.diff.used.length;
    rows.push({
      status: a.diff.unused.length === 0 && a.diff.orphanCalls.length === 0 ? tick : cross,
      label: formatServerLabel(a.server),
      def: defined,
      used: a.diff.used.length,
      un: a.diff.unused.length,
      orphan: a.diff.orphanCalls.length,
    });
  }
  const labelWidth = Math.max(20, ...rows.map((r) => stripWidth(r.label)));
  const header = `  ${" ".repeat(2)}  ${"server".padEnd(labelWidth)}   ${"defined".padStart(7)}  ${"used".padStart(5)}  ${"unused".padStart(6)}  ${"orphan".padStart(6)}`;
  const sep = `  ${"─".repeat(labelWidth + 36)}`;
  const padN = (n: number, w: number): string => String(n).padStart(w);
  const lines = [bold(header), sep];
  for (const r of rows) {
    lines.push(
      `  ${r.status}   ${r.label.padEnd(labelWidth)}   ${dim(padN(r.def, 7))}  ${cyan(padN(r.used, 5))}  ${r.un === 0 ? dim(padN(r.un, 6)) : red(padN(r.un, 6))}  ${r.orphan === 0 ? dim(padN(r.orphan, 6)) : yellow(padN(r.orphan, 6))}`,
    );
  }
  return lines.join("\n");
};

// Width of a string with ANSI color codes stripped. The ESC byte is intentional;
// we silence the regex-no-control-char rule for this one literal.
// oxlint-disable-next-line no-control-regex
const ANSI_PATTERN = /\[\d+m/g;
const stripWidth = (s: string): number => s.replace(ANSI_PATTERN, "").length;

const renderAutoReport = (
  args: AutoArgs,
  discovery: DiscoveryResult,
  aggs: ServerAggregate[],
  pairResults: {
    server: DiscoveryResult["servers"][number];
    binding: DiscoveryResult["bindings"][number];
    diff: DiffResult;
  }[],
): string => {
  const out: string[] = [];

  // Bindings line (compact)
  out.push("");
  out.push(bold("Bindings"));
  for (const b of discovery.bindings) {
    out.push(
      `  ${dim(rel(b.clientFile))} :: ${cyan(b.variableName)}  ${gray("→")}  ${rel(b.server.appTypeFile)} :: ${bold(b.server.exportName)}`,
    );
  }

  // Summary table
  out.push("");
  out.push(bold("Summary"));
  out.push(renderSummaryTable(aggs));

  // Unused routes section (grouped)
  const totalUnused = aggs.reduce((n, a) => n + a.diff.unused.length, 0);
  if (totalUnused > 0) {
    out.push("");
    out.push(bold(`Unused routes (${totalUnused})`));
    for (const a of aggs) {
      if (a.diff.unused.length === 0) continue;
      out.push("");
      out.push(renderRouteList(formatServerLabel(a.server), a.diff.unused));
    }
  }

  // Orphan calls section (grouped)
  const totalOrphans = aggs.reduce((n, a) => n + a.diff.orphanCalls.length, 0);
  if (totalOrphans > 0) {
    out.push("");
    out.push(bold(`Orphan call sites (${totalOrphans})`));
    for (const a of aggs) {
      if (a.diff.orphanCalls.length === 0) continue;
      out.push("");
      out.push(renderOrphanList(formatServerLabel(a.server), a.diff.orphanCalls));
    }
  }

  // Used (optional verbose)
  if (args.showUsed) {
    out.push("");
    out.push(bold("Used routes"));
    for (const a of aggs) {
      if (a.diff.used.length === 0) continue;
      out.push("");
      out.push(`  ${bold(formatServerLabel(a.server))} ${dim(`(${a.diff.used.length})`)}`);
      for (const u of a.diff.used) {
        out.push(
          `    ${colorMethod(u.route.method)} ${u.route.path}  ${dim(`[${u.callSites.length}x]`)}`,
        );
      }
    }
  }

  // Per-binding breakdown
  if (args.perBinding) {
    out.push("");
    out.push(bold("Per-binding detail"));
    for (const p of pairResults) {
      out.push("");
      out.push(
        `  ${bold(formatServerLabel(p.server))}  ${gray("↔")}  ${rel(p.binding.clientPackageDir)} :: ${cyan(p.binding.variableName)}`,
      );
      out.push(
        `  ${dim(`defined ${p.diff.unused.length + p.diff.used.length}  used ${p.diff.used.length}  unused ${p.diff.unused.length}  orphan ${p.diff.orphanCalls.length}`)}`,
      );
    }
  }

  // Ignored summary
  const totalIgnoredUnused = aggs.reduce((n, a) => n + a.ignoredUnused.length, 0);
  const totalIgnoredOrphans = aggs.reduce((n, a) => n + a.ignoredOrphans.length, 0);
  if (totalIgnoredUnused + totalIgnoredOrphans > 0) {
    out.push("");
    out.push(
      dim(`(${totalIgnoredUnused} unused / ${totalIgnoredOrphans} orphan ignored by config)`),
    );
  }

  // Final status line
  out.push("");
  if (totalUnused === 0) {
    out.push(`${tick} ${bold("All defined routes are used.")}`);
  } else {
    out.push(
      `${cross} ${bold(`${totalUnused} unused route${totalUnused === 1 ? "" : "s"} found`)} across ${aggs.filter((a) => a.diff.unused.length > 0).length} server${aggs.filter((a) => a.diff.unused.length > 0).length === 1 ? "" : "s"}.`,
    );
  }
  out.push("");
  return out.join("\n");
};

// ---- Pipeline ----

const resolveConfig = async (
  args: Args,
): Promise<{ config: HonoUnusedConfig | null; configPath: string | null }> => {
  if (args.noConfig) return { config: null, configPath: null };
  let configPath: string | null;
  if (args.configPath == null) {
    const root = args.mode === "auto" ? resolve(args.root) : null;
    configPath = findConfigFile(cwd, root);
  } else {
    configPath = resolve(args.configPath);
  }
  if (configPath == null) return { config: null, configPath: null };
  const config = await loadConfig(configPath);
  return { config, configPath };
};

const runManual = async (args: ManualArgs, filter: IgnoreFilter | null): Promise<number> => {
  const verbose = !args.json;

  const extractStep = verbose ? startStep(`Extracting server routes (may take a moment)…`) : null;
  const defined = extractRoutes({
    tsconfigPath: args.serverTsconfig,
    appTypeFile: args.appTypeFile,
    exportName: args.appTypeExport,
  });
  extractStep?.done(
    `Extracted ${cyan(String(defined.length))} routes from ${bold(rel(args.appTypeFile))}`,
  );

  const scanStep = verbose
    ? startStep(`Scanning ${rel(args.clientDir)} (may take a moment)…`)
    : null;
  const called = await findCallsites({
    tsconfigPath: args.clientTsconfig,
    includeDir: args.clientDir,
    exclude: args.exclude,
    knownClientNames: args.clientNames,
    restrictToClientNames: null,
    adapters: null,
  });
  scanStep?.done(
    `Scanned ${cyan(rel(args.clientDir))}, found ${cyan(String(called.length))} hc call site${called.length === 1 ? "" : "s"}`,
  );

  const raw = diffRoutes(defined, called);
  const { diff: result, ignoredUnused, ignoredOrphans } = applyIgnoreFilter(raw, filter);

  if (args.json) {
    process.stdout.write(
      `${JSON.stringify({ ...result, ignored: { unused: ignoredUnused, orphans: ignoredOrphans } }, null, 2)}\n`,
    );
  } else {
    const total = result.unused.length;
    process.stdout.write("\n");
    process.stdout.write(`${bold("Summary")}\n`);
    process.stdout.write(
      `  defined ${dim(String(defined.length))}  used ${cyan(String(result.used.length))}  unused ${total === 0 ? dim("0") : red(String(total))}  orphan ${result.orphanCalls.length === 0 ? dim("0") : yellow(String(result.orphanCalls.length))}\n`,
    );
    if (result.unused.length > 0) {
      process.stdout.write("\n");
      process.stdout.write(`${renderRouteList("Unused routes", result.unused)}\n`);
    }
    if (result.orphanCalls.length > 0) {
      process.stdout.write("\n");
      process.stdout.write(`${renderOrphanList("Orphan calls", result.orphanCalls)}\n`);
    }
    if (ignoredUnused.length + ignoredOrphans.length > 0) {
      process.stdout.write(
        `\n${dim(`(${ignoredUnused.length} unused / ${ignoredOrphans.length} orphan ignored by config)`)}\n`,
      );
    }
    process.stdout.write("\n");
    if (total === 0) {
      process.stdout.write(`${tick} ${bold("All defined routes are used.")}\n\n`);
    } else {
      process.stdout.write(
        `${cross} ${bold(`${total} unused route${total === 1 ? "" : "s"} found.`)}\n\n`,
      );
    }
  }

  if (!args.allowUnused && result.unused.length > 0) return 1;
  if (args.failOnOrphans && result.orphanCalls.length > 0) return 1;
  return 0;
};

const runAuto = async (args: AutoArgs, filter: IgnoreFilter | null): Promise<number> => {
  const verbose = !args.json;

  const discoverStep = verbose ? startStep("Discovering server / client pairs…") : null;
  const discovery = discoverProject(args.root);
  discoverStep?.done(
    `Discovered ${cyan(String(discovery.servers.length))} server${discovery.servers.length === 1 ? "" : "s"} / ${cyan(String(discovery.bindings.length))} binding${discovery.bindings.length === 1 ? "" : "s"}`,
  );

  if (discovery.servers.length === 0) {
    process.stderr.write(
      `${cross} ${bold("No Hono server found")} (looked for "export type X = typeof Y" under ${args.root}).\n`,
    );
    return 2;
  }
  if (discovery.bindings.length === 0) {
    process.stderr.write(
      `${cross} ${bold("No hc<...> client binding")} resolved to any discovered server under ${args.root}.\n`,
    );
    return 2;
  }

  interface Bucket {
    clientTsconfigPath: string;
    clientPackageDir: string;
    bindings: DiscoveryResult["bindings"];
  }
  const buckets = new Map<string, Bucket>();
  for (const b of discovery.bindings) {
    const key = `${b.clientTsconfigPath} ${b.clientPackageDir}`;
    let bucket = buckets.get(key);
    if (bucket == null) {
      bucket = {
        clientTsconfigPath: b.clientTsconfigPath,
        clientPackageDir: b.clientPackageDir,
        bindings: [],
      };
      buckets.set(key, bucket);
    }
    bucket.bindings.push(b);
  }

  const routesByServerKey = new Map<string, ReturnType<typeof extractRoutes>>();
  const serverKey = (s: DiscoveryResult["servers"][number]): string =>
    `${s.appTypeFile} ${s.exportName}`;

  let serverIdx = 0;
  for (const s of discovery.servers) {
    serverIdx++;
    const step = verbose
      ? startStep(
          `Extracting routes (${serverIdx}/${discovery.servers.length}): ${formatServerLabel(s)} (may take a moment)…`,
        )
      : null;
    const k = serverKey(s);
    if (!routesByServerKey.has(k)) {
      routesByServerKey.set(
        k,
        extractRoutes({
          tsconfigPath: s.tsconfigPath,
          appTypeFile: s.appTypeFile,
          exportName: s.exportName,
        }),
      );
    }
    const routes = routesByServerKey.get(k)!;
    step?.done(
      `Extracted ${cyan(String(routes.length))} routes from ${bold(formatServerLabel(s))}`,
    );
  }

  interface PairResult {
    server: DiscoveryResult["servers"][number];
    binding: DiscoveryResult["bindings"][number];
    diff: DiffResult;
  }
  const pairResults: PairResult[] = [];
  const bucketArr = [...buckets.values()];
  let bucketIdx = 0;
  for (const bucket of bucketArr) {
    bucketIdx++;
    const step = verbose
      ? startStep(
          `Scanning client (${bucketIdx}/${bucketArr.length}): ${rel(bucket.clientPackageDir)} (may take a moment)…`,
        )
      : null;
    const variableNames = [...new Set(bucket.bindings.map((b) => b.variableName))];
    const calls = await findCallsites({
      tsconfigPath: bucket.clientTsconfigPath,
      includeDir: bucket.clientPackageDir,
      exclude: args.exclude,
      knownClientNames: null,
      restrictToClientNames: variableNames,
      adapters: null,
    });
    for (const binding of bucket.bindings) {
      const myCalls = calls.filter((c) => c.matchedClientName === binding.variableName);
      const defined = routesByServerKey.get(serverKey(binding.server))!;
      pairResults.push({
        server: binding.server,
        binding,
        diff: diffRoutes(defined, myCalls),
      });
    }
    step?.done(
      `Scanned ${bold(rel(bucket.clientPackageDir))}, ${cyan(String(calls.length))} call${calls.length === 1 ? "" : "s"}`,
    );
  }

  // Aggregate per server
  const aggByServer = new Map<string, ServerAggregate>();
  for (const p of pairResults) {
    const k = serverKey(p.server);
    let agg = aggByServer.get(k);
    if (agg == null) {
      agg = {
        server: p.server,
        consumers: [],
        diff: { unused: [], used: [], orphanCalls: [] },
        ignoredUnused: [],
        ignoredOrphans: [],
      };
      aggByServer.set(k, agg);
    }
    agg.consumers.push({ binding: p.binding, usedCount: p.diff.used.length });
  }
  for (const [k, agg] of aggByServer) {
    const defined = routesByServerKey.get(k)!;
    const allCalls = pairResults
      .filter((p) => serverKey(p.server) === k)
      .flatMap((p) => [...p.diff.used.flatMap((u) => u.callSites), ...p.diff.orphanCalls]);
    const raw = diffRoutes(defined, allCalls);
    const filtered = applyIgnoreFilter(raw, filter);
    agg.diff = filtered.diff;
    agg.ignoredUnused = filtered.ignoredUnused;
    agg.ignoredOrphans = filtered.ignoredOrphans;
  }

  // Also append servers with no consumer (untouched) so they appear in the table.
  const aggs: ServerAggregate[] = [];
  for (const s of discovery.servers) {
    const k = serverKey(s);
    const existing = aggByServer.get(k);
    if (existing != null) {
      aggs.push(existing);
    } else {
      const defined = routesByServerKey.get(k) ?? [];
      const raw = diffRoutes(defined, []);
      const filtered = applyIgnoreFilter(raw, filter);
      aggs.push({
        server: s,
        consumers: [],
        diff: filtered.diff,
        ignoredUnused: filtered.ignoredUnused,
        ignoredOrphans: filtered.ignoredOrphans,
      });
    }
  }

  if (args.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          servers: discovery.servers,
          aggregates: aggs,
          pairs: args.perBinding
            ? pairResults.map((p) => ({ server: p.server, binding: p.binding, diff: p.diff }))
            : undefined,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    process.stdout.write(renderAutoReport(args, discovery, aggs, pairResults));
  }

  let code = 0;
  const anyUnused = aggs.some((a) => a.diff.unused.length > 0);
  const anyOrphan = aggs.some((a) => a.diff.orphanCalls.length > 0);
  if (!args.allowUnused && anyUnused) code = 1;
  if (args.failOnOrphans && anyOrphan) code = 1;
  return code;
};

const main = async (): Promise<void> => {
  const args = parseCli();

  if (!args.json) {
    const adapters = await listAdapters();
    if (adapters.length > 0) {
      info(dim(`# adapters loaded: ${adapters.join(", ")}`));
    } else {
      info(dim("# adapters loaded: (none — only .ts files were scanned)"));
    }
  }

  const { config, configPath } = await resolveConfig(args);
  const filter =
    config == null || configPath == null ? null : buildIgnoreFilter(config, dirname(configPath));
  if (!args.json && configPath != null) {
    info(dim(`# config: ${rel(configPath)}`));
  }

  const code = args.mode === "auto" ? await runAuto(args, filter) : await runManual(args, filter);
  process.exit(code);
};

main().catch((err: unknown) => {
  process.stderr.write(`${red("error:")} ${String(err)}\n`);
  process.exit(1);
});
