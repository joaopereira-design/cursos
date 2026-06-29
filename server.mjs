import { appendFileSync, closeSync, createReadStream, existsSync, openSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, extname, join, normalize, parse, resolve } from "node:path";
import { spawn } from "node:child_process";
import { authUrl, driveConfigured, driveTokenSaved, saveCodeToken } from "./scripts/google-drive.mjs";
import {
  normalizeOwnerId,
  readCatalogFromSupabase,
  readWatchProgressFromSupabase,
  supabaseConfigured,
  writeWatchProgressToSupabase
} from "./scripts/supabase-api.mjs";

const root = process.cwd();
const port = Number(process.env.PORT || 5173);
const configPath = join(root, "data", "import-config.json");
const progressPath = join(root, "data", "import-progress.json");
const watchProgressPath = join(root, "data", "watch-progress.json");
const logPath = join(root, "data", "import-run.log");
let importProcess = null;

const defaultImportConfig = {
  channel: process.env.TELEGRAM_CHANNEL || "",
  courseId: process.env.TELEGRAM_COURSE_ID || "",
  courseTitle: process.env.TELEGRAM_COURSE_TITLE || "",
  includeVideos: true,
  includeMaterials: true,
  storageMode: "local",
  driveMakePublic: false,
  allowedExtensions: ".pdf,.rar,.zip,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt",
  order: "tag",
  downloadConcurrency: Number(process.env.DOWNLOAD_CONCURRENCY || 3),
  maxMessages: Number(process.env.MAX_MESSAGES || 500)
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".rar": "application/vnd.rar",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml"
};

