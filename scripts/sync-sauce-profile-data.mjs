/**
 * Copy the Sauce snapshot the route profile samples.
 *
 * Source is the DCU data folder after `sync_sauce_data.py`. Runtime code reads
 * data/sauce in this repo and does not open the other project.
 *
 *   node scripts/sync-sauce-profile-data.mjs
 *   node scripts/sync-sauce-profile-data.mjs "C:/path/to/backend/data"
 */
import fs from "node:fs"
import path from "node:path"

const source = process.argv[2] || "C:/Users/Chris/OneDrive/Dokumenter/DZR/DCU/DCU Member liga/backend/data"
const dest = path.join(process.cwd(), "data", "sauce")

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.copyFileSync(from, to)
}

for (const name of ["routes.json", "worldlist.json"]) {
  const from = path.join(source, name)
  if (!fs.existsSync(from)) {
    console.error(`missing ${from}`)
    process.exit(1)
  }
  copyFile(from, path.join(dest, name))
}

const worldsDir = path.join(source, "worlds")
const worlds = fs.readdirSync(worldsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory())
let files = 2
for (const world of worlds) {
  for (const name of ["roads.json", "segments.json"]) {
    const from = path.join(worldsDir, world.name, name)
    if (!fs.existsSync(from)) continue
    copyFile(from, path.join(dest, "worlds", world.name, name))
    files += 1
  }
}

const routes = JSON.parse(fs.readFileSync(path.join(dest, "routes.json"), "utf8"))
console.log(`copied ${files} files, ${Array.isArray(routes) ? routes.length : 0} routes, into ${dest}`)
