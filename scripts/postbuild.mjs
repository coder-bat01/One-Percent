import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const standalone = resolve(root, ".next/standalone");
if (!existsSync(resolve(standalone, "server.js"))) {
  console.error("Standalone build output was not found. Run next build first.");
  process.exit(1);
}

const staticDir = resolve(root, ".next/static");
if (existsSync(staticDir)) {
  const target = resolve(standalone, ".next/static");
  mkdirSync(dirname(target), { recursive: true });
  cpSync(staticDir, target, { recursive: true, force: true });
}

const publicDir = resolve(root, "public");
if (existsSync(publicDir)) {
  cpSync(publicDir, resolve(standalone, "public"), {
    recursive: true,
    force: true,
  });
}

console.log("Prepared standalone static assets.");
