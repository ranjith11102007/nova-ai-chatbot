// ---- Element references ----
const chat = document.getElementById("chat");
const hero = document.getElementById("hero");
const formInput = document.getElementById("user-input");
const sendBtn = document.getElementById("send-btn");
const plusBtn = document.getElementById("plus-btn");
const newChatBtn = document.getElementById("new-chat-btn");
const logoBtn = document.getElementById("logo-btn");
const errorBar = document.getElementById("error-bar");
const micBtn = document.getElementById("mic-btn");
const attachmentsBar = document.getElementById("attachments-bar");
const attachMenu = document.getElementById("attach-menu");
const dropZone = document.getElementById("drop-zone");
const historySearch = document.getElementById("history-search");

// Voice chat screen
const voiceScreen = document.getElementById("voice-screen");
const voiceTopbar = voiceScreen.querySelector(".voice-topbar");
const voiceOrb = document.getElementById("voice-orb");
const voiceStateTitle = document.getElementById("voice-state-title");
const voiceStateSub = document.getElementById("voice-state-sub");
const voiceCaptions = document.getElementById("voice-captions");
const voicePill = document.getElementById("voice-status-pill");
const voiceMuteBtn = document.getElementById("voice-mute-btn");
const voiceTalkBtn = document.getElementById("voice-talk-btn");
const voiceEndBtn = document.getElementById("voice-end-btn");
const voiceBackBtn = document.getElementById("voice-back-btn");

// Settings modal
const settingsModal = document.getElementById("settings-modal");
const setVoice = document.getElementById("set-voice");
const setAutoSpeak = document.getElementById("set-autospeak");
const setSpeed = document.getElementById("set-speed");
const setSpeedOut = document.getElementById("set-speed-out");
const setEnter = document.getElementById("set-enter");
const setTime = document.getElementById("set-time");
const setClear = document.getElementById("set-clear");

const MAX_MESSAGE_LENGTH = 4000;
const MAX_IMAGES = 4;
const MAX_UPLOAD_MB = 10;

// Conversation history for the current session.
let messages = [];
let busy = false;

// ---- Settings (persisted per browser) ----
const SETTINGS_KEY = "nova_settings_v1";
const DEFAULT_SETTINGS = {
  theme: "system",
  voice: "tara",
  autoSpeak: false,
  speed: 1.0,
  enterToSend: true,
  timestamps: false,
};
let settings = loadSettings();

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const data = raw ? JSON.parse(raw) : {};
    return { ...DEFAULT_SETTINGS, ...(data || {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
  applyTheme();
  updateSettingsUI();
}

function applyTheme() {
  const media = window.matchMedia("(prefers-color-scheme: light)");
  const resolved =
    settings.theme === "system"
      ? media.matches
        ? "light"
        : "dark"
      : settings.theme;
  document.documentElement.dataset.theme = resolved;
}

function updateSettingsUI() {
  document.querySelectorAll('input[name="theme"]').forEach((el) => {
    el.checked = el.value === settings.theme;
  });
  setAutoSpeak.checked = settings.autoSpeak;
  setEnter.checked = settings.enterToSend;
  setTime.checked = settings.timestamps;
  setSpeed.value = settings.speed;
  setSpeedOut.textContent = settings.speed.toFixed(1) + "\u00d7";
  if (setVoice.options && ![...setVoice.options].some((o) => o.value === settings.voice)) {
    settings.voice = DEFAULT_SETTINGS.voice;
  }
  setVoice.value = settings.voice;
}

["theme-dark", "theme-light", "theme-system"].forEach((id) => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener("change", () => {
      settings.theme = el.value;
      saveSettings();
    });
  }
});

setAutoSpeak.addEventListener("change", () => {
  settings.autoSpeak = setAutoSpeak.checked;
  saveSettings();
});

setEnter.addEventListener("change", () => {
  settings.enterToSend = setEnter.checked;
  saveSettings();
});

setTime.addEventListener("change", () => {
  settings.timestamps = setTime.checked;
  saveSettings();
  rerenderVisibleMessages();
});

setSpeed.addEventListener("input", () => {
  settings.speed = parseFloat(setSpeed.value);
  setSpeedOut.textContent = settings.speed.toFixed(1) + "\u00d7";
  saveSettings();
});

setVoice.addEventListener("change", () => {
  settings.voice = setVoice.value;
  saveSettings();
});

setClear.addEventListener("click", () => {
  startNewConversation();
  closeSettings();
});

document.getElementById("settings-btn").addEventListener("click", openSettings);
document.getElementById("settings-close-btn").addEventListener("click", closeSettings);
settingsModal.addEventListener("click", (e) => {
  if (e.target === settingsModal) closeSettings();
});

// Re-render bubbles in place (timestamps toggle only).
function rerenderVisibleMessages() {
  if (!document.body.classList.contains("chatting")) return;
  document.querySelectorAll(".bubble-time").forEach((el) => el.remove());
  chat.querySelectorAll(".bubble").forEach((bubble, i) => {
    const role = bubble.classList.contains("user") ? "user" : "ai";
    if (settings.timestamps && role === "user") {
      const t = document.createElement("div");
      t.className = "bubble-time";
      t.textContent = new Date().toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      });
      bubble.appendChild(t);
    }
  });
}

function openSettings() {
  updateSettingsUI();
  settingsModal.classList.remove("hidden");
}

