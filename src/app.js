const state = {
  catalog: [],
  courseId: localStorage.getItem("selected-course-id"),
  lessonId: localStorage.getItem("selected-lesson-id"),
  query: "",
  filter: "all",
  importPanelOpen: localStorage.getItem("import-panel-open") === "true",
  theme: localStorage.getItem("theme") || "light",
  lastImportRunning: null,
  lastCatalogReloadAt: 0,
  playbackRate: Number(localStorage.getItem("playback-rate") || 1),
  volume: Number(localStorage.getItem("player-volume") || 1),
  watchPositions: JSON.parse(localStorage.getItem("watch-positions") || "{}"),
  videoDurations: JSON.parse(localStorage.getItem("video-durations") || "{}"),
  isSeeking: false,
  lastPositionSaveSecond: -1,
  controlsHideTimer: null,
  progress: JSON.parse(localStorage.getItem("course-progress") || "{}")
};

function deviceId() {
  const key = "course-device-id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(key, id);
  }
  return id;
}

function ownerId() {
  const key = "course-owner-id";
  const urlOwner = new URLSearchParams(window.location.search).get("owner");
  if (urlOwner) localStorage.setItem(key, urlOwner.trim());
  let id = localStorage.getItem(key);
  if (!id) {
    id = `owner-${deviceId()}`;
    localStorage.setItem(key, id);
  }
  return id;
}

function ownerHeaders(extra = {}) {
  return { "X-Owner-Id": ownerId(), ...extra };
}

const elements = {
  courseList: document.querySelector("#courseList"),
  toggleImportPanel: document.querySelector("#toggleImportPanel"),
  toggleTheme: document.querySelector("#toggleTheme"),
  importPanel: document.querySelector("#importPanel"),
  lessonList: document.querySelector("#lessonList"),
  searchInput: document.querySelector("#searchInput"),
  filterSelect: document.querySelector("#filterSelect"),
  courseTitle: document.querySelector("#courseTitle"),
  eyebrow: document.querySelector("#eyebrow"),
  lessonCount: document.querySelector("#lessonCount"),
  progressText: document.querySelector("#progressText"),
  progressTitle: document.querySelector("#progressTitle"),
  progressDetail: document.querySelector("#progressDetail"),
  courseProgressBar: document.querySelector("#courseProgressBar"),
  nextUpText: document.querySelector("#nextUpText"),
  videoPlayer: document.querySelector("#videoPlayer"),
  drivePlayer: document.querySelector("#drivePlayer"),
  customPlayer: document.querySelector("#customPlayer"),
  currentTime: document.querySelector("#currentTime"),
  durationTime: document.querySelector("#durationTime"),
  seekBar: document.querySelector("#seekBar"),
  playPause: document.querySelector("#playPause"),
  rewind10: document.querySelector("#rewind10"),
  forward10: document.querySelector("#forward10"),
  nextLesson: document.querySelector("#nextLesson"),
  fullscreenButton: document.querySelector("#fullscreenButton"),
  playbackRate: document.querySelector("#playbackRate"),
  lessonKicker: document.querySelector("#lessonKicker"),
  lessonTitle: document.querySelector("#lessonTitle"),
  lessonDescription: document.querySelector("#lessonDescription"),
  materialLinks: document.querySelector("#materialLinks"),
  toggleDone: document.querySelector("#toggleDone"),
  importForm: document.querySelector("#importForm"),
  importChannel: document.querySelector("#importChannel"),
  importCourseId: document.querySelector("#importCourseId"),
  importCourseTitle: document.querySelector("#importCourseTitle"),
  importOrder: document.querySelector("#importOrder"),
  storageMode: document.querySelector("#storageMode"),
  allowedExtensions: document.querySelector("#allowedExtensions"),
  maxMessages: document.querySelector("#maxMessages"),
  downloadConcurrency: document.querySelector("#downloadConcurrency"),
  includeVideos: document.querySelector("#includeVideos"),
  includeMaterials: document.querySelector("#includeMaterials"),
  driveMakePublic: document.querySelector("#driveMakePublic"),
  connectDrive: document.querySelector("#connectDrive"),
  driveStatus: document.querySelector("#driveStatus"),
  saveImportConfig: document.querySelector("#saveImportConfig"),
  startImport: document.querySelector("#startImport"),
  importStatus: document.querySelector("#importStatus")
};

