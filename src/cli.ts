#!/usr/bin/env node
import { dirname, relative, resolve } from "node:path";
import { parseArgs } from "node:util";

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
import { startSpinner } from "./spinner.ts";
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
  --fail-on-unused           Exit with code 1 if any unused routes are found.
  --fail-on-orphans          Exit with code 1 if any orphan call sites exist.
  -h, --help                 Show this help

Framework support:
  - .svelte files require "svelte" + "svelte2tsx" (optional peer deps).
  - .vue files require "@vue/compiler-sfc" (optional peer dep).
  Both are auto-detected; missing peer deps simply disable that framework.

About tsgo (typescript-go):
  This tool uses the standard "typescript" package Compiler API to read
  type info from your AppType. It does NOT invoke tsc as a binary, so
  projects that build / type-check via tsgo are unaffected — the bundled
  typescript runs alongside.
`;

const printHelp = (): void => {
  // stdout so `hono-shaking --help | less` works as expected
  process.stdout.write(HELP_TEXT);
};

interface CommonArgs {
  exclude: string[];
  json: boolean;
  showUsed: boolean;
  failOnUnused: boolean;
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
      "fail-on-unused": { type: "boolean", default: false },
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
    failOnUnused: values["fail-on-unused"],
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

  // Auto mode: explicit `--root`, or no manual flags at all (the default
  // when the user just runs `hono-shaking` from the repo root).
  if (values.root != null || manualProvided.length === 0) {
    return {
      mode: "auto",
      root: values.root ?? ".",
      perBinding: values["per-binding"],
      ...common,
    };
  }

  // Manual mode: any manual flag opts in, but all four must be present so
  // we don't silently fall back to auto when one is missing.
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

const printHuman = (result: DiffResult, showUsed: boolean, indent = ""): void => {
  const { unused, used, orphanCalls } = result;
  const totalDefined = unused.length + used.length;

  process.stdout.write(`${indent}defined routes : ${totalDefined}\n`);
  process.stdout.write(`${indent}used routes    : ${used.length}\n`);
  process.stdout.write(`${indent}unused routes  : ${unused.length}\n`);
  process.stdout.write(`${indent}orphan calls   : ${orphanCalls.length}\n\n`);

  if (unused.length > 0) {
    process.stdout.write(`${indent}Unused routes (${unused.length})\n`);
    for (const r of unused) {
      process.stdout.write(`${indent}  ${r.method.padEnd(7)} ${r.path}\n`);
    }
    process.stdout.write("\n");
  }

  if (orphanCalls.length > 0) {
    process.stdout.write(
      `${indent}Orphan call sites (called but no server definition) (${orphanCalls.length})\n`,
    );
    for (const c of orphanCalls) {
      process.stdout.write(
        `${indent}  ${c.method.padEnd(7)} ${c.path}  (${rel(c.file)}:${c.line})\n`,
      );
    }
    process.stdout.write("\n");
  }

  if (showUsed && used.length > 0) {
    process.stdout.write(`${indent}Used routes (${used.length})\n`);
    for (const u of used) {
      process.stdout.write(
        `${indent}  ${u.route.method.padEnd(7)} ${u.route.path}  [${u.callSites.length}x]\n`,
      );
    }
  }
};

interface FilteredDiff {
  diff: DiffResult;
  ignoredUnused: DiffResult["unused"];
  ignoredOrphans: DiffResult["orphanCalls"];
}

/** Filter the diff against an ignore set and surface what was filtered. */
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
  const showSpinner = !args.json;
  const spinner = showSpinner ? startSpinner("Extracting server routes…") : null;

  const defined = extractRoutes({
    tsconfigPath: args.serverTsconfig,
    appTypeFile: args.appTypeFile,
    exportName: args.appTypeExport,
  });

  spinner?.update(`Scanning ${rel(args.clientDir)} for hc calls…`);

  const called = await findCallsites({
    tsconfigPath: args.clientTsconfig,
    includeDir: args.clientDir,
    exclude: args.exclude,
    knownClientNames: args.clientNames,
    restrictToClientNames: null,
    adapters: null,
  });

  const raw = diffRoutes(defined, called);
  const { diff: result, ignoredUnused, ignoredOrphans } = applyIgnoreFilter(raw, filter);
  spinner?.stop();

  if (args.json) {
    process.stdout.write(
      `${JSON.stringify({ ...result, ignored: { unused: ignoredUnused, orphans: ignoredOrphans } }, null, 2)}\n`,
    );
  } else {
    process.stdout.write("# Summary\n");
    printHuman(result, args.showUsed, "  ");
    if (ignoredUnused.length + ignoredOrphans.length > 0) {
      process.stdout.write(
        `  ignored        : ${ignoredUnused.length} unused / ${ignoredOrphans.length} orphan (config)\n`,
      );
    }
  }

  if (args.failOnUnused && result.unused.length > 0) return 1;
  if (args.failOnOrphans && result.orphanCalls.length > 0) return 1;
  return 0;
};

interface PairResult {
  server: DiscoveryResult["servers"][number];
  binding: DiscoveryResult["bindings"][number];
  diff: DiffResult;
}

const runAuto = async (args: AutoArgs, filter: IgnoreFilter | null): Promise<number> => {
  // Spinner only when stdout/stderr is a TTY and we're not emitting JSON
  // (JSON consumers redirect stderr too in practice).
  const showSpinner = !args.json;
  const spinner = showSpinner ? startSpinner("Discovering server / client pairs…") : null;

  const discovery = discoverProject(args.root);
  spinner?.update(
    `Discovered ${discovery.servers.length} server${discovery.servers.length === 1 ? "" : "s"} / ${discovery.bindings.length} binding${discovery.bindings.length === 1 ? "" : "s"} — extracting routes…`,
  );

  if (discovery.servers.length === 0) {
    spinner?.stop();
    process.stderr.write(
      `error: no Hono server (export type X = typeof Y) found under ${args.root}\n`,
    );
    return 2;
  }
  if (discovery.bindings.length === 0) {
    spinner?.stop();
    process.stderr.write(
      `error: no hc<...> client binding resolved to any discovered server under ${args.root}\n`,
    );
    return 2;
  }

  // Group bindings by (tsconfig, scan dir) so we run findCallsites only once
  // per client package. Multiple bindings sharing a client package are split
  // back out by matchedClientName afterwards.
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

  // Extract each server's routes once; multiple bindings may share a server.
  const routesByServerKey = new Map<string, ReturnType<typeof extractRoutes>>();
  const serverKey = (s: DiscoveryResult["servers"][number]): string =>
    `${s.appTypeFile} ${s.exportName}`;
  let serverIdx = 0;
  for (const s of discovery.servers) {
    serverIdx++;
    spinner?.update(
      `Extracting routes (${serverIdx}/${discovery.servers.length}): ${rel(s.appTypeFile)} :: ${s.exportName}`,
    );
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
  }

  const pairResults: PairResult[] = [];
  const buckets_arr = [...buckets.values()];
  let bucketIdx = 0;
  for (const bucket of buckets_arr) {
    bucketIdx++;
    spinner?.update(
      `Scanning client (${bucketIdx}/${buckets_arr.length}): ${rel(bucket.clientPackageDir)}`,
    );
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
  }

  spinner?.stop();

  // Aggregate per server: a route is "unused" only if no consumer of that
  // server hit it. The per-binding view (--per-binding) is shown separately.
  interface ServerAggregate {
    server: DiscoveryResult["servers"][number];
    consumers: { binding: DiscoveryResult["bindings"][number]; usedCount: number }[];
    diff: DiffResult;
    ignoredUnused: DiffResult["unused"];
    ignoredOrphans: DiffResult["orphanCalls"];
  }
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

  if (args.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          servers: discovery.servers,
          aggregates: [...aggByServer.values()],
          pairs: args.perBinding
            ? pairResults.map((p) => ({ server: p.server, binding: p.binding, diff: p.diff }))
            : undefined,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    process.stdout.write("# Discovered servers\n");
    for (const s of discovery.servers) {
      process.stdout.write(`  ${rel(s.appTypeFile)} :: ${s.exportName} (${s.routeCount} routes)\n`);
    }
    process.stdout.write("\n# Discovered bindings\n");
    for (const b of discovery.bindings) {
      process.stdout.write(
        `  ${rel(b.clientFile)} :: ${b.variableName}  →  ${rel(b.server.appTypeFile)} :: ${b.server.exportName}\n`,
      );
    }
    process.stdout.write("\n");

    for (const agg of aggByServer.values()) {
      const consumerList = agg.consumers
        .map((c) => `${rel(c.binding.clientPackageDir)}::${c.binding.variableName}(${c.usedCount})`)
        .join(", ");

      process.stdout.write(`== ${rel(agg.server.packageDir)} :: ${agg.server.exportName} ==\n`);
      process.stdout.write(`  consumers: ${consumerList}\n`);
      printHuman(agg.diff, args.showUsed, "  ");
      if (agg.ignoredUnused.length + agg.ignoredOrphans.length > 0) {
        process.stdout.write(
          `  ignored        : ${agg.ignoredUnused.length} unused / ${agg.ignoredOrphans.length} orphan (config)\n`,
        );
      }
    }

    if (args.perBinding) {
      process.stdout.write("# Per-binding detail\n");
      for (const p of pairResults) {
        process.stdout.write(
          `-- ${rel(p.server.packageDir)} :: ${p.server.exportName}  ↔  ${rel(p.binding.clientPackageDir)} :: ${p.binding.variableName} --\n`,
        );
        printHuman(p.diff, args.showUsed, "    ");
      }
    }
  }

  let code = 0;
  const anyUnused = [...aggByServer.values()].some((a) => a.diff.unused.length > 0);
  const anyOrphan = [...aggByServer.values()].some((a) => a.diff.orphanCalls.length > 0);
  if (args.failOnUnused && anyUnused) code = 1;
  if (args.failOnOrphans && anyOrphan) code = 1;
  return code;
};

const main = async (): Promise<void> => {
  const args = parseCli();

  if (!args.json) {
    const adapters = await listAdapters();
    if (adapters.length > 0) {
      process.stderr.write(`# adapters loaded: ${adapters.join(", ")}\n`);
    } else {
      process.stderr.write("# adapters loaded: (none — only .ts files were scanned)\n");
    }
  }

  const { config, configPath } = await resolveConfig(args);
  const filter =
    config == null || configPath == null ? null : buildIgnoreFilter(config, dirname(configPath));
  if (!args.json && configPath != null) {
    process.stderr.write(`# config: ${rel(configPath)}\n`);
  }

  const code = args.mode === "auto" ? await runAuto(args, filter) : await runManual(args, filter);
  process.exit(code);
};

main().catch((err: unknown) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
});