function closeSettings() {
  settingsModal.classList.add("hidden");
}

// ---- Chat history (persisted in localStorage) ----
const HISTORY_KEY = "nova_history_v1";
const ACTIVE_KEY = "nova_active_id";
const MAX_HISTORY = 50;
const TITLE_MAX = 48;

let historyList = readHistory();
let currentId = readActiveId();
let historyFilter = "";

function readHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(historyList));
  } catch {
    // storage full or unavailable — history just will not persist
  }
}

function readActiveId() {
  return localStorage.getItem(ACTIVE_KEY) || null;
}

function setActiveId(id) {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    // ignore
  }
}

// Clear chat bubbles and listener rows, keeping the "New chat" pill.
function clearTranscript() {
  chat.querySelectorAll(".bubble, .bubble-actions").forEach((el) => el.remove());
}

function conversationTitle() {
  const first = messages.find((m) => m.role === "user");
  const text = (first && first.content) || "New chat";
  const clean = text.replace(/\s+/g, " ").trim();
  return (clean || "New chat").length > TITLE_MAX
    ? clean.slice(0, TITLE_MAX - 1) + "\u2026"
    : clean || "New chat";
}

function saveConversation() {
  if (!currentId) return;
  historyList = historyList.filter((c) => c.id !== currentId);
  historyList.unshift({
    id: currentId,
    title: conversationTitle(),
    updated: Date.now(),
    // Images/document payloads are ephemeral: never persist their base64 data.
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });
  historyList.sort((a, b) => b.updated - a.updated);
  if (historyList.length > MAX_HISTORY) historyList.length = MAX_HISTORY;
  writeHistory();
  setActiveId(currentId);
  renderHistoryList();
}

function renameConversation(id, newTitle) {
  const conv = historyList.find((c) => c.id === id);
  if (!conv) return;
  const clean = newTitle.replace(/\s+/g, " ").trim();
  conv.title = (clean || conv.title).slice(0, 80);
  conv.updated = Date.now();
  writeHistory();
  renderHistoryList();
}

function deleteConversation(id) {
  historyList = historyList.filter((c) => c.id !== id);
  if (id === currentId) {
    currentId = null;
    messages = [];
    clearTranscript();
    document.body.classList.remove("chatting");
    hideError();
    setActiveId(null);
  }
  writeHistory();
  renderHistoryList();
  formInput.focus();
}

function openConversation(id) {
  const conv = historyList.find((c) => c.id === id);
  if (!conv) return;
  currentId = conv.id;
  messages = conv.messages.map((m) => ({ role: m.role, content: m.content }));
  clearTranscript();
  messages.forEach((m) => showMessage(m.content, m.role === "assistant" ? "ai" : "user"));
  enterChatMode();
  hideError();
  setActiveId(id);
  renderHistoryList();
  closeHistory();
}

function formatTime(ts) {
  const d = new Date(ts);
  const today = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return "Today " + time;
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday " + time;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function renderHistoryList() {
  const listEl = document.getElementById("history-list");
  listEl.innerHTML = "";

  const query = historyFilter;
  const filtered = query
    ? historyList.filter((c) => c.title.toLowerCase().includes(query))
    : historyList;

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = query ? "No matching chats." : "No past chats yet.";
    listEl.appendChild(empty);
    return;
  }

  filtered.forEach((conv) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "history-item" + (conv.id === currentId ? " active" : "");

    const main = document.createElement("div");
    main.className = "history-item-main";

    const title = document.createElement("div");
    title.className = "history-item-title";
    title.textContent = conv.title;

    const time = document.createElement("div");
    time.className = "history-item-time";
    time.textContent = formatTime(conv.updated);

    main.appendChild(title);
    main.appendChild(time);

    const actions = document.createElement("div");
    actions.className = "history-item-actions";
    actions.style.display = "flex";
    actions.style.alignItems = "center";
    actions.style.gap = "2px";

    const rename = document.createElement("button");
    rename.type = "button";
    rename.className = "history-rename";
    rename.title = "Rename chat";
    rename.setAttribute("aria-label", "Rename chat");
    rename.innerHTML =
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg>';
    rename.addEventListener("click", (e) => {
      e.stopPropagation();
      startRename(conv.id, title, item);
    });

    const del = document.createElement("button");
    del.type = "button";
    del.className = "history-delete";
    del.title = "Delete this chat";
    del.setAttribute("aria-label", "Delete this chat");
    del.innerHTML =
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>';
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteConversation(conv.id);
    });

    actions.appendChild(rename);
    actions.appendChild(del);

    main.appendChild(actions === main ? actions : actions);
    main.appendChild(actions);

    item.appendChild(main);
    item.addEventListener("click", () => openConversation(conv.id));
    listEl.appendChild(item);
  });
}

function startRename(id, titleEl, item) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "history-item-title";
  input.value = titleEl.textContent;
  input.setAttribute("aria-label", "Rename chat");
  titleEl.replaceWith(input);
  input.focus();
  input.select();
  const finish = (commit) => {
    const text = input.value.trim();
    input.removeEventListener("keydown", onKey);
    if (commit && text) renameConversation(id, text);
    renderHistoryList();
  };
  const onKey = (e) => {
    e.stopPropagation();
    if (e.key === "Enter") finish(true);
    else if (e.key === "Escape") finish(false);
  };
  input.addEventListener("keydown", onKey);
  input.addEventListener("blur", () => finish(true));
}

