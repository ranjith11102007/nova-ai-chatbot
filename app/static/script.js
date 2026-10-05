// ---- Element references ----
const chat = document.getElementById("chat");
const hero = document.getElementById("hero");
const formInput = document.getElementById("user-input");
const sendBtn = document.getElementById("send-btn");
const plusBtn = document.getElementById("plus-btn");
const newChatBtn = document.getElementById("new-chat-btn");
const logoBtn = document.getElementById("logo-btn");
const errorBar = document.getElementById("error-bar");

const MAX_MESSAGE_LENGTH = 4000;
const MAX_ATTACHMENTS = 4;
const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;

// Pending attachments for the message being composed.
// Images keep the full data URL for the API plus a tiny thumbnail for storage.
let pendingImages = []; // { dataUrl, thumb, name }
let pendingDocs = []; // { name, text }
// Thumbnails/names of the attachments that belong to each message, kept out of
// `messages` so history storage never holds full image bytes.
let currentAttachments = [];

// Namespaces storage per signed-in account (see auth.js). Guests share one store.
const storageKey =
  typeof window.novaStorageKey === "function"
    ? window.novaStorageKey
    : (base) => base;

// Conversation history for the current session.
let messages = [];
let busy = false;

// ---- Chat history (persisted in localStorage) ----
const HISTORY_KEY = () => storageKey("nova_history_v1");
const ACTIVE_KEY = () => storageKey("nova_active_id");
const MAX_HISTORY = 50;
const TITLE_MAX = 48;

// ---- Settings (persisted in localStorage) ----
const SETTINGS_KEY = () => storageKey("nova_settings_v1");
const LANGUAGES = [
  "",
  "English",
  "Tamil",
  "Hindi",
  "Telugu",
  "Kannada",
  "Malayalam",
  "Bengali",
  "Spanish",
  "French",
  "German",
  "Arabic",
  "Japanese",
  "Chinese",
];

function defaultSettings() {
  return { theme: "system", timestamps: false, language: "", fontSize: "normal", model: "" };
}

function readSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY());
    const parsed = raw ? JSON.parse(raw) : {};
    const base = defaultSettings();
    for (const key of Object.keys(base)) {
      if (typeof parsed[key] !== typeof base[key]) parsed[key] = base[key];
    }
    return parsed;
  } catch {
    return defaultSettings();
  }
}

function writeSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY(), JSON.stringify(settings));
  } catch {
    // storage unavailable — settings just will not persist
  }
}

function resolveTheme() {
  if (settings.theme !== "system") return settings.theme;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applySettings() {
  document.documentElement.dataset.theme = resolveTheme();
  document.documentElement.dataset.font = settings.fontSize;
}

let historyList = readHistory();
let currentId = readActiveId();
let settings = readSettings();

function readHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY());
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeHistory() {
  try {
    localStorage.setItem(HISTORY_KEY(), JSON.stringify(historyList));
  } catch {
    // storage full or unavailable — history just will not persist
  }
}

function readActiveId() {
  return localStorage.getItem(ACTIVE_KEY()) || null;
}

function setActiveId(id) {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY(), id);
    else localStorage.removeItem(ACTIVE_KEY());
  } catch {
    // ignore
  }
}

// Clear only the chat bubbles, keeping the "New chat" pill inside the transcript.
function clearTranscript() {
  chat.querySelectorAll(".bubble").forEach((bubble) => bubble.remove());
}

function conversationTitle() {
  const first = messages.find((m) => m.role === "user");
  const text = (first && first.content) || "New chat";
  return text.length > TITLE_MAX ? text.slice(0, TITLE_MAX - 1) + "\u2026" : text;
}