function sendFile(req, res, filePath) {
  const type = mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream";
  const details = statSync(filePath);
  const range = req.headers.range;

  if (range) {
    const match = range.match(/bytes=(\d*)-(\d*)/);
    const start = match?.[1] ? Number(match[1]) : 0;
    const end = match?.[2] ? Number(match[2]) : details.size - 1;

    if (start >= details.size || end >= details.size) {
      res.writeHead(416, { "Content-Range": `bytes */${details.size}` });
      res.end();
      return;
    }

    res.writeHead(206, {
      "Content-Type": type,
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${details.size}`,
      "Accept-Ranges": "bytes"
    });
    createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": details.size,
    "Accept-Ranges": "bytes"
  });
  createReadStream(filePath).pipe(res);
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function readRequestJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

function fallbackOwnerIdFrom(req, url) {
  return normalizeOwnerId(req.headers["x-owner-id"] || url.searchParams.get("ownerId") || process.env.DEFAULT_OWNER_ID);
}

async function ownerIdFrom(req, url) {
  const auth = String(req.headers.authorization || "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const supabaseUrl = process.env.SUPABASE_URL || (process.env.SUPABASE_PROJECT_ID ? `https://${process.env.SUPABASE_PROJECT_ID}.supabase.co` : "");
  const publicKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  if (token && supabaseUrl && publicKey) {
    try {
      const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
        headers: {
          apikey: publicKey,
          Authorization: `Bearer ${token}`
        }
      });
      if (response.ok) {
        const user = await response.json();
        if (user?.id) return normalizeOwnerId(user.id);
      }
    } catch {
      // Fall back below for local/offline use.
    }
  }

  return fallbackOwnerIdFrom(req, url);
}

async function tailLog(maxBytes = 12000) {
  try {
    const details = statSync(logPath);
    const start = Math.max(0, details.size - maxBytes);
    const file = await readFile(logPath);
    return file.subarray(start).toString("utf8");
  } catch {
    return "";
  }
}

async function handleApi(req, res, url) {
  const ownerId = await ownerIdFrom(req, url);

  if (url.pathname === "/api/supabase/public-config" && req.method === "GET") {
    sendJson(res, {
      url: process.env.SUPABASE_URL || (process.env.SUPABASE_PROJECT_ID ? `https://${process.env.SUPABASE_PROJECT_ID}.supabase.co` : ""),
      key: process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || ""
    });
    return true;
  }

  if (url.pathname === "/api/catalog" && req.method === "GET") {
    if (supabaseConfigured()) {
      try {
        sendJson(res, await readCatalogFromSupabase(ownerId));
        return true;
      } catch {
        // Fall back to the local catalog while Supabase is being prepared.
      }
    }
    sendJson(res, await readJson(join(root, "data", "catalog.json"), { courses: [] }));
    return true;
  }

  if (url.pathname === "/api/import-config" && req.method === "GET") {
    const saved = await readJson(configPath, {});
    sendJson(res, { ...defaultImportConfig, ...saved });
    return true;
  }

  if (url.pathname === "/api/import-config" && req.method === "POST") {
    const body = await readRequestJson(req);
    const config = {
      ...defaultImportConfig,
      channel: String(body.channel || "").trim(),
      courseId: String(body.courseId || "").trim(),
      courseTitle: String(body.courseTitle || "").trim(),
      includeVideos: Boolean(body.includeVideos),
      includeMaterials: Boolean(body.includeMaterials),
      storageMode: ["local", "drive", "both"].includes(body.storageMode) ? body.storageMode : "local",
      driveMakePublic: Boolean(body.driveMakePublic),
      allowedExtensions: String(body.allowedExtensions || "").trim(),
      order: ["tag", "oldest", "newest"].includes(body.order) ? body.order : "tag",
      downloadConcurrency: Math.max(1, Math.min(Number(body.downloadConcurrency || 3), 8)),
      maxMessages: Math.max(1, Number(body.maxMessages || 500))
    };
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    sendJson(res, config);
    return true;
  }

  if (url.pathname === "/api/import/start" && req.method === "POST") {
    if (importProcess && !importProcess.killed) {
      sendJson(res, { ok: false, message: "Importacao ja esta rodando.", running: true }, 409);
      return true;
    }

    await mkdir(join(root, "data"), { recursive: true });
    appendFileSync(logPath, `\n\n=== Importacao iniciada em ${new Date().toISOString()} ===\n`, "utf8");
    const logFd = openSync(logPath, "a");
    importProcess = spawn(process.execPath, ["scripts/import-telegram.mjs"], {
      cwd: root,
      env: { ...process.env, OWNER_ID: ownerId },
      windowsHide: true,
      stdio: ["ignore", logFd, logFd]
    });
    importProcess.on("exit", (code) => {
      appendFileSync(logPath, `\n=== Importacao finalizada com codigo ${code} em ${new Date().toISOString()} ===\n`, "utf8");
      closeSync(logFd);
      importProcess = null;
    });
    sendJson(res, { ok: true, running: true, pid: importProcess.pid });
    return true;
  }

  if (url.pathname === "/api/drive/status" && req.method === "GET") {
    sendJson(res, {
      configured: driveConfigured(),
      connected: driveConfigured() ? await driveTokenSaved(ownerId) : false,
      redirectUri: process.env.GOOGLE_DRIVE_REDIRECT_URI || "http://localhost:5173/api/drive/callback"
    });
    return true;
  }

  if (url.pathname === "/api/drive/auth-url" && req.method === "GET") {
    sendJson(res, { url: authUrl(ownerId) });
    return true;
  }

  if (url.pathname === "/api/drive/callback" && req.method === "GET") {
    const code = url.searchParams.get("code");
    if (!code) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Codigo do Google Drive ausente.");
      return true;
    }
    await saveCodeToken(code, normalizeOwnerId(url.searchParams.get("state") || ownerId));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h1>Google Drive conectado.</h1><p>Voce pode voltar para a plataforma.</p>");
    return true;
  }

  if (url.pathname === "/api/watch-progress" && req.method === "GET") {
    const deviceId = req.headers["x-device-id"] || url.searchParams.get("deviceId") || "";
    if (supabaseConfigured() && deviceId) {
      try {
        sendJson(res, await readWatchProgressFromSupabase(ownerId, String(deviceId)));
        return true;
      } catch {
        // Fall back to local progress.
      }
    }
    sendJson(res, await readJson(watchProgressPath, {}));
    return true;
  }

  if (url.pathname === "/api/watch-progress" && req.method === "POST") {
    const body = await readRequestJson(req);
    const deviceId = req.headers["x-device-id"] || "";
    if (supabaseConfigured() && deviceId) {
      try {
        sendJson(res, { ok: true, ...(await writeWatchProgressToSupabase(ownerId, String(deviceId), body)) });
        return true;
      } catch {
        // Also keep the local copy if Supabase is temporarily unavailable.
      }
    }
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(watchProgressPath, `${JSON.stringify(body || {}, null, 2)}\n`, "utf8");
    sendJson(res, { ok: true });
    return true;
  }

  if (url.pathname === "/api/material/extract" && req.method === "POST") {
    const body = await readRequestJson(req);
    const relativeFile = String(body.file || "");
    const filePath = resolve(join(root, normalize(relativeFile)));

    if (!filePath.startsWith(root) || extname(filePath).toLowerCase() !== ".zip" || !existsSync(filePath)) {
      sendJson(res, { ok: false, message: "Arquivo .zip invalido." }, 400);
      return true;
    }

    const parsed = parse(filePath);
    const destination = resolve(join(parsed.dir, `${parsed.name}-extraido`));
    if (!destination.startsWith(root)) {
      sendJson(res, { ok: false, message: "Destino invalido." }, 400);
      return true;
    }

    await mkdir(destination, { recursive: true });
    const child = spawn("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force",
      filePath,
      destination
    ], { windowsHide: true });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    const code = await new Promise((resolveExit) => child.on("exit", resolveExit));
    if (code !== 0) {
      sendJson(res, { ok: false, message: stderr || "Nao consegui descompactar o arquivo." }, 500);
      return true;
    }

    sendJson(res, {
      ok: true,
      folder: normalize(destination.replace(root, "")).replace(/^[/\\]/, "").replaceAll("\\", "/"),
      name: basename(destination)
    });
    return true;
  }

  if (url.pathname === "/api/import/status" && req.method === "GET") {
    const progress = await readJson(progressPath, null);
    sendJson(res, {
      running: Boolean(importProcess && !importProcess.killed),
      pid: importProcess?.pid || null,
      progress,
      log: await tailLog()
    });
    return true;
  }

  return false;
}

createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${port}`);
  if (url.pathname.startsWith("/api/")) {
    try {
      if (await handleApi(req, res, url)) return;
    } catch (err) {
      sendJson(res, { ok: false, message: err?.message || String(err) }, 500);
      return;
    }
  }

  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = resolve(join(root, safePath));

  if (!filePath.startsWith(root) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Arquivo nao encontrado");
    return;
  }

  sendFile(req, res, filePath);
}).listen(port, () => {
  console.log(`Plataforma rodando em http://localhost:${port}`);
});
