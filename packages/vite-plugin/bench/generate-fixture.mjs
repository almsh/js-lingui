import fs from "node:fs"
import path from "node:path"

const LOCALES = ["en", "de", "fr", "es", "it", "pl", "cs", "ja", "pt"]
const SECTIONS = 10
const PAGES_PER_SECTION = 8
const MESSAGES_PER_CATALOG = 20

/**
 * Create a project with a catalog per experimental extractor entry and locale,
 * all imported lazily with `import.meta.glob`, plus unrelated files around them.
 */
export function generateFixture(dir) {
  fs.rmSync(dir, { recursive: true, force: true })

  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    fs.writeFileSync(path.join(dir, file), content)
  }
  const poHeader = (locale) => `msgid ""\nmsgstr ""\n"Language: ${locale}\\n"\n`

  for (let s = 0; s < SECTIONS; s++) {
    for (let p = 0; p < PAGES_PER_SECTION; p++) {
      const entryDir = `src/routes/section-${s}/page-${p}`
      write(`${entryDir}/page.js`, `export default function Page() {}\n`)

      for (const locale of LOCALES) {
        let po = poHeader(locale)
        for (let m = 0; m < MESSAGES_PER_CATALOG; m++) {
          const message = `Message ${m} of ${entryDir}`
          po += `\nmsgid "${message}"\nmsgstr "[${locale}] ${message}"\n`
        }
        write(`${entryDir}/locales/page/${locale}.po`, po)
      }

      for (let c = 0; c < 9; c++) {
        const componentDir = `${entryDir}/components/component-${c}`
        write(`${componentDir}/index.js`, `export const C${c} = () => null\n`)
        write(`${componentDir}/styles.css`, `.c${c} {}\n`)
        write(`${componentDir}/index.test.js`, `// test\n`)
      }
    }
  }

  for (let i = 0; i < 70; i++) {
    write(`src/shared/lib-${i}/index.js`, `export const x = ${i}\n`)
    write(`src/shared/lib-${i}/util.js`, `export const y = ${i}\n`)
  }

  for (const locale of LOCALES) {
    write(`src/locales/${locale}.po`, poHeader(locale))
  }

  write(
    "lingui.config.js",
    `export default {
  locales: ${JSON.stringify(LOCALES)},
  sourceLocale: "en",
  catalogs: [{ path: "<rootDir>/src/locales/{locale}", include: ["<rootDir>/src/shared"] }],
  experimental: {
    extractor: {
      entries: ["<rootDir>/src/routes/**/page.js"],
      output: "<rootDir>/{entryDir}/locales/{entryName}/{locale}",
    },
  },
}\n`,
  )

  write(
    "entrypoint.js",
    `const catalogs = import.meta.glob("./src/routes/**/locales/page/*.po")
export const count = Object.keys(catalogs).length
export const load = (file) => catalogs[file]()
`,
  )

  return {
    entries: SECTIONS * PAGES_PER_SECTION,
    locales: LOCALES.length,
    catalogModules: SECTIONS * PAGES_PER_SECTION * LOCALES.length,
    files: countFiles(path.join(dir, "src")),
  }
}

function countFiles(dir) {
  let count = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    count += entry.isDirectory() ? countFiles(path.join(dir, entry.name)) : 1
  }
  return count
}
