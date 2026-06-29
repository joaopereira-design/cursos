import "dotenv/config";

const projectId = process.env.SUPABASE_PROJECT_ID || "";
const supabaseUrl = (process.env.SUPABASE_URL || (projectId ? `https://${projectId}.supabase.co` : "")).replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_API_KEY || "";
const anonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "";

export function supabaseConfigured({ service = true } = {}) {
  return Boolean(supabaseUrl && (service ? serviceKey : (serviceKey || anonKey)));
}

function authKey({ service = true } = {}) {
  const key = service ? serviceKey : (anonKey || serviceKey);
  if (!supabaseUrl || !key) {
    throw new Error("Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.");
  }
  return key;
}

async function request(path, { method = "GET", body, query, prefer, service = true, headers = {} } = {}) {
  const key = authKey({ service });
  const url = new URL(`${supabaseUrl}/rest/v1/${path}`);
  if (query) {
    for (const [name, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(name, value);
    }
  }

  const response = await fetch(url, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
      ...headers
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase ${method} ${path} falhou (${response.status}): ${text}`);
  }

  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function courseRow(course, position = 0) {
  const { lessons, importedAt, imported_at, ...metadata } = course;
  return {
    id: String(course.id),
    title: String(course.title || course.id),
    instructor: course.instructor || "",
    description: course.description || "",
    imported_at: importedAt || imported_at || null,
    position,
    metadata,
    updated_at: new Date().toISOString()
  };
}

function lessonRow(courseId, lesson, position = 0) {
  const {
    id,
    type,
    tag,
    title,
    module,
    description,
    duration,
    durationSeconds,
    duration_seconds,
    source,
    video,
    file,
    driveFileId,
    drive_file_id,
    driveWebViewLink,
    drive_web_view_link,
    driveWebContentLink,
    drive_web_content_link,
    drivePreviewUrl,
    drive_preview_url,
    ...metadata
  } = lesson;

  return {
    id: String(id),
    course_id: String(courseId),
    type: type || "video",
    tag: tag || "",
    title: title || id,
    module: module || "",
    description: description || "",
    duration: duration || "",
    duration_seconds: durationSeconds ?? duration_seconds ?? null,
    source: source || "",
    video: video || "",
    file: file || "",
    drive_file_id: driveFileId || drive_file_id || "",
    drive_web_view_link: driveWebViewLink || drive_web_view_link || "",
    drive_web_content_link: driveWebContentLink || drive_web_content_link || "",
    drive_preview_url: drivePreviewUrl || drive_preview_url || "",
    position,
    metadata,
    updated_at: new Date().toISOString()
  };
}

function rowToLesson(row) {
  return {
    ...row.metadata,
    id: row.id,
    type: row.type,
    tag: row.tag || "",
    title: row.title,
    module: row.module || "",
    description: row.description || "",
    duration: row.duration || "",
    durationSeconds: row.duration_seconds === null ? undefined : Number(row.duration_seconds),
    source: row.source || "",
    video: row.video || "",
    file: row.file || "",
    driveFileId: row.drive_file_id || "",
    driveWebViewLink: row.drive_web_view_link || "",
    driveWebContentLink: row.drive_web_content_link || "",
    drivePreviewUrl: row.drive_preview_url || ""
  };
}

function rowToCourse(row, lessons) {
  return {
    ...row.metadata,
    id: row.id,
    title: row.title,
    instructor: row.instructor || "",
    description: row.description || "",
    importedAt: row.imported_at || row.metadata?.importedAt || "",
    lessons
  };
}

export async function readCatalogFromSupabase() {
  const [courseRows, lessonRows] = await Promise.all([
    request("courses", { query: { select: "*", order: "position.asc,title.asc" } }),
    request("lessons", { query: { select: "*", order: "position.asc" } })
  ]);

  const lessonsByCourse = new Map();
  for (const row of lessonRows || []) {
    const list = lessonsByCourse.get(row.course_id) || [];
    list.push(rowToLesson(row));
    lessonsByCourse.set(row.course_id, list);
  }

  return {
    courses: (courseRows || []).map((row) => rowToCourse(row, lessonsByCourse.get(row.id) || []))
  };
}

export async function writeCatalogToSupabase(catalog) {
  const courses = Array.isArray(catalog?.courses) ? catalog.courses : [];
  const courseRows = courses.map(courseRow);
  const lessonRows = courses.flatMap((course) => {
    const lessons = Array.isArray(course.lessons) ? course.lessons : [];
    return lessons.map((lesson, index) => lessonRow(course.id, lesson, index));
  });

  if (courseRows.length) {
    await request("courses", {
      method: "POST",
      body: courseRows,
      query: { on_conflict: "id" },
      prefer: "resolution=merge-duplicates"
    });
  }

  if (lessonRows.length) {
    await request("lessons", {
      method: "POST",
      body: lessonRows,
      query: { on_conflict: "id" },
      prefer: "resolution=merge-duplicates"
    });
  }

  return { courses: courseRows.length, lessons: lessonRows.length };
}

export async function readWatchProgressFromSupabase(deviceId) {
  if (!deviceId) return {};
  const rows = await request("watch_progress", {
    query: { select: "*", device_id: `eq.${deviceId}` }
  });

  return Object.fromEntries((rows || []).filter((row) => row.done).map((row) => [row.lesson_id, row.completed_at || row.updated_at]));
}

export async function writeWatchProgressToSupabase(deviceId, progress) {
  if (!deviceId || !progress || typeof progress !== "object") return { progress: 0 };
  const rows = Object.entries(progress).map(([lessonId, completedAt]) => ({
    device_id: deviceId,
    lesson_id: lessonId,
    done: Boolean(completedAt),
    completed_at: completedAt || null,
    updated_at: new Date().toISOString()
  }));

  if (!rows.length) return { progress: 0 };
  await request("watch_progress", {
    method: "POST",
    body: rows,
    query: { on_conflict: "device_id,lesson_id" },
    prefer: "resolution=merge-duplicates"
  });
  return { progress: rows.length };
}

export async function saveSecretToSupabase(name, value) {
  await request("app_secrets", {
    method: "POST",
    body: [{ name, value, updated_at: new Date().toISOString() }],
    query: { on_conflict: "name" },
    prefer: "resolution=merge-duplicates"
  });
}

export async function readSecretFromSupabase(name) {
  const rows = await request("app_secrets", {
    query: { select: "value", name: `eq.${name}`, limit: "1" }
  });
  return rows?.[0]?.value || null;
}
