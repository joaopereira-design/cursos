import "dotenv/config";
import { mkdir, readFile, stat, statfs, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import input from "input";
import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { driveClient, ensureFolder, uploadFileToDrive } from "./google-drive.mjs";

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH?.trim();
const importConfig = await readImportConfig();
const channel = importConfig.channel || process.env.TELEGRAM_CHANNEL || "https://t.me/+nXEzwpQPrktiNjhk";
const maxMessages = Number(importConfig.maxMessages || process.env.MAX_MESSAGES || 500);
const downloadMedia = process.env.DOWNLOAD_MEDIA !== "false";
const downloadConcurrency = Math.max(1, Math.min(Number(importConfig.downloadConcurrency || process.env.DOWNLOAD_CONCURRENCY || 3), 8));
const includeVideos = importConfig.includeVideos !== false;
const includeMaterials = importConfig.includeMaterials !== false;
const importOrder = importConfig.order || "tag";
const allowedExtensions = parseExtensions(importConfig.allowedExtensions);
const storageMode = importConfig.storageMode || "local";
const useDrive = storageMode === "drive" || storageMode === "both";
const driveMakePublic = Boolean(importConfig.driveMakePublic);

if (!apiId || !apiHash || apiId === 123456 || apiHash === "coloque_seu_api_hash") {
  console.error(`
Configure TELEGRAM_API_ID e TELEGRAM_API_HASH reais no arquivo .env.

Como pegar:
1. Acesse https://my.telegram.org/apps
2. Entre com seu telefone do Telegram
3. Crie um app
4. Copie o "api_id" para TELEGRAM_API_ID
5. Copie o "api_hash" para TELEGRAM_API_HASH

O api_id e o api_hash nao sao seu telefone, codigo de login, bot token ou link do canal.
`);
  process.exit(1);
}

const session = new StringSession(process.env.TELEGRAM_SESSION || "");
const client = new TelegramClient(session, apiId, apiHash, { connectionRetries: 5 });
const hasSavedSession = Boolean(process.env.TELEGRAM_SESSION?.trim());

const slug = (value) => String(value || "aula")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/(^-|-$)/g, "")
  .slice(0, 72) || "aula";

async function readImportConfig() {
  try {
    return JSON.parse(await readFile("data/import-config.json", "utf8"));
  } catch {
    return {};
  }
}

function parseExtensions(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .map((item) => item.startsWith(".") ? item : `.${item}`);
}

function titleFromMessage(message, index) {
  const text = message.message || "";
  const tag = tagFromText(text);
  const taggedLine = text.split("\n").map((line) => line.trim()).find((line) => tag && line.includes(tag));
  const taggedTitle = taggedLine ? cleanTitleLine(taggedLine, tag) : "";
  if (taggedTitle) return taggedTitle.slice(0, 120);

  const firstLine = text.split("\n").map((line) => cleanTitleLine(line.trim(), tag)).find(Boolean);
  return firstLine?.slice(0, 120) || `Aula ${String(index).padStart(3, "0")}`;
}

function extensionFromMessage(message) {
  const fileName = message.file?.name || "";
  const found = fileName.match(/\.[a-z0-9]{2,5}$/i)?.[0];
  return (found || ".mp4").toLowerCase();
}

function mimeTypeFromMessage(message) {
  return message.document?.mimeType || (isVideoMessage(message) ? "video/mp4" : "application/octet-stream");
}

function isVideoMessage(message) {
  return Boolean(message.video || message.document?.mimeType?.startsWith("video/"));
}

function isDownloadableMessage(message) {
  if (isVideoMessage(message)) return includeVideos;
  if (!message.document || !includeMaterials) return false;
  if (!allowedExtensions.length) return true;
  return allowedExtensions.includes(extensionFromMessage(message));
}