async function loadCatalog({ preserveSelection = true } = {}) {
  const previousCourseId = preserveSelection ? state.courseId : localStorage.getItem("selected-course-id");
  const previousLessonId = preserveSelection ? state.lessonId : localStorage.getItem("selected-lesson-id");
  const response = await fetch("/api/catalog", { cache: "no-store", headers: ownerHeaders() });
  if (!response.ok) throw new Error("Catalogo nao encontrado");
  const catalog = await response.json();
  state.catalog = catalog.courses || [];
  const selectedCourse = state.catalog.find((course) => course.id === previousCourseId) || state.catalog[0];
  state.courseId = selectedCourse?.id || null;
  const selectedLesson = selectedCourse?.lessons?.find((lesson) => lesson.id === previousLessonId) || selectedCourse?.lessons?.[0];
  state.lessonId = selectedLesson?.id || null;
  persistSelection();
  render();
}

function applyChromeState() {
  document.documentElement.dataset.theme = state.theme;
  elements.toggleTheme.textContent = state.theme === "dark" ? "Modo claro" : "Modo escuro";
  elements.importPanel.hidden = !state.importPanelOpen;
  elements.toggleImportPanel.classList.toggle("active", state.importPanelOpen);
}

function persistSelection() {
  if (state.courseId) localStorage.setItem("selected-course-id", state.courseId);
  if (state.lessonId) localStorage.setItem("selected-lesson-id", state.lessonId);
}

async function loadImportConfig() {
  const response = await fetch("/api/import-config", { cache: "no-store" });
  if (!response.ok) return;
  const config = await response.json();
  elements.importChannel.value = config.channel || "";
  elements.importCourseId.value = config.courseId || "";
  elements.importCourseTitle.value = config.courseTitle || "";
  elements.importOrder.value = config.order || "tag";
  elements.storageMode.value = config.storageMode || "local";
  elements.allowedExtensions.value = config.allowedExtensions || "";
  elements.maxMessages.value = config.maxMessages || 500;
  elements.downloadConcurrency.value = config.downloadConcurrency || 3;
  elements.includeVideos.checked = config.includeVideos !== false;
  elements.includeMaterials.checked = config.includeMaterials !== false;
  elements.driveMakePublic.checked = Boolean(config.driveMakePublic);
}

function readImportForm() {
  return {
    channel: elements.importChannel.value.trim(),
    courseId: elements.importCourseId.value.trim(),
    courseTitle: elements.importCourseTitle.value.trim(),
    order: elements.importOrder.value,
    storageMode: elements.storageMode.value,
    allowedExtensions: elements.allowedExtensions.value.trim(),
    maxMessages: Number(elements.maxMessages.value || 500),
    downloadConcurrency: Number(elements.downloadConcurrency.value || 3),
    includeVideos: elements.includeVideos.checked,
    includeMaterials: elements.includeMaterials.checked,
    driveMakePublic: elements.driveMakePublic.checked
  };
}

async function loadDriveStatus() {
  const response = await fetch("/api/drive/status", { cache: "no-store", headers: ownerHeaders() });
  if (!response.ok) return;
  const status = await response.json();
  if (!status.configured) {
    elements.driveStatus.textContent = "Configure GOOGLE_DRIVE_CLIENT_ID e GOOGLE_DRIVE_CLIENT_SECRET no .env.";
    elements.connectDrive.disabled = true;
  } else if (status.connected) {
    elements.driveStatus.textContent = "Google Drive conectado.";
    elements.connectDrive.disabled = false;
  } else {
    elements.driveStatus.textContent = "Google Drive ainda não conectado.";
    elements.connectDrive.disabled = false;
  }
}