function saveConversation() {
  if (!currentId) return;
  const existing = historyList.find((c) => c.id === currentId);
  historyList = historyList.filter((c) => c.id !== currentId);
  historyList.unshift({
    id: currentId,
    title: conversationTitle(),
    updated: Date.now(),
    messages: messages.slice(),
    attachments: currentAttachments.slice(),
  });
  historyList.sort((a, b) => b.updated - a.updated);
  if (historyList.length > MAX_HISTORY) historyList.length = MAX_HISTORY;
  writeHistory();
  setActiveId(currentId);
  renderHistoryList();
}

function deleteConversation(id) {
  historyList = historyList.filter((c) => c.id !== id);
  if (id === currentId) {
    // Reset the in-memory state without saving the deleted chat back.
    currentId = null;
    messages = [];
    currentAttachments = [];
    clearPendingAttachments();
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
  currentAttachments = Array.isArray(conv.attachments) ? conv.attachments.slice() : [];
  clearPendingAttachments();
  renderMessages();
  enterChatMode();
  hideError();
  setActiveId(id);
  renderHistoryList();
  closeHistory();
}

function formatTime(ts) {
  const d = new Date(ts);
  const today = new Date();
  const time = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (d.toDateString() === today.toDateString()) return "Today " + time;
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday " + time;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function renderHistoryList() {
  const listEl = document.getElementById("history-list");
  listEl.innerHTML = "";
  if (historyList.length === 0) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = "No past chats yet.";
    listEl.appendChild(empty);
    return;
  }
  historyList.forEach((conv) => {
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

    const del = document.createElement("button");
    del.type = "button";
    del.className = "history-delete";
    del.title = "Delete this chat";
    del.setAttribute("aria-label", "Delete this chat");
    del.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>';
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteConversation(conv.id);
    });

    item.appendChild(main);
    item.appendChild(del);
    item.addEventListener("click", () => openConversation(conv.id));
    listEl.appendChild(item);
  });
}

function openHistory() {
  renderHistoryList();
  document.body.classList.add("history-open");
  document.getElementById("history-backdrop").classList.remove("hidden");
}

function closeHistory() {
  document.body.classList.remove("history-open");
  document.getElementById("history-backdrop").classList.add("hidden");
}

document.getElementById("history-btn").addEventListener("click", openHistory);
document
  .getElementById("history-close-btn")
  .addEventListener("click", closeHistory);
document
  .getElementById("history-backdrop")
  .addEventListener("click", closeHistory);
document.getElementById("history-new-btn").addEventListener("click", () => {
  closeHistory();
  startNewConversation();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && document.body.classList.contains("history-open")) {
    closeHistory();
  }
  if (e.key === "Escape" && document.body.classList.contains("settings-open")) {
    closeSettings();
  }
});

// Save any in-progress conversation when the tab/page is closed.
window.addEventListener("pagehide", () => {
  if (currentId && messages.length > 0) saveConversation();
});

// ---- Landing helpers ----
function enterChatMode() {
  if (document.body.classList.contains("chatting")) return;
  document.body.classList.add("chatting");
  setTimeout(() => {
    chat.scrollTop = chat.scrollHeight;
  }, 60);
}

function startNewConversation() {
  if (messages.length > 0) saveConversation();
  messages = [];
  currentAttachments = [];
  clearPendingAttachments();
  clearTranscript();
  document.body.classList.remove("chatting");
  hideError();
  currentId = null;
  setActiveId(null);
  renderHistoryList();
  formInput.focus();
}

// Drop anything the user had staged but not yet sent.
function clearPendingAttachments() {
  pendingImages = [];
  pendingDocs = [];
  if (attachTray) {
    attachTray.innerHTML = "";
    attachTray.hidden = true;
  }
}

function resetConversation() {
  startNewConversation();
}