historySearch.addEventListener("input", () => {
  historyFilter = historySearch.value.trim().toLowerCase();
  renderHistoryList();
});

function openHistory() {
  historySearch.value = "";
  historyFilter = "";
  renderHistoryList();
  document.body.classList.add("history-open");
  document.getElementById("history-backdrop").classList.remove("hidden");
}

function closeHistory() {
  document.body.classList.remove("history-open");
  document.getElementById("history-backdrop").classList.add("hidden");
}

document.getElementById("history-btn").addEventListener("click", openHistory);
document.getElementById("history-close-btn").addEventListener("click", closeHistory);
document.getElementById("history-backdrop").addEventListener("click", closeHistory);
document.getElementById("history-new-btn").addEventListener("click", () => {
  closeHistory();
  startNewConversation();
});

// ---- Landing helpers ----
function enterChatMode() {
  if (document.body.classList.contains("chatting")) return;
  document.body.classList.add("chatting");
  setTimeout(() => {
    chat.scrollTop = chat.scrollHeight;
  }, 60);
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeHistory();
    closeSettings();
    closeAttachMenu();
    if (!voiceScreen.classList.contains("hidden")) {
      hideVoiceScreen();
    }
  }
});

// ---- Helper: create and append a chat bubble ----
function showMessage(content, role) {
  const div = document.createElement("div");
  div.className = `bubble ${role}`;
  div.textContent = content;
  chat.appendChild(div);

  if (settings.timestamps && role === "user") {
    const t = document.createElement("div");
    t.className = "bubble-time";
    t.textContent = new Date().toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
    div.appendChild(t);
  }

  if (role === "ai" && content) {
    attachListenButton(div, content);
  }

  chat.scrollTop = chat.scrollHeight;
  return div;
}

function createEmptyAiBubble() {
  const div = document.createElement("div");
  div.className = "bubble ai";
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  return div;
}

// ---- Helper: show / hide the error bar ----
function showError(message) {
  errorBar.textContent = message;
  errorBar.classList.remove("hidden");
}

function hideError() {
  errorBar.classList.add("hidden");
}

// ---- Helper: show / hide the three-dot loading indicator ----
function showLoading() {
  const loader = document.createElement("div");
  loader.className = "loading";
  loader.innerHTML = "<span></span><span></span><span></span>";
  loader.id = "loader";
  chat.appendChild(loader);
  chat.scrollTop = chat.scrollHeight;
}

function hideLoading() {
  const loader = document.getElementById("loader");
  if (loader) loader.remove();
}

function setComposerDisabled(disabled) {
  sendBtn.disabled = disabled;
  formInput.disabled = disabled;
}

// =====================================================================
//  Attachments (images + documents)
// =====================================================================
let attachments = []; // {id, kind, name, size, status, dataUrl?, text?, error?}

let attachSeq = 0;

function classifyFile(file) {
  const name = (file.name || "").toLowerCase();
  const ext = name.includes(".") ? name.split(".").pop() : "";
  const type = (file.type || "").toLowerCase();
  if (["png", "jpg", "jpeg", "webp"].includes(ext) || type.startsWith("image/")) {
    return { kind: "image" };
  }
  if (["txt", "pdf", "docx"].includes(ext)) {
    return { kind: "document" };
  }
  return { kind: "other" };
}

function addAttachment(file) {
  if (!file) return;
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    showError(`This file is too large. Please choose a file under ${MAX_UPLOAD_MB} MB.`);
    return;
  }
  const { kind } = classifyFile(file);
  if (kind === "other") {
    showError("This file type isn't supported.");
    return;
  }
  if (kind === "image") {
    const images = attachments.filter((a) => a.kind === "image");
    if (images.length >= MAX_IMAGES) {
      showError(`You can attach up to ${MAX_IMAGES} images at once.`);
      return;
    }
    const id = "att_" + Date.now().toString(36) + (attachSeq++);
    attachments.push({ id, kind: "image", name: file.name, size: file.size, status: "processing" });
    renderAttachments();
    compressImage(file)
      .then((dataUrl) => {
        const att = attachments.find((a) => a.id === id);
        if (!att) return;
        att.dataUrl = dataUrl;
        att.status = "ready";
        renderAttachments();
      })
      .catch(() => {
        const att = attachments.find((a) => a.id === id);
        if (!att) return;
        att.status = "error";
        att.error = "Sorry, I couldn't process this image.";
        renderAttachments();
      });
    return;
  }
  // Document
  attachments = attachments.filter((a) => a.kind !== "document");
  const id = "att_" + Date.now().toString(36) + (attachSeq++);
  attachments.push({
    id,
    kind: "document",
    name: file.name,
    size: file.size,
    status: "processing",
  });
  renderAttachments();
  uploadDocument(file)
    .then((res) => {
      const att = attachments.find((a) => a.id === id);
      if (!att) return;
      if (!res.ok) {
        att.status = "error";
        att.error = res.detail;
      } else {
        att.text = res.text;
        att.status = "ready";
      }
      renderAttachments();
    })
    .catch(() => {
      const att = attachments.find((a) => a.id === id);
      if (!att) return;
      att.status = "error";
      att.error = "Sorry, I couldn't process this file.";
      renderAttachments();
    });
}