async function connectDrive() {
  const response = await fetch("/api/drive/auth-url", { cache: "no-store", headers: ownerHeaders() });
  const data = await response.json();
  if (!response.ok || !data.url) throw new Error(data.message || "Nao consegui gerar o link do Drive.");
  window.open(data.url, "_blank", "noopener,noreferrer");
}

async function saveImportConfig() {
  const response = await fetch("/api/import-config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(readImportForm())
  });
  if (!response.ok) throw new Error("Nao consegui salvar a configuracao.");
  elements.importStatus.textContent = "Configuração salva.";
}

async function startImport() {
  await saveImportConfig();
  const response = await fetch("/api/import/start", { method: "POST" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "Nao consegui iniciar a importacao.");
  elements.importStatus.textContent = "Importação iniciada.";
  pollImportStatus();
}

async function extractMaterial(file) {
  elements.importStatus.textContent = "Descompactando material...";
  const response = await fetch("/api/material/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file })
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.message || "Nao consegui descompactar.");
  }
  elements.importStatus.textContent = `Material descompactado em ${data.folder}`;
}

async function pollImportStatus() {
  const response = await fetch("/api/import/status", { cache: "no-store" });
  if (!response.ok) return;
  const status = await response.json();
  const progress = status.progress;

  if (progress) {
    const active = progress.active?.length
      ? `\nBaixando: ${progress.active.map((item) => `${item.index}/${progress.total} ${item.title}`).join(" | ")}`
      : "";
    const failures = progress.failedItems?.length
      ? `\nÚltima falha: ${progress.failedItems[progress.failedItems.length - 1].title} - ${progress.failedItems[progress.failedItems.length - 1].error}`
      : "";
    elements.importStatus.textContent = `${progress.courseTitle || "Importação"}: ${progress.completed}/${progress.total} baixados (${progress.percent}%). Processados: ${progress.processedPercent ?? progress.percent}%. Pendentes: ${progress.pending}. Falhas: ${progress.failed}.${active}${failures}`;
  } else {
    elements.importStatus.textContent = status.running ? "Importação rodando..." : "Nenhuma importação em andamento.";
  }

  const importJustFinished = state.lastImportRunning === true && status.running === false;
  const shouldRefreshWhileRunning = status.running && Date.now() - state.lastCatalogReloadAt > 15000;
  if (importJustFinished || shouldRefreshWhileRunning) {
    state.lastCatalogReloadAt = Date.now();
    loadCatalog({ preserveSelection: true }).catch(() => {});
  }
  state.lastImportRunning = status.running;
}

function saveProgress() {
  localStorage.setItem("course-progress", JSON.stringify(state.progress));
  fetch("/api/watch-progress", {
    method: "POST",
    headers: ownerHeaders({ "Content-Type": "application/json", "X-Device-Id": deviceId() }),
    body: JSON.stringify(state.progress)
  }).catch(() => {});
}

async function loadWatchProgress() {
  const response = await fetch("/api/watch-progress", {
    cache: "no-store",
    headers: ownerHeaders({ "X-Device-Id": deviceId() })
  });
  if (!response.ok) return;
  const progress = await response.json();
  if (progress && typeof progress === "object") {
    state.progress = { ...state.progress, ...progress };
    localStorage.setItem("course-progress", JSON.stringify(state.progress));
  }
}

function isDone(lessonId) {
  return Boolean(state.progress[lessonId]);
}

function lessonProgressRatio(lesson) {
  if (!lesson) return 0;
  if (isDone(lesson.id)) return 1;
  if (!lesson.video && !lesson.drivePreviewUrl) return 0;
  const watched = Number(state.watchPositions[lesson.id] || 0);
  const duration = Number(state.videoDurations[lesson.id] || lesson.durationSeconds || 0);
  if (!duration) return watched > 0 ? 0.08 : 0;
  return Math.max(0, Math.min(0.98, watched / duration));
}

