import "dotenv/config";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { google } from "googleapis";
import { readSecretFromSupabase, saveSecretToSupabase, supabaseConfigured } from "./supabase-api.mjs";

const tokenPath = "data/google-drive-token.json";
const scopes = ["https://www.googleapis.com/auth/drive.file"];

function credentials() {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_DRIVE_REDIRECT_URI || "http://localhost:5173/api/drive/callback";

  if (!clientId || !clientSecret) {
    throw new Error("Configure GOOGLE_DRIVE_CLIENT_ID e GOOGLE_DRIVE_CLIENT_SECRET no .env");
  }

  return { clientId, clientSecret, redirectUri };
}

export function driveConfigured() {
  return Boolean(process.env.GOOGLE_DRIVE_CLIENT_ID && process.env.GOOGLE_DRIVE_CLIENT_SECRET);
}

export async function driveTokenSaved(ownerId) {
  if (supabaseConfigured()) {
    try {
      const token = await readSecretFromSupabase("google_drive_token", ownerId);
      if (token?.refresh_token || token?.access_token) return true;
    } catch {
      // Fall back to the local token file.
    }
  }

  try {
    const token = JSON.parse(await readFile(tokenPath, "utf8"));
    return Boolean(token.refresh_token || token.access_token);
  } catch {
    return false;
  }
}

export async function driveClient(ownerId) {
  const { clientId, clientSecret, redirectUri } = credentials();
  const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  try {
    const token = supabaseConfigured()
      ? await readSecretFromSupabase("google_drive_token", ownerId).catch(() => null)
      : null;
    auth.setCredentials(token || JSON.parse(await readFile(tokenPath, "utf8")));
  } catch {
    throw new Error("Google Drive ainda nao esta conectado.");
  }

  return google.drive({ version: "v3", auth });
}

export function authUrl(ownerId) {
  const { clientId, clientSecret, redirectUri } = credentials();
  const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  return auth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: scopes,
    state: ownerId || "local-owner"
  });
}

export async function saveCodeToken(code, ownerId) {
  const { clientId, clientSecret, redirectUri } = credentials();
  const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const { tokens } = await auth.getToken(code);
  await mkdir(dirname(tokenPath), { recursive: true });
  await writeFile(tokenPath, `${JSON.stringify(tokens, null, 2)}\n`, "utf8");
  if (supabaseConfigured()) {
    await saveSecretToSupabase("google_drive_token", tokens, ownerId).catch(() => {});
  }
  return tokens;
}

export async function ensureFolder(drive, name, parentId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || "") {
  const escapedName = String(name).replaceAll("'", "\\'");
  const parentQuery = parentId ? ` and '${parentId}' in parents` : "";
  const response = await drive.files.list({
    q: `mimeType='application/vnd.google-apps.folder' and name='${escapedName}' and trashed=false${parentQuery}`,
    fields: "files(id, name)",
    spaces: "drive"
  });

  const existing = response.data.files?.[0];
  if (existing?.id) return existing.id;

  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      ...(parentId ? { parents: [parentId] } : {})
    },
    fields: "id"
  });

  return created.data.id;
}

export async function uploadFileToDrive({ filePath, fileName, folderId, mimeType = "application/octet-stream", makePublic = false, ownerId }) {
  const drive = await driveClient(ownerId);
  const response = await drive.files.create({
    requestBody: {
      name: fileName,
      ...(folderId ? { parents: [folderId] } : {})
    },
    media: {
      mimeType,
      body: createReadStream(filePath)
    },
    fields: "id, name, webViewLink, webContentLink"
  });

  if (makePublic && response.data.id) {
    await drive.permissions.create({
      fileId: response.data.id,
      requestBody: {
        role: "reader",
        type: "anyone"
      }
    });
  }

  return {
    id: response.data.id,
    name: response.data.name,
    webViewLink: response.data.webViewLink,
    webContentLink: response.data.webContentLink,
    previewUrl: `https://drive.google.com/file/d/${response.data.id}/preview`
  };
}
