#!/usr/bin/env node

import { once } from "node:events";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

loadDotEnv(resolve(".env"));

const env = process.env;
const SUPABASE_URL = cleanUrl(env.SUPABASE_URL);
const SUPABASE_KEY = env.SUPABASE_KEY || env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
const SUPABASE_AUTH_TOKEN = env.SUPABASE_AUTH_TOKEN || "";
const SUPABASE_SCHEMA = env.SUPABASE_SCHEMA || "public";
const TABLE = env.TABLE || env.TABLES;
const ORDER_COLUMN = env.ORDER_COLUMN;
const PAGE_SIZE = parseIntEnv("PAGE_SIZE", 1000);
const OUTPUT_DIR = resolve(env.OUTPUT_DIR || `supabase-keyset-export-${timestampForPath()}`);
const SELECT = env.SELECT || "*";

if (!SUPABASE_URL || !SUPABASE_KEY || !TABLE || !ORDER_COLUMN) {
  fail(`Variaveis obrigatorias ausentes.

Defina:
  SUPABASE_URL=https://<project-ref>.supabase.co
  SUPABASE_KEY=<anon|publishable|service_role|secret>
  TABLE=<tabela>
  ORDER_COLUMN=<coluna-unica-ou-estavel>

Opcional:
  SUPABASE_AUTH_TOKEN=<jwt-de-usuario-logado>
  SUPABASE_SCHEMA=public
  OUTPUT_DIR=./retry
  PAGE_SIZE=1000
  SELECT=*`);
}

if (TABLE.includes(",")) {
  fail("export-supabase-keyset.mjs aceita uma tabela por execucao. Use TABLE=nome_da_tabela.");
}

if (PAGE_SIZE < 1 || PAGE_SIZE > 10000) {
  fail("PAGE_SIZE deve ficar entre 1 e 10000.");
}

mkdirSync(OUTPUT_DIR, { recursive: true });

const outputFile = join(OUTPUT_DIR, `${safeFileName(TABLE)}.jsonl`);
const manifest = {
  startedAt: new Date().toISOString(),
  strategy: "keyset",
  supabaseUrl: SUPABASE_URL,
  schema: SUPABASE_SCHEMA,
  outputDir: OUTPUT_DIR,
  table: TABLE,
  orderColumn: ORDER_COLUMN,
  select: SELECT,
  pageSize: PAGE_SIZE,
  file: outputFile,
  rows: 0,
  pages: 0,
  ok: false,
};

main().catch((error) => {
  manifest.finishedAt = new Date().toISOString();
  manifest.error = normalizeError(error);
  writeManifest();
  console.error(`Falha: ${error.message}`);
  process.exit(1);
});

async function main() {
  console.log(`Keyset export: ${TABLE}`);
  console.log(`Order: ${ORDER_COLUMN}.asc`);
  console.log(`Output: ${outputFile}`);

  const stream = createWriteStream(outputFile, { encoding: "utf8" });
  let lastValue = null;

  try {
    while (true) {
      const url = new URL(`${SUPABASE_URL}/rest/v1/${encodeURIComponent(TABLE)}`);
      url.searchParams.set("select", SELECT);
      url.searchParams.set("order", `${ORDER_COLUMN}.asc`);
      url.searchParams.set("limit", String(PAGE_SIZE));

      if (lastValue !== null) {
        url.searchParams.set(ORDER_COLUMN, `gt.${lastValue}`);
      }

      const response = await fetch(url, {
        method: "GET",
        headers: baseHeaders(),
      });

      if (!response.ok) {
        const body = await safeText(response);
        throw new Error(`HTTP ${response.status}: ${body}`);
      }

      const page = await response.json();
      if (!Array.isArray(page)) {
        throw new Error(`Resposta inesperada para ${TABLE}: esperado array JSON.`);
      }

      for (const row of page) {
        if (row[ORDER_COLUMN] === undefined || row[ORDER_COLUMN] === null) {
          throw new Error(`Linha sem valor em ORDER_COLUMN=${ORDER_COLUMN}.`);
        }

        if (!stream.write(`${JSON.stringify(row)}\n`)) {
          await once(stream, "drain");
        }
      }

      manifest.rows += page.length;
      manifest.pages += 1;

      if (page.length > 0) {
        lastValue = page[page.length - 1][ORDER_COLUMN];
        manifest.lastValue = lastValue;
      }

      writeManifest();
      process.stdout.write(`  ${TABLE}: ${manifest.rows} linhas\r`);

      if (page.length < PAGE_SIZE) {
        break;
      }
    }
  } finally {
    await closeStream(stream);
  }

  manifest.ok = true;
  manifest.finishedAt = new Date().toISOString();
  writeManifest();
  process.stdout.write("\n");
  console.log(`OK ${TABLE}: ${manifest.rows} linhas em ${manifest.pages} pagina(s)`);
}

function baseHeaders() {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_AUTH_TOKEN || SUPABASE_KEY}`,
    "Accept-Profile": SUPABASE_SCHEMA,
  };
}

function closeStream(stream) {
  return new Promise((resolveClose, rejectClose) => {
    stream.end((error) => {
      if (error) rejectClose(error);
      else resolveClose();
    });
  });
}

function writeManifest() {
  writeFileSync(join(OUTPUT_DIR, `${safeFileName(TABLE)}.keyset-manifest.json`), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) return;

  const content = readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;

    process.env[key] = parseDotEnvValue(rawValue);
  }
}

function parseDotEnvValue(rawValue) {
  let value = rawValue.trim();
  const quote = value[0];

  if ((quote === "\"" || quote === "'") && value.endsWith(quote)) {
    value = value.slice(1, -1);
  }

  if (quote === "\"") {
    value = value
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, "\"")
      .replace(/\\\\/g, "\\");
  }

  return value;
}

function cleanUrl(value) {
  if (!value) return "";
  return value.replace(/\/+$/, "");
}

function parseIntEnv(name, fallback) {
  const value = env[name];
  if (!value) return fallback;

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    fail(`${name} precisa ser numero inteiro.`);
  }

  return parsed;
}

function timestampForPath() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function safeFileName(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function normalizeError(error) {
  return {
    message: error.message,
    name: error.name,
    stack: error.stack,
  };
}

async function safeText(response) {
  const text = await response.text();
  return text.length > 2000 ? `${text.slice(0, 2000)}...` : text;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
