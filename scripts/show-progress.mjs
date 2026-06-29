import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

function formatBytes(bytes = 0) {
  const units = ["B", "KB", "MB", "GB"];
  let value = Number(bytes) || 0;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

async function walkFiles(dir) {
  const results = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...await walkFiles(path));
      } else if (entry.isFile()) {
        results.push(path);
      }
    }
  } catch {
    return results;
  }
  return results;
}

async function readProgressFiles() {
  try {
    const files = await readdir("data");
    const progressFiles = files.filter((file) => /^import-progress.*\.json$/.test(file));
    const progressByCourse = new Map();

    for (const file of progressFiles) {
      const progress = JSON.parse(await readFile(join("data", file), "utf8"));
      const key = progress.courseId || file;
      const previous = progressByCourse.get(key);
      if (!previous || String(progress.updatedAt || "") > String(previous.updatedAt || "")) {
        progressByCourse.set(key, progress);
      }
    }

    return [...progressByCourse.values()].sort((a, b) => String(a.courseTitle || a.courseId).localeCompare(String(b.courseTitle || b.courseId), "pt-BR"));
  } catch {
    return [];
  }
}

const files = await walkFiles("media/telegram");
let totalBytes = 0;
for (const file of files) {
  totalBytes += (await stat(file)).size;
}

const progressList = await readProgressFiles();

if (progressList.length) {
  for (const progress of progressList) {
    console.log(`\n${progress.courseTitle || progress.courseId || "Curso"}`);
  console.log(`Progresso: ${progress.completed}/${progress.total} concluidos (${progress.percent}%)`);
  console.log(`Pendentes: ${progress.pending} | Pulados: ${progress.skipped} | Falhas: ${progress.failed}`);
  console.log(`Atualizado em: ${progress.updatedAt}`);
  if (progress.active?.length) {
    console.log("Baixando agora:");
    for (const item of progress.active) {
      const percent = item.totalBytes ? `${Math.round((item.downloadedBytes / item.totalBytes) * 100)}%` : formatBytes(item.downloadedBytes);
      console.log(`- ${item.index}/${progress.total} ${percent} ${item.title}`);
    }
  }
  }
} else {
  console.log("Ainda nao existe data/import-progress.json. Rode npm.cmd run import:telegram para criar.");
}

console.log(`\nArquivos locais: ${files.length} (${formatBytes(totalBytes)})`);
