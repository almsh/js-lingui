// Benchmark `vite build` of a project with many lazily imported catalogs
// for one or more revisions of `@lingui/vite-plugin`.
//
// usage: node packages/vite-plugin/bench/run.mjs [--runs <n>] <git-ref> [<git-ref>...]
//
// The plugin is built from `packages/vite-plugin/src` at every given ref, all other
// packages come from the workspace. Temporary files go to `bench/.tmp` (gitignored).
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import { syncBuiltinESMExports } from "node:module"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { fileURLToPath, pathToFileURL } from "node:url"
import { parseArgs } from "node:util"
import { generateFixture } from "./generate-fixture.mjs"

const PLUGIN_SRC = "packages/vite-plugin/src"
const benchFile = fileURLToPath(import.meta.url)
const tmpDir = path.join(path.dirname(benchFile), ".tmp")
const fixtureDir = path.join(tmpDir, "fixture")

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    runs: { type: "string", default: "5" },
    // internal: measure a single build with the given plugin bundle
    child: { type: "string" },
  },
})

if (values.child) {
  const result = await measureBuild(values.child, positionals[0])
  console.log(JSON.stringify(result))
} else {
  await main(positionals, Number(values.runs))
}

async function main(refs, runs) {
  if (!refs.length || !(runs > 0)) {
    console.error(
      "usage: node packages/vite-plugin/bench/run.mjs [--runs <n>] <git-ref> [<git-ref>...]",
    )
    process.exit(1)
  }

  const repoRoot = git(["rev-parse", "--show-toplevel"]).trim()

  if (!fs.existsSync(path.join(repoRoot, "packages/cli/dist"))) {
    console.error(
      "Workspace packages aren't built, run `yarn release:build` first.",
    )
    process.exit(1)
  }

  fs.rmSync(tmpDir, { recursive: true, force: true })

  const fixture = generateFixture(fixtureDir)
  console.log(
    `Fixture: ${fixture.entries} entries × ${fixture.locales} locales = ` +
      `${fixture.catalogModules} lazily imported .po modules, ${fixture.files} files\n`,
  )

  const variants = []
  for (const [i, ref] of refs.entries()) {
    const sha = git(["rev-parse", "--short", `${ref}^{commit}`]).trim()
    console.log(`Building @lingui/vite-plugin from ${ref} (${sha})`)

    const entry = await buildPlugin(
      repoRoot,
      ref,
      path.join(tmpDir, `plugin-${i}`),
    )
    variants.push({ label: `${ref} (${sha})`, entry, results: [] })
  }

  console.log("")

  // alternate the variants, so they share the same machine conditions
  for (let run = 1; run <= runs; run++) {
    for (const [i, variant] of variants.entries()) {
      const output = execFileSync(
        process.execPath,
        [benchFile, "--child", variant.entry, path.join(tmpDir, `out-${i}`)],
        { encoding: "utf8" },
      )
      const result = JSON.parse(output.trim().split("\n").at(-1))

      if (result.catalogModules !== fixture.catalogModules) {
        throw new Error(
          `Expected ${fixture.catalogModules} catalog modules in the bundle, got ${result.catalogModules}`,
        )
      }

      variant.results.push(result)
      console.log(
        `run ${run}/${runs}  ${variant.label}  ${formatMs(result.ms)}  ` +
          `getCatalogs() calls: ${result.getCatalogsCalls}`,
      )
    }
  }

  printSummary(variants, runs)
}

/**
 * Bundle the plugin sources at `ref`. Only the plugin itself is bundled,
 * `@lingui/cli` and other dependencies resolve from the workspace.
 */
async function buildPlugin(repoRoot, ref, dir) {
  const files = git(
    ["ls-tree", "-r", "--name-only", ref, "--", PLUGIN_SRC],
    repoRoot,
  )
    .split("\n")
    .filter(Boolean)

  if (!files.includes(`${PLUGIN_SRC}/index.ts`)) {
    throw new Error(`${PLUGIN_SRC}/index.ts doesn't exist at ${ref}`)
  }

  for (const file of files) {
    const dest = path.join(dir, "src", path.relative(PLUGIN_SRC, file))
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(
      dest,
      execFileSync("git", ["show", `${ref}:${file}`], { cwd: repoRoot }),
    )
  }

  const { rolldown } = await import("rolldown")
  const bundle = await rolldown({
    input: path.join(dir, "src/index.ts"),
    platform: "node",
    external: (id) => !id.startsWith(".") && !path.isAbsolute(id),
  })
  const entry = path.join(dir, "index.mjs")
  await bundle.write({ file: entry, format: "esm" })
  await bundle.close()

  return entry
}

async function measureBuild(pluginEntry, outDir) {
  // in this fixture every getCatalogs() call runs exactly one globSync (experimental entries)
  let getCatalogsCalls = 0
  const globSync = fs.globSync
  fs.globSync = (...args) => (getCatalogsCalls++, globSync(...args))
  syncBuiltinESMExports()

  const { build } = await import("vite")
  const { lingui } = await import(pathToFileURL(pluginEntry).href)

  const root = fs.realpathSync(fixtureDir)
  const start = performance.now()

  await build({
    root,
    configFile: false,
    logLevel: "silent",
    build: {
      outDir,
      emptyOutDir: true,
      lib: {
        entry: path.join(root, "entrypoint.js"),
        formats: ["es"],
        fileName: () => "bundle.js",
      },
    },
    plugins: [lingui({ cwd: root })],
  })

  const ms = performance.now() - start
  const bundle = await import(
    pathToFileURL(path.join(outDir, "bundle.js")).href
  )

  return { ms, getCatalogsCalls, catalogModules: bundle.count }
}

function printSummary(variants, runs) {
  const header = ["plugin", "getCatalogs() calls", "median", "min", "max"]
  const rows = variants.map((variant) => {
    const times = variant.results.map((r) => r.ms).sort((a, b) => a - b)
    const calls = new Set(variant.results.map((r) => r.getCatalogsCalls))
    return [
      variant.label,
      [...calls].join(", "),
      formatMs(median(times)),
      formatMs(times[0]),
      formatMs(times.at(-1)),
    ]
  })

  const widths = header.map((title, i) =>
    Math.max(title.length, ...rows.map((row) => row[i].length)),
  )
  const line = (cells) =>
    cells
      .map((cell, i) => cell.padEnd(widths[i]))
      .join("  ")
      .trimEnd()

  console.log(`\nvite build, ${runs} alternating run(s):\n`)
  console.log(line(header))
  rows.forEach((row) => console.log(line(row)))
}

function median(sorted) {
  const middle = sorted.length >> 1
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

function formatMs(ms) {
  return `${(ms / 1000).toFixed(2)} s`
}

function git(args, cwd = path.dirname(benchFile)) {
  return execFileSync("git", args, { cwd, encoding: "utf8" })
}