// ---- Helper: create and append a chat bubble ----
function showMessage(content, role, attachment, note) {
  const div = document.createElement("div");
  div.className = `bubble ${role}`;

  if (attachment && attachment.kind === "image" && attachment.thumb) {
    const img = document.createElement("img");
    img.className = "msg-image";
    img.src = attachment.thumb;
    img.alt = attachment.name || "Attached image";
    div.appendChild(img);
  } else if (attachment && attachment.kind === "file") {
    const chip = document.createElement("span");
    chip.className = "msg-file";
    chip.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
      ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
      '<path d="M14 2v6h6"/></svg>';
    const label = document.createElement("span");
    label.textContent = attachment.name || "document";
    chip.appendChild(label);
    div.appendChild(chip);
  }

  if (content) {
    const text = document.createElement("span");
    text.textContent = content;
    div.appendChild(text);
  }

  if (note) {
    const hint = document.createElement("span");
    hint.className = "msg-note";
    hint.textContent = note;
    div.appendChild(hint);
  }

  if (settings.timestamps) {
    const time = document.createElement("div");
    time.className = "msg-time";
    time.textContent = formatTime(Date.now());
    div.appendChild(time);
  }
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  return div;
}

// ---- Render a generated image as its own bubble, with a save button ----
function showGeneratedImage(dataUrl, prompt) {
  const div = document.createElement("div");
  div.className = "bubble ai";

  const row = document.createElement("div");
  row.className = "msg-image-row";

  const img = document.createElement("img");
  img.className = "msg-image";
  img.src = dataUrl;
  img.alt = prompt || "Generated image";

  const save = document.createElement("button");
  save.type = "button";
  save.className = "msg-image-save";
  save.textContent = "Save image";
  save.addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = dataUrl.startsWith("data:image/svg+xml")
      ? "nova-image.svg"
      : "nova-image.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  row.appendChild(img);
  row.appendChild(save);
  div.appendChild(row);

  if (settings.timestamps) {
    const time = document.createElement("div");
    time.className = "msg-time";
    time.textContent = formatTime(Date.now());
    div.appendChild(time);
  }

  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  return div;
}

// Replay a saved conversation, restoring its attachment thumbnails.
function renderMessages() {
  clearTranscript();
  messages.forEach((m, i) => {
    showMessage(
      m.content,
      m.role === "assistant" ? "ai" : "user",
      currentAttachments[i] || null
    );
  });
}

// Re-draw the current transcript (used when timestamps toggles on/off).
function rerenderTranscript() {
  renderMessages();
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

// ---- Send a message when the Send button is clicked ----
sendBtn.addEventListener("click", () => sendMessage());

// ---- Enter sends, Shift + Enter makes a new line ----
formInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});

// Auto-grow the textarea as the user types more lines.
formInput.addEventListener("input", () => {
  formInput.style.height = "auto";
  formInput.style.height = Math.min(formInput.scrollHeight, 140) + "px";
});