function courseProgress(course) {
  const lessons = course?.lessons || [];
  const trackable = lessons.filter((lesson) => lesson.video || lesson.file || lesson.drivePreviewUrl || lesson.driveWebViewLink);
  if (!trackable.length) {
    return { total: 0, done: 0, percent: 0, partial: 0 };
  }
  const partial = trackable.reduce((sum, lesson) => sum + lessonProgressRatio(lesson), 0);
  const done = trackable.filter((lesson) => isDone(lesson.id)).length;
  return {
    total: trackable.length,
    done,
    partial,
    percent: Math.round((partial / trackable.length) * 100)
  };
}

function currentCourse() {
  return state.catalog.find((course) => course.id === state.courseId) || state.catalog[0];
}

function currentLesson() {
  const course = currentCourse();
  return course?.lessons?.find((lesson) => lesson.id === state.lessonId) || course?.lessons?.[0];
}

function currentLessonIndex() {
  const course = currentCourse();
  return course?.lessons?.findIndex((lesson) => lesson.id === state.lessonId) ?? -1;
}

function selectLessonByIndex(index, autoplay = false) {
  const course = currentCourse();
  const lesson = course?.lessons?.[index];
  if (!lesson) return false;
  saveWatchPosition();
  state.lessonId = lesson.id;
  persistSelection();
  renderPlayer();
  renderLessons();
  if (autoplay && lesson.video) {
    elements.videoPlayer.play().catch(() => {});
  }
  return true;
}

function selectNextLesson(autoplay = true) {
  const course = currentCourse();
  const index = currentLessonIndex();
  if (!course || index < 0) return;
  for (let nextIndex = index + 1; nextIndex < course.lessons.length; nextIndex += 1) {
    const lesson = course.lessons[nextIndex];
    if (lesson.video || lesson.file || lesson.drivePreviewUrl || lesson.driveWebViewLink) {
      selectLessonByIndex(nextIndex, autoplay);
      return;
    }
  }
}

function filteredCourses() {
  const query = state.query.trim().toLowerCase();
  if (!query) return state.catalog;
  return state.catalog.filter((course) => {
    const courseMatch = `${course.title} ${course.instructor || ""}`.toLowerCase().includes(query);
    const lessonMatch = course.lessons?.some((lesson) => `${lesson.title} ${lesson.description || ""} ${lesson.module || ""} ${lesson.tag || ""}`.toLowerCase().includes(query));
    return courseMatch || lessonMatch;
  });
}

function filteredLessons(course) {
  const query = state.query.trim().toLowerCase();
  return (course?.lessons || []).filter((lesson) => {
    const matchesQuery = !query || `${lesson.title} ${lesson.description || ""} ${lesson.module || ""} ${lesson.tag || ""}`.toLowerCase().includes(query) || course.title.toLowerCase().includes(query);
    const matchesFilter = state.filter === "all" || (state.filter === "done" ? isDone(lesson.id) : !isDone(lesson.id));
    return matchesQuery && matchesFilter;
  });
}

function renderCourses() {
  const courses = filteredCourses();
  elements.courseList.innerHTML = courses.map((course) => {
    const total = course.lessons?.length || 0;
    const done = course.lessons?.filter((lesson) => isDone(lesson.id)).length || 0;
    return `
      <button class="course-button ${course.id === state.courseId ? "active" : ""}" data-course-id="${course.id}" type="button">
        <strong>${escapeHtml(course.title)}</strong>
        <span>${done}/${total} aulas vistas</span>
      </button>
    `;
  }).join("") || `<p class="empty-state">Nada encontrado.</p>`;
}

function renderLessons() {
  const course = currentCourse();
  const lessons = filteredLessons(course);
  elements.lessonList.innerHTML = lessons.map((lesson, index) => `
    <button class="lesson-button ${lesson.id === state.lessonId ? "active" : ""} ${isDone(lesson.id) ? "done" : ""}" data-lesson-id="${lesson.id}" type="button">
      <span class="lesson-index">${lesson.type === "material" ? "PDF" : isDone(lesson.id) ? "OK" : index + 1}</span>
      <span class="lesson-main">
        <strong>${escapeHtml(lesson.title)}</strong>
        <span>${escapeHtml(lesson.module || lesson.source || course.title)}</span>
        <span class="mini-progress"><i style="width: ${Math.round(lessonProgressRatio(lesson) * 100)}%"></i></span>
      </span>
      <span class="duration">${escapeHtml(lesson.duration || "")}</span>
    </button>
  `).join("") || `<p class="empty-state">Nenhuma aula nesse filtro.</p>`;
}