function removeAttachment(id) {
  const i = attachments.findIndex((a) => a.id === id);
  if (i !== -1) attachments.splice(i, 1);
  renderAttachments();
}

function renderAttachments() {
  attachmentsBar.innerHTML = "";
  if (attachments.length === 0) {
    attachmentsBar.classList.add("hidden");
    return;
  }
  attachmentsBar.classList.remove("hidden");
  attachments.forEach((att) => {
    const chip = document.createElement("div");
    chip.className = "attach-chip";
    chip.setAttribute("role", "group");

    if (att.kind === "image") {
      const img = document.createElement("img");
      img.className = "thumb";
      img.alt = "Image preview";
      img.src =
        att.status === "ready" ? att.dataUrl : "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
      chip.appendChild(img);
    } else {
      const icon = document.createElement("div");
      icon.className = "chip-icon";
      icon.textContent = "\ud83d\udcc4";
      chip.appendChild(icon);
    }

    const meta = document.createElement("div");
    meta.className = "chip-meta";

    const nameEl = document.createElement("div");
    nameEl.className = "chip-name";
    nameEl.textContent = att.name;

    const statusEl = document.createElement("div");
    statusEl.className = "chip-status" + (att.status === "error" ? " error" : "");
    statusEl.textContent =
      att.status === "processing"
        ? att.kind === "image"
          ? "Preparing..."
          : "Uploading…"
        : att.status === "error"
        ? att.error
        : `${formatBytes(att.size)} \u00b7 Ready`;

    meta.appendChild(nameEl);
    meta.appendChild(statusEl);
    chip.appendChild(meta);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "attach-remove";
    remove.setAttribute("aria-label", "Remove attachment");
    remove.textContent = "\u00d7";
    remove.addEventListener("click", () => removeAttachment(att.id));
    chip.appendChild(remove);

    attachmentsBar.appendChild(chip);
  });
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  if (bytes >= 1024) return Math.round(bytes / 1024) + " KB";
  return bytes + " B";
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const MAX = 1024;
        const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        ctx.fillStyle = "#ffffff";
        ctx.globalCompositeOperation = "destination-over";
        ctx.fillRect(0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/webp", 0.85).startsWith("data:image/webp")
          ? canvas.toDataURL("image/webp", 0.85)
          : canvas.toDataURL("image/jpeg", 0.85);
        URL.revokeObjectURL(url);
        resolve(dataUrl);
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image load failed"));
    };
    img.src = url;
  });
}

async function uploadDocument(file) {
  const fd = new FormData();
  fd.append("file", file);
  try {
    const res = await fetch("/api/document", { method: "POST", body: fd });
    if (!res.ok) {
      let detail = "Sorry, I couldn't process this file.";
      try {
        const data = await res.json();
        if (data.detail) detail = data.detail;
      } catch {
        // ignore
      }
      return { ok: false, detail };
    }
    const data = await res.json();
    return { ok: true, text: data.text };
  } catch {
    return { ok: false, detail: "Connection lost. Check your internet connection." };
  }
}

// ---- Attach menu ----
function openAttachMenu() {
  attachMenu.classList.remove("hidden");
  plusBtn.setAttribute("aria-expanded", "true");
}

function closeAttachMenu() {
  attachMenu.classList.add("hidden");
  plusBtn.setAttribute("aria-expanded", "false");
}

plusBtn.addEventListener("click", () => {
  if (attachMenu.classList.contains("hidden")) openAttachMenu();
  else closeAttachMenu();
});

attachMenu.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-kind]");
  if (!btn) return;
  const kind = btn.dataset.kind;
  closeAttachMenu();
  if (kind === "image") document.getElementById("file-image-input").click();
  else if (kind === "document") document.getElementById("file-doc-input").click();
  else if (kind === "file") document.getElementById("file-generic-input").click();
  else if (kind === "camera") document.getElementById("camera-input").click();
  else if (kind === "gallery") document.getElementById("gallery-input").click();
});

document.addEventListener("click", (e) => {
  if (!attachMenu.classList.contains("hidden")) {
    if (!attachMenu.contains(e.target) && !plusBtn.contains(e.target)) {
      closeAttachMenu();
    }
  }
});

["file-image-input", "file-doc-input", "file-generic-input", "camera-input", "gallery-input"].forEach((id) => {
  const input = document.getElementById(id);
  input.addEventListener("change", () => {
    for (const file of input.files) addAttachment(file);
    input.value = "";
  });
});

// ---- Drag & drop ----
let dragDepth = 0;

["dragenter", "dragover"].forEach((evt) => {
  window.addEventListener(evt, (e) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes("Files")) return;
    e.preventDefault();
    if (evt === "dragenter") dragDepth++;
    dropZone.classList.remove("hidden");
    document.body.classList.add("drag-active");
  });
});

window.addEventListener("dragleave", (e) => {
  if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes("Files")) return;
  dragDepth--;
  if (dragDepth <= 0) {
    dragDepth = 0;
    dropZone.classList.add("hidden");
    document.body.classList.remove("drag-active");
  }
});

window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropZone.classList.add("hidden");
  document.body.classList.remove("drag-active");
  const files = e.dataTransfer ? e.dataTransfer.files : [];
  for (const file of files) addAttachment(file);
});

// =====================================================================
//  Send / chat
// =====================================================================
sendBtn.addEventListener("click", () => sendMessage());

formInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && settings.enterToSend) {
    event.preventDefault();
    sendMessage();
  }
});

formInput.addEventListener("input", () => {
  formInput.style.height = "auto";
  formInput.style.height = Math.min(formInput.scrollHeight, 140) + "px";
});

async function sendMessage() {
  if (busy) return;

  const text = formInput.value.trim();
  const images = attachments
    .filter((a) => a.kind === "image" && a.status === "ready")
    .map((a) => a.dataUrl);
  const docAtt = attachments.find((a) => a.kind === "document" && a.status === "ready");

  if (!text && images.length === 0 && !docAtt) return;
  if (text.length > MAX_MESSAGE_LENGTH) {
    showError(`Message is too long (max ${MAX_MESSAGE_LENGTH} characters).`);
    return;
  }

  hideError();

  if (!currentId) {
    currentId = "c_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  enterChatMode();
  busy = true;
  setComposerDisabled(true);

  const userContent = text || (docAtt ? "Tell me about the attached document." : "What can you tell me about this image?");
  const userMsg = { role: "user", content: userContent, images: images.slice() };
  const label = images.length
    ? userContent + (text ? "" : "") + (images.length > 1 ? `\n\ud83d\udcf7 ${images.length} images` : "\n\ud83d\udcf7 image")
    : userContent;

  showMessage(label, "user");
  messages.push(userMsg);

  const docPayload = docAtt ? { name: docAtt.name, text: docAtt.text } : null;

  attachments.length = 0;
  renderAttachments();

  formInput.value = "";
  formInput.style.height = "auto";

  showLoading();
  const result = await streamChat(messages, docPayload);
  hideLoading();

  // Images are never kept in history; strip them now that the request went out.
  messages.forEach((m) => delete m.images);

  if (!result.ok) showError(result.detail);

  busy = false;
  setComposerDisabled(false);
  formInput.focus();
}

function buildPayload(list) {
  return list.map((m) => ({ role: m.role, content: m.content, images: m.images || [] }));
}

async function streamChat(allMsgs, document) {
  const payload = { messages: buildPayload(allMsgs), stream: true };
  if (document) payload.document = document;

  let res;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    return {
      ok: false,
      detail: "Network error: I could not reach the server. Make sure your connection is working, then try again.",
    };
  }

  if (!res.ok) {
    let detail = "Something went wrong. Please try again.";
    try {
      const data = await res.json();
      if (data.detail) detail = data.detail;
    } catch {
      // ignore
    }
    return { ok: false, detail };
  }

  const ctype = res.headers.get("content-type") || "";

  // Non-stream fallback (older proxies etc.):
  if (!ctype.includes("text/event-stream")) {
    try {
      const data = await res.json();
      if (data.detail) return { ok: false, detail: data.detail };
      const reply = data.reply || "";
      if (!reply.trim()) return { ok: false, detail: "Nova could not generate a reply. Please try again." };
      showMessage(reply, "ai");
      messages.push({ role: "assistant", content: reply });
      saveConversation();
      if (settings.autoSpeak) speakText(reply);
      return { ok: true };
    } catch {
      return { ok: false, detail: "Something went wrong reading the reply." };
    }
  }

  // SSE streaming path.
  const bubble = createEmptyAiBubble();
  let full = "";
  let streamError = null;
  try {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let done = false;
    while (!done) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });
      let sep;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const line = block.match(/^data: ?(.*)$/m);
        if (!line) continue;
        let obj;
        try {
          obj = JSON.parse(line[1]);
        } catch {
          continue;
        }
        if (typeof obj.delta === "string") {
          full += obj.delta;
          bubble.textContent = full;
          chat.scrollTop = chat.scrollHeight;
        } else if (typeof obj.error === "string") {
          streamError = obj.error;
        } else if (obj.done) {
          done = true;
          break;
        }
      }
    }
  } catch {
    streamError = streamError || "Connection lost. Check your internet connection.";
  }

  if (streamError) {
    return { ok: false, detail: streamError };
  }

  const reply = full.trim();
  if (!reply) {
    bubble.remove();
    return { ok: false, detail: "Nova could not generate a reply. Please try again." };
  }

  messages.push({ role: "assistant", content: reply });
  attachListenButton(bubble, reply);
  saveConversation();
  if (settings.autoSpeak) speakText(reply);
  return { ok: true };
}

// =====================================================================
//  Speech output (Listen buttons + auto-speak)
// =====================================================================
let currentAudio = null;
let interruptListeners = [];

function attachListenButton(bubble, text) {
  const row = document.createElement("div");
  row.className = "bubble-actions";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "listen-btn";
  btn.setAttribute("aria-label", "Listen to this reply");
  btn.textContent = "\ud83d\udd0a Listen";

  btn.addEventListener("click", async () => {
    if (btn.classList.contains("playing")) {
      stopSpeech();
      return;
    }
    btn.disabled = true;
    const res = await speakText(text, () => {
      btn.classList.add("playing");
      btn.textContent = "\u23f8 Stop";
    });
    btn.disabled = false;
    btn.classList.remove("playing");
    btn.textContent = "\ud83d\udd0a Listen";
    if (!res.ok) showError(res.detail);
  });

  row.appendChild(btn);
  chat.appendChild(row);
}