// ---- Main send flow ----
async function sendMessage() {
  if (busy) return;

  const text = formInput.value.trim();
  const hasAttachments = pendingImages.length > 0 || pendingDocs.length > 0;

  if (!text && !hasAttachments) return; // never send a completely empty message
  if (text.length > MAX_MESSAGE_LENGTH) {
    showError(`Message is too long (max ${MAX_MESSAGE_LENGTH} characters).`);
    return;
  }

  hideError();

  // Start tracking this chat in browser history on the first message.
  if (!currentId) {
    currentId =
      "c_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // The first message transforms the landing page into a chat view.
  enterChatMode();

  // Disable the UI while waiting for Nova.
  busy = true;
  sendBtn.disabled = true;
  formInput.disabled = true;

  // Build the marker that will live in history (thumbnail + name only).
  const marker = pendingImages.length
    ? { kind: "image", name: pendingImages[0].name, thumb: pendingImages[0].thumb }
    : pendingDocs.length
    ? { kind: "file", name: pendingDocs[0].name }
    : null;

  // Show the user's message and remember it.
  showMessage(text, "user", marker);
  messages.push({ role: "user", content: text });
  currentAttachments.push(marker);

  const images = pendingImages.map((a) => a.dataUrl);
  const documents = pendingDocs.map((d) => ({ name: d.name, text: d.text }));

  pendingImages = [];
  pendingDocs = [];
  renderTray();
  formInput.value = "";
  formInput.style.height = "auto";

  showLoading();

  // Ask the backend for Nova's reply.
  const reply = await fetchReply(messages, images, documents);

  // Clear the "thinking" bubble and show the reply.
  hideLoading();

  if (reply.ok) {
    messages.push({ role: "assistant", content: reply.text });
    currentAttachments.push(null);
    showMessage(reply.text, "ai", null, reply.note);
  } else {
    showError(reply.text);
  }

  // Remember the conversation in browser history.
  saveConversation();

  // Re-enable the UI.
  busy = false;
  sendBtn.disabled = false;
  formInput.disabled = false;
  formInput.focus();
}

// ---- The Imagine prompt dialog ----
const imagineModal = document.getElementById("imagine-modal");
const imagineInput = document.getElementById("imagine-input");
const imagineGenerate = document.getElementById("imagine-generate");
const imagineCloseBtn = document.getElementById("imagine-close");

let imagineResolver = null;
let imagineLastFocus = null;

function openImagineDialog(prefill) {
  if (!imagineModal) return;
  imagineLastFocus = document.activeElement;

  if (imagineInput) {
    imagineInput.value = (prefill || "").trim();
  }
  if (imagineGenerate) {
    imagineGenerate.disabled = false;
    imagineGenerate.textContent = "Generate image";
  }

  imagineModal.hidden = false;

  if (imagineInput) {
    imagineInput.focus();
    const end = imagineInput.value.length;
    imagineInput.setSelectionRange(end, end);
  }
}

function closeImagineDialog(value) {
  if (!imagineModal || imagineModal.hidden) return;
  imagineModal.hidden = true;

  const resolve = imagineResolver;
  imagineResolver = null;

  if (imagineLastFocus && typeof imagineLastFocus.focus === "function") {
    imagineLastFocus.focus();
  }
  imagineLastFocus = null;

  if (resolve) resolve(typeof value === "string" ? value.trim() : null);
}

// Resolves with the prompt the user typed, or null if they cancelled.
function askForImaginePrompt(prefill) {
  if (!imagineModal) return Promise.resolve(null);
  if (!imagineModal.hidden) return Promise.resolve(null);

  return new Promise((resolve) => {
    imagineResolver = resolve;
    openImagineDialog(prefill);
  });
}

if (imagineGenerate) {
  imagineGenerate.addEventListener("click", () => {
    if (busy) return;

    const value = imagineInput ? imagineInput.value.trim() : "";
    if (!value) {
      if (imagineInput) imagineInput.focus();
      return;
    }
    closeImagineDialog(value);
  });
}

if (imagineCloseBtn) {
  imagineCloseBtn.addEventListener("click", () => closeImagineDialog(null));
}

if (imagineModal) {
  imagineModal.addEventListener("click", (event) => {
    if (event.target === imagineModal) closeImagineDialog(null);
  });
}

document.querySelectorAll(".imagine-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    if (!imagineInput) return;
    imagineInput.value = chip.dataset.prompt || "";
    imagineInput.focus();
    const end = imagineInput.value.length;
    imagineInput.setSelectionRange(end, end);
  });
});

document.addEventListener("keydown", (event) => {
  if (!imagineModal || imagineModal.hidden) return;

  if (event.key === "Escape") {
    event.preventDefault();
    closeImagineDialog(null);
  } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    if (imagineGenerate) imagineGenerate.click();
  }
});

const imagineBtn = document.getElementById("imagine-btn");
if (imagineBtn) {
  imagineBtn.addEventListener("click", () => {
    if (busy) return;

    const typed = formInput.value.trim();
    if (typed) {
      // Already described it in the composer, so just draw it.
      formInput.value = "";
      formInput.dispatchEvent(new Event("input"));
      generateImageFromPrompt(typed);
    } else {
      generateImageFromPrompt();
    }
  });
}

