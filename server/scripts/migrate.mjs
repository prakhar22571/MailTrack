#!/usr/bin/env node
// Applies schema.sql (idempotent baseline) and then any migrations/*.sql file
// not yet recorded in the _migrations table, in filename order. On a brand
// new database, schema.sql already reflects every migration below, so those
// files are recorded as applied without being re-run (several are destructive
// ALTERs that only make sense against a database created before schema.sql
// absorbed them) - this is what removes the "did I remember to run the new
// migration on prod" step from every schema change.
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const target = process.argv.includes("--remote") ? "--remote" : "--local";
const dbName = "mailtrack";
const serverDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const migrationsDir = path.join(serverDir, "src", "db", "migrations");
const schemaPath = path.join(serverDir, "src", "db", "schema.sql");

// Invoke wrangler's own JS entrypoint with `node` directly instead of the
// `npx`/`wrangler` shell shims - on Windows those are .cmd files that only
// run through cmd.exe, which re-tokenizes argv and mangles the quotes/spaces
// in SQL passed via --command. `node <script>.js ...args` is a plain argv
// exec with no shell involved, so nothing gets re-parsed.
const wranglerBin = path.join(serverDir, "node_modules", "wrangler", "bin", "wrangler.js");

function d1(args) {
  const out = execFileSync(
    process.execPath,
    [wranglerBin, "d1", "execute", dbName, target, "--json", ...args],
    { encoding: "utf8", cwd: serverDir },
  );
  return JSON.parse(out);
}

function d1Command(sql) {
  return d1(["--command", sql])[0].results;
}

function d1File(file) {
  d1(["--file", file]);
}

const MIGRATION_NAME_PATTERN = /^[\w.-]+\.sql$/;

function assertSafeName(name) {
  if (!MIGRATION_NAME_PATTERN.test(name)) {
    throw new Error(`Refusing to run migration with unexpected filename: ${name}`);
  }
}

const preExisting = d1Command(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='emails'",
);
const isFreshDatabase = preExisting.length === 0;

console.log(`Applying schema.sql (${target})...`);
d1File(schemaPath);

d1Command(
  "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))",
);

const migrationFiles = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

if (isFreshDatabase) {
  for (const file of migrationFiles) {
    assertSafeName(file);
    d1Command(`INSERT OR IGNORE INTO _migrations (name) VALUES ('${file}')`);
    console.log(`Marked ${file} as already satisfied by a fresh schema.`);
  }
} else {
  const applied = new Set(d1Command("SELECT name FROM _migrations").map((r) => r.name));

  for (const file of migrationFiles) {
    if (applied.has(file)) continue;
    assertSafeName(file);
    console.log(`Applying migration ${file}...`);
    d1File(path.join(migrationsDir, file));
    d1Command(`INSERT INTO _migrations (name) VALUES ('${file}')`);
  }
}

console.log("Migrations up to date.");