function renderPlayer() {
  const course = currentCourse();
  const lesson = currentLesson();
  const lessons = course?.lessons || [];
  const progress = courseProgress(course);
  const nextPending = lessons.find((item) => (item.video || item.file || item.drivePreviewUrl || item.driveWebViewLink) && !isDone(item.id));

  elements.courseTitle.textContent = course?.title || "Sem cursos importados";
  elements.eyebrow.textContent = course?.instructor || "Curso";
  elements.lessonCount.textContent = `${progress.total || lessons.length} item${(progress.total || lessons.length) === 1 ? "" : "s"}`;
  elements.progressText.textContent = `${progress.percent}% visto`;
  elements.progressTitle.textContent = progress.percent >= 100 ? "Curso concluído" : `${progress.percent}% da trilha`;
  elements.progressDetail.textContent = `${progress.done}/${progress.total} itens concluídos`;
  elements.courseProgressBar.style.width = `${progress.percent}%`;
  elements.nextUpText.textContent = nextPending ? `Próximo passo: ${nextPending.title}` : "Tudo pronto por aqui.";
  elements.lessonKicker.textContent = lesson?.source || "Aula atual";
  elements.lessonTitle.textContent = lesson?.title || "Selecione uma aula";
  elements.lessonDescription.textContent = lesson?.description || "";
  elements.toggleDone.textContent = lesson && isDone(lesson.id) ? "Desmarcar" : "Marcar como vista";
  elements.toggleDone.classList.toggle("is-done", Boolean(lesson && isDone(lesson.id)));
  elements.toggleDone.disabled = !lesson;
  elements.nextLesson.disabled = !lesson || currentLessonIndex() >= lessons.length - 1;

  const previousSrc = elements.videoPlayer.getAttribute("src");
  if (lesson?.drivePreviewUrl) {
    elements.videoPlayer.pause();
    elements.videoPlayer.removeAttribute("src");
    elements.videoPlayer.load();
    elements.videoPlayer.hidden = true;
    elements.customPlayer.hidden = true;
    elements.drivePlayer.hidden = false;
    if (elements.drivePlayer.src !== lesson.drivePreviewUrl) {
      elements.drivePlayer.src = lesson.drivePreviewUrl;
    }
  } else if (lesson?.video && previousSrc !== lesson.video) {
    elements.drivePlayer.hidden = true;
    elements.drivePlayer.removeAttribute("src");
    elements.videoPlayer.src = lesson.video;
    elements.videoPlayer.load();
    elements.videoPlayer.playbackRate = state.playbackRate;
    elements.videoPlayer.volume = state.volume;
    elements.videoPlayer.hidden = false;
    elements.customPlayer.hidden = false;
  } else if (!lesson?.video) {
    elements.drivePlayer.hidden = true;
    elements.drivePlayer.removeAttribute("src");
    elements.videoPlayer.removeAttribute("src");
    elements.videoPlayer.load();
    elements.videoPlayer.hidden = true;
    elements.customPlayer.hidden = true;
  }
  elements.videoPlayer.playbackRate = state.playbackRate;
  elements.videoPlayer.volume = state.volume;
  elements.playbackRate.value = String(state.playbackRate);
  updatePlayerControls();
  renderAchievementPulse(progress.percent);

  const materials = lesson?.materials?.length
    ? lesson.materials
    : lesson?.file || lesson?.driveWebViewLink
      ? [{ title: lesson.title, file: lesson.file, driveWebViewLink: lesson.driveWebViewLink }]
      : [];
  elements.materialLinks.innerHTML = materials.map((material) => `
    <div class="material-item">
      <a href="${escapeHtml(material.file || material.driveWebViewLink)}" target="_blank" rel="noreferrer">
        ${escapeHtml(material.title || "Abrir material")}
      </a>
      ${String(material.file || "").toLowerCase().endsWith(".zip")
        ? `<button class="secondary-button extract-button" data-extract-file="${escapeHtml(material.file)}" type="button">Descompactar</button>`
        : ""}
    </div>
  `).join("");
}