function tagFromText(text) {
  return String(text || "").match(/#F\d{1,4}\b/i)?.[0]?.toUpperCase() || "";
}

function tagNumber(text) {
  const match = tagFromText(text).match(/\d+/);
  return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
}

function cleanTitleLine(line, tag = "") {
  let value = String(line || "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\[[^\]]+\]\([^)]*\)/g, "")
    .replace(/[_*`]/g, "")
    .trim();

  if (tag) {
    value = value.replace(new RegExp(tag, "i"), "").trim();
  }

  value = value
    .replace(/^[\s:;.,|_-]+/, "")
    .replace(/^[A-Z]:$/i, "")
    .replace(/^[-\\\/]+/, "")
    .trim();

  const ignored = [
    /^atencao$/i,
    /^aten[cç][aã]o$/i,
    /^clique aqui/i,
    /^utilize as/i,
    /^sum[aá]rio:?$/i,
    /^via /i,
    /^users$/i,
    /^administrator$/i,
    /^downloads$/i,
    /^kotatogram desktop$/i
  ];

  return ignored.some((pattern) => pattern.test(value)) ? "" : value;
}

function buildModuleMap(messages) {
  const map = new Map();

  for (const message of messages) {
    if (message.video || message.document) continue;

    const text = message.message || "";
    if (!text.includes("#F") && !text.includes("#f")) continue;

    let currentModule = "";
    for (const rawLine of text.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;

      const moduleMatch = line.match(/^=\s*(.+)$/);
      if (moduleMatch) {
        currentModule = moduleMatch[1].trim();
      }

      const tags = line.match(/#F\d{1,4}\b/gi) || [];
      const inlineModule = tags.length ? cleanTitleLine(line, tags[0]) : "";
      const tagOnlyLine = /^(\s*#F\d{1,4}\b)+\s*$/i.test(line);

      for (const foundTag of tags) {
        const moduleName = !tagOnlyLine && inlineModule ? inlineModule : currentModule;
        if (moduleName) {
          map.set(foundTag.toUpperCase(), moduleName);
        }
      }
    }
  }

  return map;
}

function filePathForMessage(message, index, title, type) {
  const tag = tagFromText(message.message);
  const prefix = tag ? tag.replace("#", "").toLowerCase() : String(index).padStart(3, "0");
  const id = `${String(index).padStart(3, "0")}-${prefix}-${slug(title)}`;
  const fileName = `${id}${extensionFromMessage(message)}`;
  const folder = type === "video" ? "" : "materials";
  return {
    id,
    fileName,
    folder
  };
}

async function fileExists(filePath) {
  try {
    const details = await stat(filePath);
    return details.isFile() && details.size > 0;
  } catch {
    return false;
  }
}

async function removeEmptyFile(filePath) {
  try {
    const details = await stat(filePath);
    if (details.isFile() && details.size === 0) {
      await unlink(filePath);
    }
  } catch {
    // Nothing to clean.
  }
}

async function freeDiskBytes() {
  try {
    const details = await statfs(process.cwd());
    return Number(details.bavail) * Number(details.bsize);
  } catch {
    return null;
  }
}

async function readCatalog() {
  try {
    return JSON.parse(await readFile("data/catalog.json", "utf8"));
  } catch {
    return { courses: [] };
  }
}

async function writeCatalog(course) {
  const catalog = await readCatalog();
  const courses = Array.isArray(catalog.courses) ? catalog.courses : [];
  const nextCourses = courses.filter((item) => item.id !== course.id);
  nextCourses.push(course);
  nextCourses.sort((a, b) => String(a.title).localeCompare(String(b.title), "pt-BR"));

  await writeFile("data/catalog.json", `${JSON.stringify({ courses: nextCourses }, null, 2)}\n`, "utf8");
}

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

function createProgress(total, course) {
  const progressFile = `data/import-progress-${course.id}.json`;
  const progress = {
    courseId: course.id,
    courseTitle: course.title,
    total,
    completed: 0,
    skipped: 0,
    failed: 0,
    failedItems: [],
    active: new Map(),
    startedAt: Date.now(),
    lastPrintAt: 0
  };

  const snapshot = () => {
    const active = [...progress.active.values()];
    const downloadedBytes = active.reduce((sum, item) => sum + item.downloadedBytes, 0);
    const totalBytes = active.reduce((sum, item) => sum + item.totalBytes, 0);
    const percent = total ? Math.round((progress.completed / total) * 100) : 100;
    const processedPercent = total ? Math.round(((progress.completed + progress.failed) / total) * 100) : 100;
    const elapsedSeconds = Math.max(1, Math.round((Date.now() - progress.startedAt) / 1000));

    return {
      total,
      completed: progress.completed,
      skipped: progress.skipped,
      failed: progress.failed,
      failedItems: progress.failedItems.slice(-30),
      pending: Math.max(0, total - progress.completed - progress.failed),
      percent,
      processedPercent,
      active,
      activeDownloaded: formatBytes(downloadedBytes),
      activeTotal: totalBytes ? formatBytes(totalBytes) : "",
      elapsedSeconds,
      updatedAt: new Date().toISOString()
    };
  };

  const write = async () => {
    await writeFile(progressFile, `${JSON.stringify(snapshot(), null, 2)}\n`, "utf8");
    await writeFile("data/import-progress.json", `${JSON.stringify(snapshot(), null, 2)}\n`, "utf8");
  };

  const print = (force = false) => {
    const now = Date.now();
    if (!force && now - progress.lastPrintAt < 1500) return;
    progress.lastPrintAt = now;

    const data = snapshot();
    const activeText = data.active
      .slice(0, 3)
      .map((item) => {
        const percent = item.totalBytes ? `${Math.round((item.downloadedBytes / item.totalBytes) * 100)}%` : formatBytes(item.downloadedBytes);
        return `${item.index}/${total} ${percent}`;
      })
      .join(" | ");

    console.log(`[${course.title}] Progresso: ${data.completed}/${total} baixados (${data.percent}%), ${data.failed} falhas${activeText ? ` | ativos: ${activeText}` : ""}`);
  };

  return { progress, print, write, progressFile };
}

async function runPool(items, workerCount, worker) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(workerCount, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      await worker(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
}

async function downloadWithRetry(message, mediaPath, label, onProgress) {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await removeEmptyFile(mediaPath);
      await client.downloadMedia(message, {
        outputFile: mediaPath,
        progressCallback: (downloaded, total) => onProgress?.(Number(downloaded), Number(total))
      });
      return { ok: true, error: "" };
    } catch (err) {
      const lastAttempt = attempt === maxAttempts;
      const freeBytes = await freeDiskBytes();
      const message = `${err?.message || err}${freeBytes !== null ? ` | espaco livre: ${formatBytes(freeBytes)}` : ""}`;
      console.error(`Falha ao baixar ${label} (tentativa ${attempt}/${maxAttempts}): ${message}`);
      if (lastAttempt) return { ok: false, error: message };
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }

  return { ok: false, error: "Falha desconhecida." };
}

async function uploadLessonToDrive(job) {
  const { lesson, mediaPath, fileName, message } = job;
  if (!useDrive) return { ok: true, error: "" };

  try {
    const uploaded = await uploadFileToDrive({
      filePath: mediaPath,
      fileName,
      folderId: driveFolderId,
      mimeType: mimeTypeFromMessage(message),
      makePublic: driveMakePublic
    });

    lesson.driveFileId = uploaded.id;
    lesson.driveWebViewLink = uploaded.webViewLink;
    lesson.driveWebContentLink = uploaded.webContentLink;
    lesson.drivePreviewUrl = uploaded.previewUrl;
    if (lesson.type === "video" && storageMode === "drive") lesson.video = "";
    if (lesson.type === "material" && storageMode === "drive") lesson.file = "";
    return { ok: true, error: "" };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

function inviteHashFromLink(value) {
  const text = String(value || "").trim();
  return text.match(/t\.me\/\+([^/?#]+)/i)?.[1]
    || text.match(/t\.me\/joinchat\/([^/?#]+)/i)?.[1]
    || null;
}

async function resolveChannel(value) {
  const inviteHash = inviteHashFromLink(value);
  if (!inviteHash) {
    return client.getEntity(value);
  }

  const invite = await client.invoke(new Api.messages.CheckChatInvite({ hash: inviteHash }));

  if (invite instanceof Api.ChatInviteAlready) {
    return invite.chat;
  }

  try {
    const joined = await client.invoke(new Api.messages.ImportChatInvite({ hash: inviteHash }));
    const chat = joined.chats?.[0];
    if (chat) return chat;
  } catch (err) {
    if (err?.errorMessage === "USER_ALREADY_PARTICIPANT") {
      return client.getEntity(value.replace("/+", "/joinchat/"));
    }
    throw err;
  }

  throw new Error("Nao consegui resolver o convite privado do Telegram.");
}

await client.start({
  phoneNumber: async () => input.text("Telefone com DDI: "),
  password: async () => input.text("Senha 2FA, se tiver: "),
  phoneCode: async () => input.text("Codigo recebido no Telegram: "),
  onError: (err) => {
    if (err?.errorMessage === "API_ID_INVALID") {
      console.error("O Telegram recusou seu TELEGRAM_API_ID/TELEGRAM_API_HASH. Confira os dados em https://my.telegram.org/apps.");
      return;
    }
    console.error(err);
  }
});

if (hasSavedSession) {
  console.log("\nSessao carregada do .env.");
} else {
  console.log("\nSessao salva. Coloque este valor em TELEGRAM_SESSION para nao logar de novo:");
  console.log(client.session.save());
}

let entity;
try {
  entity = await resolveChannel(channel);
} catch (err) {
  console.error(`
Nao consegui acessar o canal configurado em TELEGRAM_CHANNEL.

Confira se:
- sua conta ja entrou no canal pelo Telegram;
- o link de convite ainda esta valido;
- o .env tem o link completo, por exemplo https://t.me/+codigoDoConvite.

Erro original: ${err?.message || err}
`);
  await client.disconnect();
  process.exit(1);
}

const messages = [];

for await (const message of client.iterMessages(entity, { limit: maxMessages })) {
  messages.push(message);
}

if (importOrder === "oldest" || importOrder === "tag") {
  messages.reverse();
}
const moduleMap = buildModuleMap(messages);
const downloadableMessages = messages.filter(isDownloadableMessage);
if (importOrder === "tag") {
  downloadableMessages.sort((a, b) => tagNumber(a.message) - tagNumber(b.message) || a.id - b.id);
}
const course = {
  id: slug(importConfig.courseId || process.env.TELEGRAM_COURSE_ID || entity.title || "telegram"),
  title: importConfig.courseTitle?.trim() || process.env.TELEGRAM_COURSE_TITLE?.trim() || entity.title || "Curso do Telegram",
  instructor: "Telegram",
  source: channel,
  importedAt: new Date().toISOString(),
  lessons: []
};
const courseMediaDir = join("media", "telegram", course.id);
let driveFolderId = "";
const previousCatalog = await readCatalog();
const previousCourse = previousCatalog.courses?.find((item) => item.id === course.id);
const previousLessons = new Map((previousCourse?.lessons || []).map((lesson) => [lesson.id, lesson]));

await mkdir("data", { recursive: true });
await mkdir("media/telegram", { recursive: true });
await mkdir(courseMediaDir, { recursive: true });
await mkdir(join(courseMediaDir, "materials"), { recursive: true });

if (useDrive) {
  const drive = await driveClient();
  driveFolderId = await ensureFolder(drive, course.title || course.id);
  console.log(`Google Drive ativo. Pasta do curso: ${driveFolderId}`);
}

const lessons = [];
let catalogWriteQueue = Promise.resolve();

const lessonJobs = downloadableMessages.map((message, messageIndex) => {
  const index = messageIndex + 1;
  const type = isVideoMessage(message) ? "video" : "material";
  const tag = tagFromText(message.message);
  const title = titleFromMessage(message, index);
  const file = filePathForMessage(message, index, title, type);
  const previousLesson = previousLessons.get(file.id);
  const mediaPath = join(courseMediaDir, file.folder, file.fileName).replaceAll("\\", "/");
  const legacyPath = join("media", "telegram", file.folder, file.fileName).replaceAll("\\", "/");

  return {
    index,
    message,
    lesson: {
      id: file.id,
      type,
      tag,
      title,
      module: moduleMap.get(tag) || "",
      description: message.message || "",
      duration: "",
      source: `Mensagem ${message.id}`,
      video: previousLesson?.video || "",
      file: previousLesson?.file || "",
      driveFileId: previousLesson?.driveFileId || "",
      driveWebViewLink: previousLesson?.driveWebViewLink || "",
      driveWebContentLink: previousLesson?.driveWebContentLink || "",
      drivePreviewUrl: previousLesson?.drivePreviewUrl || ""
    },
    mediaPath,
    legacyPath,
    fileName: file.fileName
  };
});

course.lessons = lessonJobs.map((job) => job.lesson);
const progressReporter = createProgress(lessonJobs.length, course);

let savedCount = 0;
const saveProgress = async () => {
  savedCount += 1;
  course.lessons = lessonJobs.map((job) => job.lesson);
  course.importedAt = new Date().toISOString();
  catalogWriteQueue = catalogWriteQueue.then(() => writeCatalog(course));
  await catalogWriteQueue;
};

if (downloadMedia) {
  console.log(`Baixando com ${downloadConcurrency} download(s) em paralelo.`);
  await progressReporter.write();
  progressReporter.print(true);
}

await runPool(lessonJobs, downloadMedia ? downloadConcurrency : 1, async (job) => {
  const { index, lesson, mediaPath, legacyPath, message } = job;

  if (downloadMedia) {
    if (useDrive && lesson.driveFileId) {
      console.log(`Pulando ${index}/${lessonJobs.length}, ja esta no Drive: ${lesson.title}`);
      progressReporter.progress.completed += 1;
      progressReporter.progress.skipped += 1;
      await progressReporter.write();
      progressReporter.print(true);
      lessons[index - 1] = lesson;
      await saveProgress();
      return;
    }

    const existingPath = await fileExists(mediaPath) ? mediaPath : await fileExists(legacyPath) ? legacyPath : "";
    if (existingPath) {
      if (lesson.type === "video") lesson.video = existingPath;
      if (lesson.type === "material") lesson.file = existingPath;
      console.log(`Pulando ${index}/${lessonJobs.length}, ja baixado: ${lesson.title}`);
      if (useDrive && !lesson.driveFileId) {
        const upload = await uploadLessonToDrive({ ...job, mediaPath: existingPath });
        if (!upload.ok) {
          progressReporter.progress.failed += 1;
          progressReporter.progress.failedItems.push({ index, id: lesson.id, title: lesson.title, error: upload.error });
        }
      }
      progressReporter.progress.completed += 1;
      progressReporter.progress.skipped += 1;
      await progressReporter.write();
      progressReporter.print(true);
    } else {
      console.log(`Baixando ${index}/${lessonJobs.length}: ${lesson.title}`);
      progressReporter.progress.active.set(lesson.id, {
        id: lesson.id,
        index,
        title: lesson.title,
        downloadedBytes: 0,
        totalBytes: 0
      });
      const result = await downloadWithRetry(message, mediaPath, lesson.title, async (downloadedBytes, totalBytes) => {
        progressReporter.progress.active.set(lesson.id, {
          id: lesson.id,
          index,
          title: lesson.title,
          downloadedBytes,
          totalBytes
        });
        progressReporter.print();
      });
      progressReporter.progress.active.delete(lesson.id);
      if (!result.ok) {
        lesson.video = "";
        lesson.file = "";
        progressReporter.progress.failed += 1;
        progressReporter.progress.failedItems.push({
          index,
          id: lesson.id,
          title: lesson.title,
          error: result.error
        });
      } else {
        if (lesson.type === "video") lesson.video = mediaPath;
        if (lesson.type === "material") lesson.file = mediaPath;
        const upload = await uploadLessonToDrive(job);
        if (!upload.ok) {
          progressReporter.progress.failed += 1;
          progressReporter.progress.failedItems.push({ index, id: lesson.id, title: lesson.title, error: upload.error });
        } else {
          progressReporter.progress.completed += 1;
        }
      }
      await progressReporter.write();
      progressReporter.print(true);
    }
  }

  lessons[index - 1] = lesson;
  await saveProgress();
});

course.lessons = lessonJobs.map((job) => job.lesson);
course.importedAt = new Date().toISOString();
catalogWriteQueue = catalogWriteQueue.then(() => writeCatalog(course));
await catalogWriteQueue;

await client.disconnect();

console.log(`\nImportacao concluida: ${lessons.length} itens em data/catalog.json`);
console.log(`Curso: ${course.title}`);
console.log(`Pasta: ${courseMediaDir}`);
