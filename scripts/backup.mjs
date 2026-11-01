import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { loadEnvironment } from "./env.mjs";

loadEnvironment();

const source = resolve(
  process.env.DATABASE_PATH || ".data/one-percent.sqlite",
);
if (!existsSync(source)) {
  console.error(`Database not found: ${source}`);
  process.exit(1);
}
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const target = resolve(
  process.argv[2] || `.data/backup-${stamp}.sqlite`,
);

mkdirSync(dirname(target), { recursive: true });
const database = new DatabaseSync(source);
try {
  // VACUUM INTO creates a consistent snapshot even while the app is running.
  database.prepare("VACUUM INTO ?").run(target);
} finally {
  database.close();
}
console.log(target);
