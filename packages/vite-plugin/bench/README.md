# Catalog resolution benchmark for `@lingui/vite-plugin`

A synthetic benchmark for the change that makes the plugin resolve catalogs once per build instead of on every catalog import (branch `perf/vite-plugin-cache-catalogs`).

It isn't meant to be merged as is. It's here so maintainers can decide whether a benchmark like this belongs in the repo, and in which form.

## What it measures

`generate-fixture.mjs` creates a project with per-entry catalogs from `experimental.extractor`:

- 80 entries (`src/routes/**/page.js`), 9 locales, 20 messages per catalog;
- every catalog is imported lazily with `import.meta.glob`, so one build transforms 720 `.po` modules;
- unrelated components, styles and tests around the entries, about 3.1k files in 1.1k directories in total.

`run.mjs` takes one or more git refs and builds `@lingui/vite-plugin` from `packages/vite-plugin/src` at each of them. Then it runs `vite build` for the fixture with every build of the plugin, alternating between them, and prints the build time and the number of `getCatalogs()` calls. Calls are counted by wrapping `fs.globSync`: in this fixture every `getCatalogs()` call runs exactly one glob.

Only the plugin is built per ref. `@lingui/cli` and the other packages come from the current workspace build.

## Run

```sh
yarn install && yarn release:build

git fetch https://github.com/almsh/js-lingui perf/vite-plugin-cache-catalogs
node packages/vite-plugin/bench/run.mjs main FETCH_HEAD
```

`--runs <n>` sets the number of runs per ref, 5 by default. The fixture, the plugin builds and the build output go to `packages/vite-plugin/bench/.tmp`, which is gitignored and recreated on every start.

## Results

Apple M5 Max, Node 24.19, Vite 8.1.3 (Rolldown), 5 alternating runs:

| plugin       | `getCatalogs()` calls | `vite build`, median |
| ------------ | --------------------- | -------------------- |
| `main`       | 720                   | 20.4 s               |
| with the fix | 1                     | 0.80 s               |

One glob gets more expensive the deeper the project path is, so absolute numbers depend on where the repo is checked out. With the same fixture in `/tmp`, the build on `main` takes about 16 s.
