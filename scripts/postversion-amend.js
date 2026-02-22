/**
 * After `npm version`, amend the version commit to include workspace package.json
 * updates. Only amends when the last commit is the version commit (message equals
 * the new version), so `npm version patch --no-git-tag-version` does not amend.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
const newVersion = pkg.version;

try {
  execSync("git add packages/*/package.json", { cwd: rootDir, stdio: "pipe" });
} catch {
  process.exit(0);
}

const staged = execSync("git diff --cached --name-only", { cwd: rootDir, encoding: "utf8" }).trim();
if (!staged) process.exit(0);

const lastMessage = execSync("git log -1 --pretty=%s", { cwd: rootDir, encoding: "utf8" }).trim();
if (lastMessage !== newVersion) process.exit(0);

execSync("git commit --amend --no-edit", { cwd: rootDir, stdio: "inherit" });