function speakText(text, onStart) {
  stopSpeech();
  return new Promise((resolve) => {
    fetch("/api/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: settings.voice, speed: settings.speed }),
    })
      .then(async (res) => {
        if (!res.ok) {
          let detail = "Sorry, I could not generate the audio.";
          try {
            const data = await res.json();
            if (data.detail) detail = data.detail;
          } catch {
            // ignore
          }
          currentAudio = null;
          resolve({ ok: false, detail });
          return null;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        currentAudio = audio;
        if (onStart) onStart();
        audio.onended = () => {
          currentAudio = null;
          URL.revokeObjectURL(url);
          resolve({ ok: true });
        };
        audio.onerror = () => {
          currentAudio = null;
          URL.revokeObjectURL(url);
          resolve({ ok: false, detail: "Could not play the audio on this device." });
        };
        audio.play().catch(() => {
          currentAudio = null;
          resolve({ ok: false, detail: "Could not play the audio on this device." });
        });
        return null;
      })
      .catch(() => {
        currentAudio = null;
        resolve({ ok: false, detail: "Connection lost. Check your internet connection." });
      });
  });
}

function stopSpeech() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = "";
    currentAudio = null;
  }
  if (voice.playerStop) {
    const stop = voice.playerStop;
    voice.playerStop = null;
    stop();
  }
}

// =====================================================================
//  Voice chat screen
// =====================================================================
const voice = {
  state: "idle",
  stream: null,
  recorder: null,
  chunks: [],
  ctx: null,
  analyser: null,
  rafId: 0,
  alive: false,
  muted: false,
  finalizing: false,
  lastFrameIsSpeech: false,
  silentMs: 0,
  speechMs: 0,
  turn: 0,
};

const VOICE_STATES = {
  idle: { title: "Voice chat with Nova", sub: "Tap the microphone to start talking", orb: "idle", pill: "" },
  connecting: { title: "Connecting…", sub: "Setting up the microphone", orb: "listening", pill: "Connecting" },
  listening: { title: "Listening…", sub: "Nova is listening to you", orb: "listening", pill: "Listening" },
  userSpeaking: { title: "Listening…", sub: "I can hear you", orb: "listening", pill: "Listening" },
  thinking: { title: "Thinking…", sub: "Nova is processing your request", orb: "thinking", pill: "Thinking" },
  speaking: { title: "Speaking…", sub: "Nova is responding", orb: "speaking", pill: "Speaking" },
  muted: { title: "Muted", sub: "Unmute to keep talking", orb: "listening", pill: "Muted" },
  disconnected: { title: "Disconnected", sub: "Voice chat ended", orb: "idle", pill: "" },
  error: { title: "Something went wrong", sub: "", orb: "error", pill: "Error" },
};

function setVoiceState(state, overrides) {
  voice.state = state;
  const meta = VOICE_STATES[state] || VOICE_STATES.idle;
  voiceOrb.className = "voice-orb " + meta.orb;
  voiceStateTitle.textContent = overrides?.title ?? meta.title;
  voiceStateSub.textContent = overrides?.sub ?? meta.sub;
  if (state === "disconnected" || state === "idle") {
    voicePill.classList.add("hidden");
  } else {
    voicePill.classList.remove("hidden");
    voicePill.textContent = meta.pill;
  }
}

function showVoiceScreen() {
  voiceScreen.classList.remove("hidden");
  voicePill.classList.add("hidden");
  voiceCaptions.innerHTML = "";
  voiceMuteBtn.classList.remove("muted-on");
  voice.turn = 0;
  setVoiceState("idle");
  voiceTalkBtn.setAttribute("aria-label", "Start voice chat");
  voiceTalkBtn.classList.remove("active");
  voiceTalkBtn.focus();
}

function hideVoiceScreen() {
  stopVoiceSession();
  voiceScreen.classList.add("hidden");
  formInput.focus();
}

voiceBackBtn.addEventListener("click", hideVoiceScreen);
voiceEndBtn.addEventListener("click", hideVoiceScreen);
micBtn.addEventListener("click", showVoiceScreen);
voiceTalkBtn.addEventListener("click", () => {
  if (voice.state === "idle" || voice.state === "disconnected" || voice.state === "error") {
    startVoiceSession();
  } else {
    endVoiceSession();
  }
});

voiceMuteBtn.addEventListener("click", () => {
  if (!voice.stream) return;
  voice.muted = !voice.muted;
  voice.stream.getAudioTracks().forEach((t) => (t.enabled = !voice.muted));
  voiceMuteBtn.classList.toggle("muted-on", voice.muted);
  voiceMuteBtn.setAttribute("aria-label", voice.muted ? "Unmute microphone" : "Mute microphone");
  if (voice.muted) setVoiceState("muted");
  else if (voice.state === "muted") setVoiceState("listening");
});

function voiceSupported() {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices && !!navigator.mediaDevices.getUserMedia && typeof MediaRecorder !== "undefined";
}

