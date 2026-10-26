// Copies MapLibre's web worker into public/ so it is served from our own origin.
// maplibre-gl v6 resolves its worker relative to import.meta.url, which breaks once
// Next has bundled the module — lib/maplibre.ts points setWorkerUrl() here instead.
// Runs before `dev` and `build` (package.json); the copy is gitignored.
import { copyFileSync, mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

const require = createRequire(import.meta.url)
const pkgDir = dirname(require.resolve("maplibre-gl/package.json"))
mkdirSync("public", { recursive: true })
copyFileSync(join(pkgDir, "dist", "maplibre-gl-worker.mjs"), join("public", "maplibre-gl-worker.mjs"))