// ---- Ask Nova to draw an image straight from the prompt ----
async function generateImageFromPrompt(promptText) {
  if (busy) return;

  let prompt = (promptText || "").trim();
  if (!prompt) {
    prompt = await askForImaginePrompt();
    if (!prompt) return;
  }

  hideError();

  if (!currentId) {
    currentId =
      "c_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  enterChatMode();

  busy = true;
  sendBtn.disabled = true;
  formInput.disabled = true;

  showMessage(prompt, "user");
  messages.push({ role: "user", content: prompt });
  currentAttachments.push(null);

  showLoading();

  let ok = false;
  let text = "";
  try {
    const response = await fetch("/api/image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: prompt, model: settings.model }),
    });
    if (response.ok) {
      const data = await response.json();
      hideLoading();
      showGeneratedImage(data.image, prompt);
      messages.push({
        role: "assistant",
        content: "Here is the image I generated for: " + prompt,
      });
      currentAttachments.push(null);
      ok = true;
    } else {
      text = await readError(response);
    }
  } catch {
    text = "Network error: I could not reach the server.";
  }

  hideLoading();
  if (!ok) {
    showError(text);
    // The prompt was already shown, so keep it consistent in memory.
  }

  saveConversation();

  busy = false;
  sendBtn.disabled = false;
  formInput.disabled = false;
  formInput.focus();
}

async function readError(response) {
  let detail = "Something went wrong. Please try again.";
  try {
    const data = await response.json();
    if (data.detail) detail = data.detail;
  } catch {
    // ignore: the body was not valid JSON
  }
  return detail;
}

// ---- Talk to the backend ----
async function fetchReply(history, images, documents) {
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: history,
        language: settings.language,
        model: settings.model,
        images: images || [],
        documents: documents || [],
      }),
    });

    if (!response.ok) {
      return { ok: false, text: await readError(response) };
    }

    const data = await response.json();
    return { ok: true, text: data.reply, note: data.note || "" };
  } catch (err) {
    // The server is down or unreachable.
    return {
      ok: false,
      text: "Network error: I could not reach the server. " +
        "Make sure uvicorn is running, then try again.",
    };
  }
}

// ---- Clear the conversation and return to the landing view ----
newChatBtn.addEventListener("click", resetConversation);
logoBtn.addEventListener("click", resetConversation);

// ---- Attachment menu (+ button) and the pending attachment tray ----
const attachMenu = document.getElementById("attach-menu");
const plusWrap = document.getElementById("plus-wrap");
const attachTray = document.getElementById("attach-tray");
const photoInput = document.getElementById("photo-input");
const docInput = document.getElementById("doc-input");

function openAttachMenu() {
  if (!attachMenu) return;
  attachMenu.classList.remove("hidden");
  plusBtn.setAttribute("aria-expanded", "true");
}

function closeAttachMenu() {
  if (!attachMenu) return;
  attachMenu.classList.add("hidden");
  plusBtn.setAttribute("aria-expanded", "false");
}

plusBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (attachMenu.classList.contains("hidden")) openAttachMenu();
  else closeAttachMenu();
});

document.addEventListener("click", (e) => {
  if (plusWrap && !plusWrap.contains(e.target)) closeAttachMenu();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeAttachMenu();
});

document.getElementById("attach-photo").addEventListener("click", () => {
  closeAttachMenu();
  photoInput.click();
});

document.getElementById("attach-doc").addEventListener("click", () => {
  closeAttachMenu();
  docInput.click();
});

document.getElementById("attach-generate").addEventListener("click", () => {
  closeAttachMenu();
  generateImageFromPrompt();
});

