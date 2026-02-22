/**
 * Syncs the new version (from npm version lifecycle) to all workspace packages.
 * Run as the "version" script so packages/client and packages/server stay in sync with the root.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const packagesDir = path.join(rootDir, "packages");

const newVersion = process.env.npm_package_version;
if (!newVersion) {
  console.error("version-workspaces: npm_package_version not set (run via npm version)");
  process.exit(1);
}

const entries = fs.readdirSync(packagesDir, { withFileTypes: true });
for (const ent of entries) {
  if (!ent.isDirectory()) continue;
  const pkgPath = path.join(packagesDir, ent.name, "package.json");
  if (!fs.existsSync(pkgPath)) continue;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  pkg.version = newVersion;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
  console.log(`Updated ${ent.name} to ${newVersion}`);
}