function renderAchievementPulse(percent) {
  const rounded = Math.floor(percent / 10) * 10;
  const key = `course-milestone-${state.courseId}`;
  const last = Number(localStorage.getItem(key) || 0);
  if (rounded >= 10 && rounded > last) {
    localStorage.setItem(key, String(rounded));
    elements.progressTitle.classList.remove("pulse");
    requestAnimationFrame(() => elements.progressTitle.classList.add("pulse"));
  }
}

function formatTime(seconds = 0) {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;
  const two = (value) => String(value).padStart(2, "0");
  return hours ? `${hours}:${two(minutes)}:${two(secs)}` : `${two(minutes)}:${two(secs)}`;
}

function updatePlayerControls() {
  const video = elements.videoPlayer;
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const current = Number.isFinite(video.currentTime) ? video.currentTime : 0;
  elements.currentTime.textContent = formatTime(current);
  elements.durationTime.textContent = formatTime(duration);
  if (!state.isSeeking) {
    elements.seekBar.value = duration ? String(Math.min(1000, Math.round((current / duration) * 1000))) : "0";
  }
  elements.playPause.textContent = video.paused ? "Play" : "Pause";
}

function saveWatchPosition() {
  const lesson = currentLesson();
  const video = elements.videoPlayer;
  if (!lesson?.id || !lesson.video || !Number.isFinite(video.currentTime)) return;
  state.watchPositions[lesson.id] = Math.floor(video.currentTime);
  localStorage.setItem("watch-positions", JSON.stringify(state.watchPositions));
}

function saveVideoMetadata() {
  const lesson = currentLesson();
  const video = elements.videoPlayer;
  if (!lesson?.id || !lesson.video) return;
  if (Number.isFinite(video.duration) && video.duration > 0) {
    state.videoDurations[lesson.id] = Math.floor(video.duration);
    localStorage.setItem("video-durations", JSON.stringify(state.videoDurations));
  }
}

function autoCompleteCurrentLesson() {
  const lesson = currentLesson();
  const video = elements.videoPlayer;
  if (!lesson?.id || isDone(lesson.id) || !Number.isFinite(video.duration) || video.duration <= 0) return false;
  if (video.currentTime / video.duration >= 0.9) {
    state.progress[lesson.id] = new Date().toISOString();
    saveProgress();
    return true;
  }
  return false;
}

function restoreWatchPosition() {
  const lesson = currentLesson();
  const video = elements.videoPlayer;
  const saved = lesson?.id ? Number(state.watchPositions[lesson.id] || 0) : 0;
  if (saved > 5 && Number.isFinite(video.duration) && saved < video.duration - 5) {
    video.currentTime = saved;
  }
  updatePlayerControls();
}

function seekBy(seconds) {
  const video = elements.videoPlayer;
  seekTo((Number(video.currentTime) || 0) + seconds);
}

function safeSeekTarget(target) {
  const video = elements.videoPlayer;
  const duration = Number(video.duration);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const upperLimit = Math.max(0, duration - 0.35);
  return Math.max(0, Math.min(Number(target) || 0, upperLimit));
}

function seekTo(target) {
  const video = elements.videoPlayer;
  const safeTarget = safeSeekTarget(target);
  if (safeTarget === null) return;
  video.currentTime = safeTarget;
  saveWatchPosition();
  updatePlayerControls();
}

function seekToRatio(value) {
  const duration = Number(elements.videoPlayer.duration);
  if (!Number.isFinite(duration) || duration <= 0) return;
  const ratio = Math.max(0, Math.min(Number(value) || 0, 1000)) / 1000;
  seekTo(ratio * duration);
}

function changeVolume(delta) {
  const video = elements.videoPlayer;
  state.volume = Math.max(0, Math.min(1, (Number(video.volume) || 0) + delta));
  video.volume = state.volume;
  video.muted = state.volume === 0;
  localStorage.setItem("player-volume", String(state.volume));
}