function renderTray() {
  if (!attachTray) return;
  attachTray.innerHTML = "";

  pendingImages.forEach((img, index) => {
    attachTray.appendChild(buildChip(img.name, img.thumb, "image", index));
  });
  pendingDocs.forEach((doc, index) => {
    attachTray.appendChild(buildChip(doc.name, null, "doc", index));
  });

  attachTray.hidden = attachTray.children.length === 0;
}

function buildChip(name, thumb, kind, index) {
  const chip = document.createElement("div");
  chip.className = "attach-chip";

  if (thumb) {
    const img = document.createElement("img");
    img.className = "attach-chip-thumb";
    img.src = thumb;
    img.alt = "";
    chip.appendChild(img);
  } else {
    const icon = document.createElement("span");
    icon.className = "attach-chip-icon";
    icon.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
      ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
      '<path d="M14 2v6h6"/></svg>';
    chip.appendChild(icon);
  }

  const label = document.createElement("span");
  label.className = "attach-chip-name";
  label.textContent = name || (kind === "image" ? "image" : "document");
  chip.appendChild(label);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "attach-chip-remove";
  remove.title = "Remove this attachment";
  remove.setAttribute("aria-label", "Remove this attachment");
  remove.innerHTML =
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
    ' stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M18 6L6 18M6 6l12 12"/></svg>';
  remove.addEventListener("click", () => {
    if (kind === "image") pendingImages.splice(index, 1);
    else pendingDocs.splice(index, 1);
    renderTray();
    formInput.focus();
  });

  chip.appendChild(remove);
  return chip;
}

// Read a file as a data URL and make a small thumbnail for history storage.
function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

function makeThumb(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const max = 160;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      try {
        resolve(canvas.toDataURL("image/jpeg", 0.6));
      } catch {
        resolve("");
      }
    };
    img.onerror = () => resolve("");
    img.src = dataUrl;
  });
}

photoInput.addEventListener("change", async () => {
  const file = photoInput.files && photoInput.files[0];
  photoInput.value = "";
  if (!file) return;

  if (pendingImages.length >= MAX_ATTACHMENTS) {
    showError(`You can attach up to ${MAX_ATTACHMENTS} images per message.`);
    return;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    showError("That image is too large. Please keep images under 6 MB.");
    return;
  }

  try {
    const dataUrl = await readAsDataUrl(file);
    const thumb = await makeThumb(dataUrl);
    pendingImages.push({ dataUrl, thumb, name: file.name });
    hideError();
    renderTray();
  } catch {
    showError("Could not read that image. Please try a different file.");
  }
});

docInput.addEventListener("change", async () => {
  const file = docInput.files && docInput.files[0];
  docInput.value = "";
  if (!file) return;

  if (pendingDocs.length >= MAX_ATTACHMENTS) {
    showError(`You can attach up to ${MAX_ATTACHMENTS} files per message.`);
    return;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    showError("That file is too large. Please keep files under 6 MB.");
    return;
  }

  const busyChip = document.createElement("div");
  busyChip.className = "attach-busy";
  busyChip.textContent = "Reading " + (file.name || "file") + "…";
  attachTray.appendChild(busyChip);
  attachTray.hidden = false;

  try {
    const form = new FormData();
    form.append("file", file);
    const response = await fetch("/api/document", { method: "POST", body: form });
    if (!response.ok) {
      showError(await readError(response));
      return;
    }
    const data = await response.json();
    pendingDocs.push({ name: data.name || file.name, text: data.text });
    hideError();
  } catch {
    showError("Could not upload that file. Please try again.");
  } finally {
    busyChip.remove();
    renderTray();
  }
});

["signin-btn", "signup-btn"].forEach((id) => {
  const btn = document.getElementById(id);
  if (btn) btn.addEventListener("click", () => formInput.focus());
});

// ---- Settings panel ----
const settingsBackdrop = document.getElementById("settings-backdrop");

