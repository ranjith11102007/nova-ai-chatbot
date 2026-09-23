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

// Conversation history for the current session.
let messages = [];
let busy = false;

// ---- Landing helpers ----
function enterChatMode() {
  if (document.body.classList.contains("chatting")) return;
  document.body.classList.add("chatting");
  setTimeout(() => {
    chat.scrollTop = chat.scrollHeight;
  }, 60);
}

function resetConversation() {
  messages = [];
  chat.innerHTML = "";
  document.body.classList.remove("chatting");
  hideError();
  formInput.focus();
}

// ---- Helper: create and append a chat bubble ----
function showMessage(content, role) {
  const div = document.createElement("div");
  div.className = `bubble ${role}`;
  div.textContent = content;
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

  if (!text) return; // never send empty messages
  if (text.length > MAX_MESSAGE_LENGTH) {
    showError(`Message is too long (max ${MAX_MESSAGE_LENGTH} characters).`);
    return;
  }

  hideError();

  // The first message transforms the landing page into a chat view.
  enterChatMode();

  // Disable the UI while waiting for Nova.
  busy = true;
  sendBtn.disabled = true;
  formInput.disabled = true;

  // Show the user's message and remember it.
  showMessage(text, "user");
  messages.push({ role: "user", content: text });
  formInput.value = "";
  formInput.style.height = "auto";

  showLoading();

  // Ask the backend for Nova's reply.
  const reply = await fetchReply(messages);

  // Clear the "thinking" bubble and show the reply.
  hideLoading();

  if (reply.ok) {
    messages.push({ role: "assistant", content: reply.text });
    showMessage(reply.text, "ai");
  } else {
    showError(reply.text);
  }

  // Re-enable the UI.
  busy = false;
  sendBtn.disabled = false;
  formInput.disabled = false;
  formInput.focus();
}

// ---- Talk to the backend ----
async function fetchReply(history) {
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history }),
    });

    if (!response.ok) {
      let detail = "Something went wrong. Please try again.";
      try {
        const data = await response.json();
        if (data.detail) detail = data.detail;
      } catch {
        // ignore: the body was not valid JSON
      }
      return { ok: false, text: detail };
    }

    const data = await response.json();
    return { ok: true, text: data.reply };
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

// ---- Decorative controls (kept interactive, harmless) ----
plusBtn.addEventListener("click", () => {
  formInput.focus();
});

["imagine-btn", "settings-btn", "signin-btn", "signup-btn"].forEach((id) => {
  const btn = document.getElementById(id);
  if (btn) btn.addEventListener("click", () => formInput.focus());
});

// ---- Footer links with no real destination - just stay on the page ----
["terms-link", "privacy-link", "privacy-choice"].forEach((id) => {
  const link = document.getElementById(id);
  if (link) link.addEventListener("click", (e) => e.preventDefault());
});