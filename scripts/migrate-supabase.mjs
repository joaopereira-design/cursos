import "dotenv/config";
import { readFile } from "node:fs/promises";
import {
  saveSecretToSupabase,
  supabaseConfigured,
  writeCatalogToSupabase,
  writeWatchProgressToSupabase
} from "./supabase-api.mjs";

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

if (!supabaseConfigured()) {
  throw new Error("Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env antes de migrar.");
}

const catalog = await readJson("data/catalog.json", { courses: [] });
const progress = await readJson("data/watch-progress.json", {});
const driveToken = await readJson("data/google-drive-token.json", null);
const ownerId = process.env.OWNER_ID || process.env.DEFAULT_OWNER_ID || "local-owner";

const catalogResult = await writeCatalogToSupabase(catalog, ownerId);
console.log(`Catalogo enviado para ${ownerId}: ${catalogResult.courses} cursos, ${catalogResult.lessons} aulas/materiais.`);

if (Object.keys(progress || {}).length) {
  const progressResult = await writeWatchProgressToSupabase(ownerId, "local-owner", progress);
  console.log(`Progresso local enviado: ${progressResult.progress} aulas marcadas.`);
} else {
  console.log("Nenhum progresso local encontrado para enviar.");
}

if (driveToken) {
  await saveSecretToSupabase("google_drive_token", driveToken, ownerId);
  console.log("Token do Google Drive enviado para app_secrets.");
} else {
  console.log("Token do Google Drive local nao encontrado.");
}

console.log("Migracao Supabase concluida.");
