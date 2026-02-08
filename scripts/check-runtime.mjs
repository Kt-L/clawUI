import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(currentFile), "..");
const pkgPath = path.join(rootDir, "package.json");
const nvmrcPath = path.join(rootDir, ".nvmrc");

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const nvmVersion = fs.readFileSync(nvmrcPath, "utf8").trim();
const expectedNode = `v${nvmVersion}`;
const expectedNpm = pkg.packageManager?.startsWith("npm@")
  ? pkg.packageManager.slice(4)
  : "";

const actualNode = process.version;
const actualNpm = process.env.npm_config_user_agent?.match(/npm\/([0-9.]+)/)?.[1] ?? "";

const errors = [];

if (actualNode !== expectedNode) {
  errors.push(`Node.js mismatch: expected ${expectedNode}, got ${actualNode}`);
}

if (!expectedNpm) {
  errors.push('package.json is missing "packageManager": "npm@x.y.z"');
} else if (actualNpm !== expectedNpm) {
  errors.push(`npm mismatch: expected ${expectedNpm}, got ${actualNpm || "unknown"}`);
}

if (errors.length > 0) {
  console.error("Runtime check failed:");
  for (const err of errors) {
    console.error(`- ${err}`);
  }
  process.exit(1);
}

console.log(`Runtime check passed: node ${actualNode}, npm ${actualNpm}`);
