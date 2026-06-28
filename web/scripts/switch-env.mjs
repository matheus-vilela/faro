#!/usr/bin/env node
/**
 * Alterna blocos DEV / PRODUÇÃO em web/.env (comenta um e descomenta o outro).
 * Uso: yarn env dev | yarn env prod
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const target = process.argv[2];
if (target !== "dev" && target !== "prod") {
  console.error("Uso: yarn env dev | yarn env prod");
  process.exit(1);
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");

if (!fs.existsSync(envPath)) {
  console.error(`Arquivo não encontrado: ${envPath}`);
  console.error("Copie .env.example para .env e preencha os valores.");
  process.exit(1);
}

const DEV_MARKER = "# --- DEV ---";
const PROD_MARKER = "# --- PRODUÇÃO ---";

const raw = fs.readFileSync(envPath, "utf8");
const lines = raw.split("\n");

const devIdx = lines.findIndex((l) => l.trim() === DEV_MARKER);
const prodIdx = lines.findIndex((l) => l.trim() === PROD_MARKER);

if (devIdx < 0 || prodIdx < 0 || prodIdx <= devIdx) {
  console.error(
    `Marcadores esperados em .env:\n  ${DEV_MARKER}\n  ${PROD_MARKER}`,
  );
  process.exit(1);
}

const isVarLine = (line) => /^\s*(#\s*)?VITE_/.test(line);

const uncommentLine = (line) => {
  const m = line.match(/^(\s*)#\s*(VITE_.*)$/);
  return m ? `${m[1]}${m[2]}` : line;
};

const commentLine = (line) => {
  if (/^\s*#/.test(line)) return line;
  const m = line.match(/^(\s*)(VITE_.*)$/);
  return m ? `${m[1]}# ${m[2]}` : line;
};

const toggleSection = (sectionLines, active) =>
  sectionLines.map((line) => {
    if (!isVarLine(line)) return line;
    return active ? uncommentLine(line) : commentLine(line);
  });

const before = lines.slice(0, devIdx + 1);
const devSection = lines.slice(devIdx + 1, prodIdx);
const prodSection = lines.slice(prodIdx + 1);

const next = [
  ...before,
  ...toggleSection(devSection, target === "dev"),
  lines[prodIdx],
  ...toggleSection(prodSection, target === "prod"),
];

const hadTrailingNewline = raw.endsWith("\n");
const output = next.join("\n") + (hadTrailingNewline || next.length > 0 ? "\n" : "");

fs.writeFileSync(envPath, output, "utf8");

const label = target === "dev" ? "DEV" : "PRODUÇÃO";
console.log(`Ambiente ativo: ${label} (.env atualizado)`);
console.log("Reinicie o Vite se estiver rodando: yarn dev");