function toggleFullscreen() {
  const target = document.querySelector(".player-panel");
  if (!document.fullscreenElement) {
    target?.requestFullscreen?.();
  } else {
    document.exitFullscreen?.();
  }
}

function showFullscreenControls() {
  const panel = document.querySelector(".player-panel");
  if (!document.fullscreenElement || document.fullscreenElement !== panel) return;
  panel.classList.remove("controls-hidden");
  window.clearTimeout(state.controlsHideTimer);
  state.controlsHideTimer = window.setTimeout(() => {
    if (!state.isSeeking) {
      panel.classList.add("controls-hidden");
    }
  }, 2200);
}

function resetFullscreenControls() {
  const panel = document.querySelector(".player-panel");
  window.clearTimeout(state.controlsHideTimer);
  panel?.classList.remove("controls-hidden");
}

function isTypingTarget(target) {
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName) || target?.isContentEditable;
}

function render() {
  renderCourses();
  renderLessons();
  renderPlayer();
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

elements.courseList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-course-id]");
  if (!button) return;
  saveWatchPosition();
  const course = state.catalog.find((item) => item.id === button.dataset.courseId);
  state.courseId = course.id;
  state.lessonId = course.lessons?.[0]?.id || null;
  persistSelection();
  render();
});

elements.lessonList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-lesson-id]");
  if (!button) return;
  saveWatchPosition();
  state.lessonId = button.dataset.lessonId;
  persistSelection();
  renderPlayer();
  renderLessons();
});

elements.searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  render();
});

elements.filterSelect.addEventListener("change", (event) => {
  state.filter = event.target.value;
  renderLessons();
});

elements.toggleDone.addEventListener("click", () => {
  const lesson = currentLesson();
  if (!lesson) return;
  if (isDone(lesson.id)) {
    delete state.progress[lesson.id];
  } else {
    state.progress[lesson.id] = new Date().toISOString();
  }
  saveProgress();
  render();
});

elements.toggleImportPanel.addEventListener("click", () => {
  state.importPanelOpen = !state.importPanelOpen;
  localStorage.setItem("import-panel-open", String(state.importPanelOpen));
  applyChromeState();
});

elements.toggleTheme.addEventListener("click", () => {
  state.theme = state.theme === "dark" ? "light" : "dark";
  localStorage.setItem("theme", state.theme);
  applyChromeState();
});

elements.connectDrive.addEventListener("click", () => {
  connectDrive().catch((err) => {
    elements.driveStatus.textContent = err.message;
  });
});

elements.materialLinks.addEventListener("click", (event) => {
  const button = event.target.closest("[data-extract-file]");
  if (!button) return;
  extractMaterial(button.dataset.extractFile).catch((err) => {
    elements.importStatus.textContent = err.message;
  });
});

elements.videoPlayer.addEventListener("loadedmetadata", () => {
  elements.videoPlayer.playbackRate = state.playbackRate;
  elements.videoPlayer.volume = state.volume;
  saveVideoMetadata();
  restoreWatchPosition();
  renderLessons();
  renderPlayer();
});

elements.videoPlayer.addEventListener("timeupdate", () => {
  updatePlayerControls();
  const currentSecond = Math.floor(elements.videoPlayer.currentTime);
  if (currentSecond !== state.lastPositionSaveSecond && currentSecond % 5 === 0) {
    state.lastPositionSaveSecond = currentSecond;
    saveWatchPosition();
    autoCompleteCurrentLesson();
    renderPlayer();
  }
});

elements.videoPlayer.addEventListener("click", () => {
  if (elements.videoPlayer.paused) {
    elements.videoPlayer.play().catch(() => {});
  } else {
    elements.videoPlayer.pause();
  }
});

elements.videoPlayer.addEventListener("play", updatePlayerControls);
elements.videoPlayer.addEventListener("pause", () => {
  saveWatchPosition();
  updatePlayerControls();
});