async function startVoiceSession() {
  if (!voiceSupported()) {
    setVoiceState("error", { title: "Not supported", sub: "Voice chat is not supported by this browser." });
    addVoiceCaption("muted", "Voice chat is not supported by this browser.");
    return;
  }
  stopSpeech();
  setVoiceState("connecting");
  voice.alive = true;
  voice.muted = false;
  voice.chunks = [];
  voiceTalkBtn.classList.add("active");
  voiceTalkBtn.setAttribute("aria-label", "End voice chat");
  voiceMuteBtn.disabled = false;

  try {
    voice.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (err) {
    voice.alive = false;
    voiceTalkBtn.classList.remove("active");
    const name = err && err.name;
    const title = name === "NotAllowedError" || name === "PermissionDeniedError" ? "Microphone access denied" : "Microphone error";
    const sub =
      name === "NotAllowedError" || name === "PermissionDeniedError"
        ? "Microphone access is required for voice chat. Please allow microphone access and try again."
        : "Could not start the microphone. Check that no other app is using it.";
    setVoiceState("error", { title, sub });
    addVoiceCaption("muted", sub);
    return;
  }

  voice.ctx = new (window.AudioContext || window.webkitAudioContext)();
  const src = voice.ctx.createMediaStreamSource(voice.stream);
  voice.analyser = voice.ctx.createAnalyser();
  voice.analyser.fftSize = 1024;
  src.connect(voice.analyser);
  // Do not connect to destination to avoid feedback.

  startRecordSegment();
  setVoiceState("listening");
  runVAD();
}

function startRecordSegment() {
  if (!voice.alive) return;
  voice.chunks = [];
  const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : MediaRecorder.isTypeSupported("audio/webm")
    ? "audio/webm"
    : "";
  try {
    voice.recorder = new MediaRecorder(voice.stream, mime ? { mimeType: mime } : undefined);
  } catch {
    voice.recorder = new MediaRecorder(voice.stream);
  }
  voice.recorder.ondataavailable = (e) => {
    if (e.data && e.data.size) voice.chunks.push(e.data);
  };
  voice.recorder.start(250);
}

function stopRecordSegment() {
  return new Promise((resolve) => {
    if (!voice.recorder || voice.recorder.state === "inactive") {
      resolve(null);
      return;
    }
    voice.recorder.onstop = () => {
      const type = voice.recorder.mimeType || "audio/webm";
      resolve(new Blob(voice.chunks, { type }));
    };
    voice.recorder.stop();
  });
}

function runVAD() {
  const loop = () => {
    if (!voice.alive || voice.state === "disconnected") return;
    if (voice.state === "muted" || voice.state === "thinking") {
      voice.rafId = requestAnimationFrame(loop);
      return;
    }
    const analyser = voice.analyser;
    const data = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);
    const speaking = rms > 0.012;

    if (speaking) {
      voice.speechMs += 100;
      voice.silentMs = 0;
      if (voice.state === "speaking") {
        // Barge-in: user started talking while Nova speaks.
        stopSpeech();
        setVoiceState("userSpeaking");
        if (voice.recorder && voice.recorder.state === "inactive") startRecordSegment();
      } else if (voice.state === "listening" && !voice.finalizing) {
        setVoiceState("userSpeaking");
      }
    } else {
      voice.silentMs += 100;
      voice.speechMs = 0;
      if (voice.state === "userSpeaking" && !voice.finalizing) {
        if (voice.silentMs >= 1200) finalizeTurn();
      }
    }
    voice.rafId = requestAnimationFrame(loop);
  };
  cancelAnimationFrame(voice.rafId);
  voice.rafId = requestAnimationFrame(loop);
}

async function finalizeTurn() {
  if (!voice.alive || voice.finalizing) return;
  voice.finalizing = true;
  const blob = await stopRecordSegment();
  if (!blob || !voice.alive) {
    voice.finalizing = false;
    if (voice.alive) {
      startRecordSegment();
      setVoiceState("listening");
    }
    return;
  }

  setVoiceState("thinking");
  const fd = new FormData();
  fd.append("file", blob, "clip.webm");
  let text = "";
  try {
    const res = await fetch("/api/transcribe", { method: "POST", body: fd });
    if (!res.ok) {
      let detail = "I couldn't understand that. Try again.";
      try {
        const data = await res.json();
        if (data.detail) detail = data.detail;
      } catch {
        // ignore
      }
      throw new Error(detail);
    }
    const data = await res.json();
    text = (data.text || "").trim();
  } catch (err) {
    addVoiceCaption("nova", err.message || "I couldn't understand that. Try again.");
    voice.finalizing = false;
    if (voice.alive) {
      startRecordSegment();
      setVoiceState("listening");
    }
    return;
  }

  if (!text) {
    addVoiceCaption("muted", "I couldn't hear anything. Try again.");
    voice.finalizing = false;
    if (voice.alive) {
      startRecordSegment();
      setVoiceState("listening");
    }
    return;
  }

  addVoiceCaption("user", text);
  messages.push({ role: "user", content: text });

  // Ask Nova (same conversation as text chat).
  const reply = await getVoiceReply();
  voice.finalizing = false;
  if (!voice.alive) return;

  if (!reply.ok) {
    addVoiceCaption("nova", reply.detail);
    saveConversation();
    startRecordSegment();
    setVoiceState("listening");
    return;
  }

  messages.push({ role: "assistant", content: reply.text });
  addVoiceCaption("nova", reply.text);
  saveConversation();

  // Speak the reply (unless muted).
  if (!voice.muted && voice.alive) {
    setVoiceState("speaking");
    await playVoiceSpeech(reply.text);
  }
  if (voice.alive) {
    startRecordSegment();
    setVoiceState("listening");
  }
}