function openSettings() {
  settingsBackdrop.classList.remove("hidden");
  document.body.classList.add("settings-open");
  syncSettingsUI();
}

function closeSettings() {
  settingsBackdrop.classList.add("hidden");
  document.body.classList.remove("settings-open");
}

function syncSettingsUI() {
  document
    .querySelectorAll('#theme-seg .seg[data-theme-val]')
    .forEach((seg) => seg.classList.toggle("active", seg.dataset.themeVal === settings.theme));
  document
    .querySelectorAll('#font-seg .seg[data-font-val]')
    .forEach((seg) => seg.classList.toggle("active", seg.dataset.fontVal === settings.fontSize));
  document.getElementById("set-timestamps").checked = !!settings.timestamps;
  const lang = document.getElementById("set-language");
  lang.value = LANGUAGES.includes(settings.language) ? settings.language : "";
}

// ---- Model picker (choice menu, left of the input) ----
const modelPicker = document.getElementById("model-picker");
const modelPickerBtn = document.getElementById("model-picker-btn");
const modelPickerLabel = document.getElementById("model-picker-label");
const modelMenu = document.getElementById("model-menu");
let modelCatalog = null;

async function loadModelCatalog() {
  try {
    const res = await fetch("/api/models");
    if (res.ok) modelCatalog = await res.json();
  } catch {
    modelCatalog = null;
  }
  syncModelPicker();
}

function modelName(provider, modelId) {
  try {
    const p = modelCatalog
      ? modelCatalog.providers.find((x) => x.id === provider)
      : null;
    if (p && p.labels && p.labels[modelId]) return p.labels[modelId];
  } catch {
    // fall through to the raw id
  }
  return modelId;
}

function activeModelRef() {
  const v = (settings.model || "").trim();
  if (!v) return { value: "", name: "Default" };
  const at = v.indexOf("@");
  const pid = at > 0 ? v.slice(0, at) : "groq";
  const mid = at > 0 ? v.slice(at + 1) : v;
  return { value: v, name: modelName(pid, mid) };
}

function buildMenuItem(value, name, subtitle, active) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "model-menu-item" + (active ? " active" : "");
  btn.dataset.value = value;
  btn.setAttribute("role", "menuitem");

  const check = document.createElement("span");
  check.className = "model-menu-check";
  check.innerHTML =
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
    ' stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M20 6L9 17l-5-5"/></svg>';

  const nameEl = document.createElement("span");
  nameEl.className = "model-menu-name";
  nameEl.textContent = name;
  btn.appendChild(check);
  btn.appendChild(nameEl);

  if (subtitle) {
    const idEl = document.createElement("span");
    idEl.className = "model-menu-id";
    idEl.textContent = subtitle;
    btn.appendChild(idEl);
  }
  return btn;
}

function addMenuNote(text) {
  const note = document.createElement("div");
  note.className = "model-menu-note";
  note.textContent = text;
  modelMenu.appendChild(note);
}

function addMenuTitle(text) {
  const title = document.createElement("div");
  title.className = "model-menu-group-title";
  title.textContent = text;
  modelMenu.appendChild(title);
}

function populateModelMenu() {
  modelMenu.innerHTML = "";
  const current = settings.model || "";
  modelMenu.appendChild(buildMenuItem("", "Server default", null, current === ""));

  if (!modelCatalog) {
    addMenuNote("Model list unavailable right now.");
    return;
  }

  (modelCatalog.providers || []).forEach((p) => {
    addMenuTitle(p.label);
    if (!p.configured) {
      addMenuNote(`Add ${p.key_env || "the provider key"} on the server to unlock`);
      return;
    }
    p.models.forEach((m) => {
      const value = `${p.id}@${m}`;
      modelMenu.appendChild(buildMenuItem(value, modelName(p.id, m), m, current === value));
    });
  });
}