elements.videoPlayer.addEventListener("ended", () => {
  saveWatchPosition();
  autoCompleteCurrentLesson();
  updatePlayerControls();
});

elements.playPause.addEventListener("click", () => {
  const video = elements.videoPlayer;
  if (!video.src) return;
  if (video.paused) {
    if (video.ended) {
      seekTo(Math.max(0, video.duration - 1));
    }
    video.play().catch(() => {});
  } else {
    video.pause();
  }
});

elements.rewind10.addEventListener("click", () => seekBy(-10));
elements.forward10.addEventListener("click", () => seekBy(10));
elements.nextLesson.addEventListener("click", () => selectNextLesson(true));
elements.fullscreenButton.addEventListener("click", toggleFullscreen);

elements.seekBar.addEventListener("pointerdown", () => {
  state.isSeeking = true;
  showFullscreenControls();
});

elements.seekBar.addEventListener("input", () => {
  state.isSeeking = true;
  const duration = elements.videoPlayer.duration;
  if (Number.isFinite(duration)) {
    const target = safeSeekTarget((Number(elements.seekBar.value) / 1000) * duration);
    elements.currentTime.textContent = formatTime(target ?? elements.videoPlayer.currentTime);
  }
});

elements.seekBar.addEventListener("pointerup", () => {
  seekToRatio(elements.seekBar.value);
  state.isSeeking = false;
  updatePlayerControls();
  showFullscreenControls();
});

elements.seekBar.addEventListener("change", () => {
  seekToRatio(elements.seekBar.value);
  state.isSeeking = false;
  updatePlayerControls();
});

elements.playbackRate.addEventListener("change", () => {
  state.playbackRate = Number(elements.playbackRate.value);
  localStorage.setItem("playback-rate", String(state.playbackRate));
  elements.videoPlayer.playbackRate = state.playbackRate;
});

document.addEventListener("keydown", (event) => {
  if (isTypingTarget(event.target)) return;
  if (!elements.drivePlayer.hidden) return;
  if (!elements.videoPlayer.src) return;
  showFullscreenControls();

  if (event.key === "ArrowLeft") {
    event.preventDefault();
    seekBy(-10);
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    seekBy(10);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    changeVolume(0.05);
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    changeVolume(-0.05);
  } else if (event.key.toLowerCase() === "n") {
    event.preventDefault();
    selectNextLesson(true);
  } else if (event.key.toLowerCase() === "f") {
    event.preventDefault();
    toggleFullscreen();
  } else if (event.key === " ") {
    event.preventDefault();
    elements.playPause.click();
  }
});

document.querySelector(".player-panel").addEventListener("mousemove", showFullscreenControls);
document.querySelector(".player-panel").addEventListener("click", showFullscreenControls);
document.querySelector(".player-panel").addEventListener("touchstart", showFullscreenControls, { passive: true });

document.addEventListener("fullscreenchange", () => {
  if (document.fullscreenElement) {
    showFullscreenControls();
  } else {
    resetFullscreenControls();
  }
});

elements.saveImportConfig.addEventListener("click", () => {
  saveImportConfig().catch((err) => {
    elements.importStatus.textContent = err.message;
  });
});

elements.importForm.addEventListener("submit", (event) => {
  event.preventDefault();
  saveImportConfig().catch((err) => {
    elements.importStatus.textContent = err.message;
  });
});

elements.startImport.addEventListener("click", () => {
  startImport().catch((err) => {
    elements.importStatus.textContent = err.message;
  });
});

setInterval(() => {
  pollImportStatus().catch(() => {});
}, 5000);

applyChromeState();

loadWatchProgress().then(() => render()).catch(() => {});

loadImportConfig().catch(() => {
  elements.importStatus.textContent = "Servidor precisa ser reiniciado para habilitar o painel de importação.";
});

loadDriveStatus().catch(() => {});

pollImportStatus().catch(() => {});

loadCatalog().catch(() => {
  elements.courseTitle.textContent = "Nao consegui carregar o catalogo";
  elements.lessonTitle.textContent = "Verifique data/catalog.json";
});