async function getVoiceReply() {
  try {
    const payload = { messages: buildPayload(messages), stream: false };
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      let detail = "Nova couldn't process your request. Please try again.";
      try {
        const data = await res.json();
        if (data.detail) detail = data.detail;
      } catch {
        // ignore
      }
      return { ok: false, detail };
    }
    const data = await res.json();
    const reply = (data.reply || "").trim();
    if (!reply) return { ok: false, detail: "Nova couldn't process your request. Please try again." };
    return { ok: true, text: reply };
  } catch {
    return { ok: false, detail: "Connection lost. Check your internet connection." };
  }
}

function playVoiceSpeech(text) {
  return new Promise((resolve) => {
    fetch("/api/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: settings.voice, speed: settings.speed }),
    })
      .then(async (res) => {
        if (!res.ok) {
          resolve();
          return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        currentAudio = audio;
        const stop = () => {
          audio.pause();
          audio.src = "";
          URL.revokeObjectURL(url);
          resolve();
        };
        audio.addEventListener("ended", () => {
          currentAudio = null;
          URL.revokeObjectURL(url);
          resolve();
        });
        audio.addEventListener("error", () => {
          currentAudio = null;
          URL.revokeObjectURL(url);
          resolve();
        });
        // Allow barge-in from VAD by making stopSpeech defeat the player.
        voice.playerStop = stop;
        audio.play().catch(stop);
      })
      .catch(() => resolve());
  });
}

function addVoiceCaption(role, text) {
  const cap = document.createElement("div");
  cap.className = "caption " + role;
  cap.textContent = text;
  voiceCaptions.appendChild(cap);
  voiceCaptions.scrollTop = voiceCaptions.scrollHeight;
  while (voiceCaptions.children.length > 14) {
    voiceCaptions.removeChild(voiceCaptions.firstChild);
  }
}

function endVoiceSession() {
  setVoiceState("disconnected");
  stopVoiceSession();
}

function stopVoiceSession() {
  voice.alive = false;
  voice.finalizing = false;
  cancelAnimationFrame(voice.rafId);
  try {
    if (voice.recorder && voice.recorder.state !== "inactive") voice.recorder.stop();
  } catch {
    // ignore
  }
  voice.recorder = null;
  if (voice.stream) {
    voice.stream.getTracks().forEach((t) => t.stop());
    voice.stream = null;
  }
  if (voice.ctx) {
    voice.ctx.close().catch(() => {});
    voice.ctx = null;
  }
  voice.analyser = null;
  stopSpeech();
  voiceTalkBtn.classList.remove("active");
  voiceTalkBtn.setAttribute("aria-label", "Start voice chat");
  voiceMuteBtn.disabled = true;
}

// =====================================================================
//  New conversation / boot
// =====================================================================
function startNewConversation() {
  if (messages.length > 0) saveConversation();
  messages = [];
  clearTranscript();
  attachments.length = 0;
  renderAttachments();
  document.body.classList.remove("chatting");
  hideError();
  currentId = null;
  setActiveId(null);
  renderHistoryList();
  formInput.focus();
}

function resetConversation() {
  startNewConversation();
}

newChatBtn.addEventListener("click", resetConversation);
logoBtn.addEventListener("click", resetConversation);

// Decorative/alt controls keep focus behaviour (harmless).
["imagine-btn", "signin-btn", "signup-btn"].forEach((id) => {
  const btn = document.getElementById(id);
  if (btn) btn.addEventListener("click", () => formInput.focus());
});

// Footer links with no real destination — just stay on the page.
["terms-link", "privacy-link", "privacy-choice"].forEach((id) => {
  const link = document.getElementById(id);
  if (link) link.addEventListener("click", (e) => e.preventDefault());
});

// Save any in-progress conversation when the tab/page is closed.
window.addEventListener("pagehide", () => {
  if (currentId && messages.length > 0) saveConversation();
});

// ---- Populate the voice list ----
async function populateVoices() {
  try {
    const res = await fetch("/api/voices");
    if (res.ok) {
      const data = await res.json();
      const voicesArr = Array.isArray(data.voices) && data.voices.length ? data.voices : ["tara"];
      setVoice.innerHTML = "";
      voicesArr.forEach((v) => {
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = v.charAt(0).toUpperCase() + v.slice(1);
        setVoice.appendChild(opt);
      });
      setVoice.value = settings.voice;
      if (![...setVoice.options].some((o) => o.value === settings.voice)) {
        settings.voice = voicesArr[0];
        saveSettings();
      }
    } else {
      setVoice.innerHTML = "";
      const opt = document.createElement("option");
      opt.value = DEFAULT_SETTINGS.voice;
      opt.textContent = "Default";
      setVoice.appendChild(opt);
      setVoice.value = DEFAULT_SETTINGS.voice;
    }
  } catch {
    // leave the default option present
  }
}

// ---- Initialise ----
(function init() {
  applyTheme();
  updateSettingsUI();
  populateVoices();
  renderHistoryList();

  if (currentId) {
    const conv = historyList.find((c) => c.id === currentId);
    if (conv && conv.messages.length > 0) {
      messages = conv.messages.map((m) => ({ role: m.role, content: m.content }));
      clearTranscript();
      messages.forEach((m) => showMessage(m.content, m.role === "assistant" ? "ai" : "user"));
      enterChatMode();
    } else {
      currentId = null;
      setActiveId(null);
    }
  }
})();