function syncModelPicker() {
  const ref = activeModelRef();
  modelPickerLabel.textContent = ref.name;
  modelPickerBtn.title = ref.value ? `Model: ${ref.value}` : "Use the server default model";
}

function openModelMenu() {
  populateModelMenu();
  modelPicker.classList.add("open");
  modelMenu.classList.remove("hidden");
  modelPickerBtn.setAttribute("aria-expanded", "true");
}

function closeModelMenu() {
  modelPicker.classList.remove("open");
  modelMenu.classList.add("hidden");
  modelPickerBtn.setAttribute("aria-expanded", "false");
}

modelPickerBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (modelMenu.classList.contains("hidden")) openModelMenu();
  else closeModelMenu();
});

document.addEventListener("click", (e) => {
  if (!modelPicker.contains(e.target)) closeModelMenu();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModelMenu();
});

modelMenu.addEventListener("click", (e) => {
  const item = e.target.closest(".model-menu-item");
  if (!item || item.disabled) return;
  settings.model = item.dataset.value || "";
  writeSettings();
  syncModelPicker();
  closeModelMenu();
});

document.getElementById("settings-btn").addEventListener("click", openSettings);
document
  .getElementById("settings-close-btn")
  .addEventListener("click", closeSettings);
settingsBackdrop.addEventListener("click", closeSettings);

document.querySelectorAll('#theme-seg .seg[data-theme-val]').forEach((seg) => {
  seg.addEventListener("click", () => {
    settings.theme = seg.dataset.themeVal;
    writeSettings();
    applySettings();
    syncSettingsUI();
  });
});

document.querySelectorAll('#font-seg .seg[data-font-val]').forEach((seg) => {
  seg.addEventListener("click", () => {
    settings.fontSize = seg.dataset.fontVal;
    writeSettings();
    applySettings();
    syncSettingsUI();
  });
});

document.getElementById("set-timestamps").addEventListener("change", (e) => {
  settings.timestamps = e.target.checked;
  writeSettings();
  rerenderTranscript();
});

document.getElementById("set-language").addEventListener("change", (e) => {
  settings.language = e.target.value || "";
  writeSettings();
});

document.getElementById("set-clear").addEventListener("click", () => {
  if (!window.confirm("Delete all saved chats from this browser?")) return;
  try {
    localStorage.removeItem(HISTORY_KEY());
    localStorage.removeItem(ACTIVE_KEY());
  } catch {
    // ignore
  }
  historyList = [];
  currentId = null;
  messages = [];
  currentAttachments = [];
  clearPendingAttachments();
  clearTranscript();
  document.body.classList.remove("chatting");
  hideError();
  renderHistoryList();
  closeSettings();
  formInput.focus();
});

// Follow the OS theme when "System" is selected.
window
  .matchMedia("(prefers-color-scheme: light)")
  .addEventListener("change", () => {
    if (settings.theme === "system") applySettings();
  });

applySettings();
loadModelCatalog();

// ---- Footer links with no real destination - just stay on the page ----
["terms-link", "privacy-link", "privacy-choice"].forEach((id) => {
  const link = document.getElementById(id);
  if (link) link.addEventListener("click", (e) => e.preventDefault());
});

// ---- Restore the last open conversation on page load ----
(function restoreSession() {
  if (currentId) {
    const conv = historyList.find((c) => c.id === currentId);
    if (conv && conv.messages.length > 0) {
      messages = conv.messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      currentAttachments = Array.isArray(conv.attachments)
        ? conv.attachments.slice()
        : [];
      renderMessages();
      enterChatMode();
    } else {
      currentId = null;
      setActiveId(null);
    }
  }
  renderHistoryList();
})();

// ---- Per-account data: swap history/settings when the signed-in user changes ----
window.addEventListener("nova-auth-changed", () => {
  historyList = readHistory();
  currentId = readActiveId();
  settings = readSettings();
  applySettings();
  syncSettingsUI();
  renderHistoryList();
  startNewConversation();
});