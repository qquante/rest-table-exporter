#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const [oldDirArg, newDirArg, outputDirArg] = process.argv.slice(2);

if (!oldDirArg || !newDirArg) {
  console.error(`Uso:
  node .\\compare-supabase-exports.mjs <export-antigo> <export-novo> [output-dir]

Exemplo:
  node .\\compare-supabase-exports.mjs .\\supabase-export .\\supabase-export-2026-07-20 .\\supabase-diff-2026-07-20`);
  process.exit(1);
}

const OLD_DIR = resolve(oldDirArg);
const NEW_DIR = resolve(newDirArg);
const OUTPUT_DIR = resolve(outputDirArg || `supabase-diff-${timestampForPath()}`);

const oldManifest = readManifest(OLD_DIR);
const newManifest = readManifest(NEW_DIR);

mkdirSync(OUTPUT_DIR, { recursive: true });

const oldTables = tableMap(oldManifest);
const newTables = tableMap(newManifest);
const names = Array.from(new Set([...oldTables.keys(), ...newTables.keys()])).sort((a, b) => a.localeCompare(b));

const rows = [];

for (const table of names) {
  const oldInfo = oldTables.get(table);
  const newInfo = newTables.get(table);
  const oldFile = oldInfo?.file || join(OLD_DIR, `${safeFileName(table)}.jsonl`);
  const newFile = newInfo?.file || join(NEW_DIR, `${safeFileName(table)}.jsonl`);
  const oldExists = existsSync(oldFile);
  const newExists = existsSync(newFile);
  const oldHash = oldExists ? await sha256(oldFile) : "";
  const newHash = newExists ? await sha256(newFile) : "";

  const row = {
    table,
    oldOk: Boolean(oldInfo?.ok),
    newOk: Boolean(newInfo?.ok),
    oldRows: numberOrNull(oldInfo?.rows),
    newRows: numberOrNull(newInfo?.rows),
    rowDelta: numberOrNull(newInfo?.rows) !== null && numberOrNull(oldInfo?.rows) !== null ? Number(newInfo.rows) - Number(oldInfo.rows) : null,
    oldPages: numberOrNull(oldInfo?.pages),
    newPages: numberOrNull(newInfo?.pages),
    oldFileExists: oldExists,
    newFileExists: newExists,
    oldSha256: oldHash,
    newSha256: newHash,
    changed: oldHash !== newHash || Boolean(oldInfo?.ok) !== Boolean(newInfo?.ok) || numberOrNull(oldInfo?.rows) !== numberOrNull(newInfo?.rows),
    oldError: oldInfo?.error?.message || "",
    newError: newInfo?.error?.message || "",
  };

  rows.push(row);
}

const summary = {
  generatedAt: new Date().toISOString(),
  oldDir: OLD_DIR,
  newDir: NEW_DIR,
  oldStartedAt: oldManifest.startedAt,
  oldFinishedAt: oldManifest.finishedAt,
  newStartedAt: newManifest.startedAt,
  newFinishedAt: newManifest.finishedAt,
  oldTables: oldManifest.tables?.length || 0,
  newTables: newManifest.tables?.length || 0,
  oldOk: rows.filter((row) => row.oldOk).length,
  newOk: rows.filter((row) => row.newOk).length,
  oldFailed: rows.filter((row) => oldTables.has(row.table) && !row.oldOk).length,
  newFailed: rows.filter((row) => newTables.has(row.table) && !row.newOk).length,
  oldRowsOk: sumRows(rows, "oldRows", "oldOk"),
  newRowsOk: sumRows(rows, "newRows", "newOk"),
  changedTables: rows.filter((row) => row.changed).length,
  addedTables: rows.filter((row) => !oldTables.has(row.table) && newTables.has(row.table)).map((row) => row.table),
  removedTables: rows.filter((row) => oldTables.has(row.table) && !newTables.has(row.table)).map((row) => row.table),
  fixedFailures: rows.filter((row) => !row.oldOk && row.newOk).map((row) => row.table),
  newFailures: rows.filter((row) => row.oldOk && !row.newOk).map((row) => row.table),
};

writeFileSync(join(OUTPUT_DIR, "comparison.json"), `${JSON.stringify({ summary, tables: rows }, null, 2)}\n`, "utf8");
writeFileSync(join(OUTPUT_DIR, "comparison.csv"), toCsv(rows), "utf8");
writeFileSync(join(OUTPUT_DIR, "summary.txt"), renderSummary(summary, rows), "utf8");

console.log(renderSummary(summary, rows));
console.log(`\nArquivos:`);
console.log(`  ${join(OUTPUT_DIR, "summary.txt")}`);
console.log(`  ${join(OUTPUT_DIR, "comparison.csv")}`);
console.log(`  ${join(OUTPUT_DIR, "comparison.json")}`);

function readManifest(dir) {
  const file = join(dir, "manifest.json");
  if (!existsSync(file)) {
    console.error(`Manifest nao encontrado: ${file}`);
    process.exit(1);
  }

  return JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function tableMap(manifest) {
  const map = new Map();
  for (const table of manifest.tables || []) {
    map.set(table.table, table);
  }
  return map;
}

function numberOrNull(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function sumRows(rows, key, okKey) {
  return rows.reduce((sum, row) => row[okKey] && row[key] !== null ? sum + row[key] : sum, 0);
}

function sha256(file) {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash("sha256");
    const stream = createReadStream(file);

    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", rejectHash);
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

function toCsv(rows) {
  const columns = [
    "table",
    "oldOk",
    "newOk",
    "oldRows",
    "newRows",
    "rowDelta",
    "oldPages",
    "newPages",
    "changed",
    "oldError",
    "newError",
    "oldSha256",
    "newSha256",
  ];

  return `${columns.join(",")}\n${rows.map((row) => columns.map((column) => csvValue(row[column])).join(",")).join("\n")}\n`;
}

function csvValue(value) {
  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function renderSummary(summary, rows) {
  const changed = rows
    .filter((row) => row.changed)
    .sort((a, b) => Math.abs(b.rowDelta || 0) - Math.abs(a.rowDelta || 0) || a.table.localeCompare(b.table));

  const topChanged = changed.slice(0, 30).map((row) => {
    const delta = row.rowDelta === null ? "n/a" : signed(row.rowDelta);
    return `- ${row.table}: old=${row.oldRows ?? "n/a"} new=${row.newRows ?? "n/a"} delta=${delta} oldOk=${row.oldOk} newOk=${row.newOk}`;
  });

  return [
    `Old: ${basename(summary.oldDir)} tables=${summary.oldTables} ok=${summary.oldOk} failed=${summary.oldFailed} rowsOk=${summary.oldRowsOk}`,
    `New: ${basename(summary.newDir)} tables=${summary.newTables} ok=${summary.newOk} failed=${summary.newFailed} rowsOk=${summary.newRowsOk}`,
    `Changed tables: ${summary.changedTables}`,
    `Added tables: ${summary.addedTables.length ? summary.addedTables.join(", ") : "none"}`,
    `Removed tables: ${summary.removedTables.length ? summary.removedTables.join(", ") : "none"}`,
    `Fixed failures: ${summary.fixedFailures.length ? summary.fixedFailures.join(", ") : "none"}`,
    `New failures: ${summary.newFailures.length ? summary.newFailures.join(", ") : "none"}`,
    "",
    "Top changed by row delta/hash:",
    ...(topChanged.length ? topChanged : ["- none"]),
  ].join("\n");
}

function signed(value) {
  return value > 0 ? `+${value}` : String(value);
}

function timestampForPath() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function safeFileName(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}
