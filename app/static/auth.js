/* Nova AI - Firebase authentication (Google + Email/Password with Gmail
   verification). Degrades gracefully when firebase-config.js isn't filled in,
   so the app keeps working for guests. */
(function () {
  var CFG = window.NOVA_FIREBASE || null;
  var hasKeys =
    !!CFG &&
    !!CFG.apiKey &&
    CFG.apiKey.indexOf("YOUR_") !== 0 &&
    CFG.apiKey !== "";
  var firebaseAvailable = typeof window.firebase !== "undefined" && !!window.firebase.auth;

  window.novaUser = null; // { uid, email, name, provider } once verified
  window.novaAuthState = hasKeys && firebaseAvailable ? "ready" : "unconfigured";

  // Signed-in users get their own storage namespace; guests keep the shared one.
  window.novaStorageKey = function (base) {
    var u = window.novaUser;
    return u && u.uid ? base + "_u_" + u.uid : base;
  };

  function saveUser(u) {
    window.novaUser = u;
    try {
      if (u) localStorage.setItem("nova_user_v1", JSON.stringify(u));
      else localStorage.removeItem("nova_user_v1");
    } catch (e) {}
  }

  function loadSavedUser() {
    try {
      var u = JSON.parse(localStorage.getItem("nova_user_v1") || "null");
      return u && u.uid ? u : null;
    } catch (e) {
      return null;
    }
  }

  var els = {};
  function grab() {
    els = {
      chip: document.getElementById("profile-chip"),
      avatar: document.getElementById("profile-avatar"),
      name: document.getElementById("profile-name"),
      email: document.getElementById("profile-email"),
      out: document.getElementById("profile-out"),
      gplus: document.getElementById("profile-google"),
      menu: document.getElementById("profile-menu"),
      menuAvatar: document.getElementById("profile-menu-avatar"),
      menuName: document.getElementById("profile-menu-name"),
      provider: document.getElementById("profile-provider"),
      heroTitle: document.getElementById("hero-title"),
      recents: document.getElementById("profile-recents"),
      recentsWrap: document.getElementById("profile-recents-wrap"),
      add: document.getElementById("profile-add"),
      manage: document.getElementById("profile-manage"),
      signinBtn: document.getElementById("signin-btn"),
      signupBtn: document.getElementById("signup-btn"),
      modal: document.getElementById("auth-modal"),
      close: document.getElementById("auth-close"),
      tabSignin: document.getElementById("auth-tab-signin"),
      tabSignup: document.getElementById("auth-tab-signup"),
      google: document.getElementById("auth-google"),
      email: document.getElementById("auth-email"),
      password: document.getElementById("auth-password"),
      submit: document.getElementById("auth-submit"),
      status: document.getElementById("auth-status"),
      verify: document.getElementById("auth-verify"),
      verifyMsg: document.getElementById("auth-verify-msg"),
      resend: document.getElementById("auth-resend"),
    };
  }

  var mode = "signin";
  var pendingEmail = "";

  function init() {
    grab();

    if (els.signinBtn) els.signinBtn.addEventListener("click", function () { openModal("signin"); });
    if (els.signupBtn) els.signupBtn.addEventListener("click", function () { openModal("signup"); });
    if (els.chip) els.chip.addEventListener("click", toggleMenu);
    document.addEventListener("click", function (e) {
      if (els.menu && !els.menu.hidden &&
          (!els.chip || !els.chip.contains(e.target)) &&
          !els.menu.contains(e.target)) {
        closeMenu();
      }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && els.menu && !els.menu.hidden) closeMenu();
    });
    if (els.close) els.close.addEventListener("click", closeModal);
    if (els.tabSignin) els.tabSignin.addEventListener("click", function () { openModal("signin"); });
    if (els.tabSignup) els.tabSignup.addEventListener("click", function () { openModal("signup"); });
    if (els.google) els.google.addEventListener("click", signInWithGoogle);
    if (els.resend) els.resend.addEventListener("click", resendVerification);
    if (els.out) els.out.addEventListener("click", signOutAll);
    if (els.gplus) els.gplus.addEventListener("click", signInWithGoogle);
    if (els.add) els.add.addEventListener("click", function () {
      closeMenu();
      signInWithGoogle();
    });
    if (els.manage) els.manage.addEventListener("click", function () {
      try { window.open("https://myaccount.google.com", "_blank", "noopener"); } catch (e) {}
    });
    if (els.submit) els.submit.addEventListener("click", submitForm);
    if (els.modal) els.modal.addEventListener("click", function (e) {
      if (e.target === els.modal) closeModal();
    });
    if (els.email) {
      els.email.addEventListener("keydown", function (e) {
        if (e.key === "Enter") submitForm();
      });
    }
    if (els.password) {
      els.password.addEventListener("keydown", function (e) {
        if (e.key === "Enter") submitForm();
      });
    }

    // Guest/verifying user from a previous session.
    var saved = loadSavedUser();
    if (saved && saved.verified) {
      signOut(); // start guests clean on load; Firebase re-login is async
    } else if (saved) {
      saveUser(null);
      applyAuthUI(null);
    } else {
      applyAuthUI(null);
    }

    // An auth callback may have resolved before the DOM was ready.
    if (window.novaUser) applyAuthUI(window.novaUser);
    renderRecents();

    if (!hasKeys) {
      showStatus(els.status, "Sign in is not configured yet. Open static/firebase-config.js and add your Firebase keys.", "error");
    }
  }

  var auth = null;
  if (hasKeys && firebaseAvailable) {
    var app = firebase.initializeApp(CFG, "nova-app");
    auth = firebase.auth(app);
  }

  function notReady() {
    return !hasKeys || !firebaseAvailable;
  }

  function handleAuthUser(fbUser, silent) {
    if (!fbUser) {
      saveUser(null);
      applyAuthUI(null);
      emitChange();
      closeVerifyPanel();
      return;
    }

    var isVerified = !!fbUser.emailVerified;
    var user = {
      uid: fbUser.uid,
      email: fbUser.email || "",
      name: fbUser.displayName || displayNameFromEmail(fbUser.email) || "Nova user",
      photo: fbUser.photoURL || "",
      provider: (fbUser.providerData && fbUser.providerData[0] && fbUser.providerData[0].providerId) || "unknown",
      verified: isVerified,
    };

    if (!isVerified) {
      // Verification pending: behave as a guest, show the verify prompt.
      saveUser(null);
      applyAuthUI(null, user);
      pendingEmail = user.email;
      emitChange();
      openVerifyPrompt(user.email);
      return;
    }

    saveUser(user);
    rememberAccount(user);
    applyAuthUI(user);
    emitChange();
    closeVerifyPrompt();
  }

  function displayNameFromEmail(email) {
    if (!email) return "";
    var name = email.split("@")[0] || "";
    return name.replace(/[._-]+/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function emitChange() {
    try {
      window.dispatchEvent(new CustomEvent("nova-auth-changed", { detail: { user: window.novaUser } }));
    } catch (e) {}
  }

  function applyAuthUI(user, pending) {
    if (!els.chip) return;
    closeMenu();
    if (user && els.signinBtn) els.signinBtn.hidden = true;
    if (user && els.signupBtn) els.signupBtn.hidden = true;
    if (!user && els.signinBtn) els.signinBtn.hidden = false;
    if (!user && els.signupBtn) els.signupBtn.hidden = false;

    if (user) {
      els.chip.hidden = false;
      if (els.avatar) setAvatar(els.avatar, user);
      if (els.name) els.name.textContent = firstName(user);
      els.chip.title = user.email || user.name || "";
      if (els.menuAvatar) setAvatar(els.menuAvatar, user);
      if (els.menuName) els.menuName.textContent = user.name || user.email || "Nova user";
      if (els.email) els.email.textContent = user.email || "";
      if (els.provider) els.provider.textContent = providerLabel(user.provider);
    } else if (pending) {
      els.chip.hidden = false;
      if (els.avatar) setAvatarText(els.avatar, "?");
      if (els.name) els.name.textContent = "Verify your email";
      els.chip.title = "Verification pending";
    } else {
      els.chip.hidden = true;
    }
    setHeroGreeting(user || null);
    renderRecents();
  }

  function setAvatarText(el, letter) {
    el.innerHTML = "";
    el.textContent = letter || "N";
  }

  function setAvatar(el, user) {
    var letter = ((user && (user.name || user.email || "N")).charAt(0) || "N").toUpperCase();
    setAvatarText(el, letter);
    if (user && user.photo) {
      var img = document.createElement("img");
      img.className = "avatar-photo";
      img.src = user.photo;
      img.alt = "";
      el.appendChild(img);
    }
  }

  function firstName(user) {
    var n = String((user && (user.name || user.email)) || "").trim();
    if (!n) return "friend";
    n = n.split(/[\s@]+/)[0].replace(/[^a-zA-Z0-9\u00C0-\u024F]/g, "");
    return n || "friend";
  }

  // ---- Accounts on this device (device-level store, not per-account) ----
  var KNOWN_KEY = "nova_accounts_v1";

  function readKnownAccounts() {
    try {
      var list = JSON.parse(localStorage.getItem(KNOWN_KEY) || "[]");
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function rememberAccount(user) {
    var list = readKnownAccounts().filter(function (a) { return a.uid !== user.uid; });
    list.unshift({
      uid: user.uid,
      name: user.name,
      email: user.email || "",
      photo: user.photo || "",
      provider: user.provider,
      lastUsed: Date.now(),
    });
    if (list.length > 4) list.length = 4;
    try { localStorage.setItem(KNOWN_KEY, JSON.stringify(list)); } catch (e) {}
    renderRecents();
  }

  function renderRecents() {
    if (!els.recents) return;
    var list = readKnownAccounts().filter(function (a) {
      return !(window.novaUser && a.uid === window.novaUser.uid);
    });
    els.recents.innerHTML = "";
    if (els.recentsWrap) els.recentsWrap.hidden = list.length === 0;
    list.forEach(function (acc) {
      var row = document.createElement("button");
      row.type = "button";
      row.className = "profile-recent";

      var av = document.createElement("span");
      av.className = "profile-recent-avatar";
      var letter = ((acc.name || acc.email || "A").charAt(0) || "A").toUpperCase();
      av.textContent = letter;
      if (acc.photo) {
        var img = document.createElement("img");
        img.className = "avatar-photo";
        img.src = acc.photo;
        img.alt = "";
        av.appendChild(img);
      }

      var meta = document.createElement("span");
      meta.className = "profile-recent-meta";
      var un = document.createElement("span");
      un.className = "profile-recent-name";
      un.textContent = acc.name || acc.email || "Account";
      var ue = document.createElement("span");
      ue.className = "profile-recent-email";
      ue.textContent = acc.email || "";
      meta.appendChild(un);
      meta.appendChild(ue);

      row.appendChild(av);
      row.appendChild(meta);
      row.addEventListener("click", function () {
        closeMenu();
        signInWithGoogle(); // Firebase account chooser -> switches the active account
      });
      els.recents.appendChild(row);
    });
  }

  function toggleMenu() {
    if (!els.menu) return;
    if (els.menu.hidden) {
      els.menu.hidden = false;
      if (els.chip) els.chip.setAttribute("aria-expanded", "true");
    } else {
      closeMenu();
    }
  }

  function closeMenu() {
    if (els.menu) els.menu.hidden = true;
    if (els.chip) els.chip.setAttribute("aria-expanded", "false");
  }

  function providerLabel(p) {
    var map = {
      "google.com": "Google",
      "password": "Email",
      "github.com": "GitHub",
      "apple.com": "Apple",
    };
    return map[p] || p || "Account";
  }

  function setHeroGreeting(user) {
    if (!els.heroTitle) return;
    els.heroTitle.textContent = user
      ? "What should we explore, " + firstName(user) + "?"
      : "What should we explore?";
  }

  function signOutAll() {
    try {
      var keys = [];
      for (var i = 0; i < localStorage.length; i += 1) keys.push(localStorage.key(i));
      keys.forEach(function (k) {
        if (k === "nova_user_v1" || k === KNOWN_KEY ||
            (k.indexOf("nova_") === 0 && k.indexOf("_u_") !== -1)) {
          localStorage.removeItem(k);
        }
      });
    } catch (e) {}
    saveUser(null);
    renderRecents();
    applyAuthUI(null);
    emitChange();
    var done = function () { location.href = "/"; };
    if (auth) auth.signOut().then(done).catch(done);
    else done();
  }

  function openModal(target) {
    if (!els.modal) return;
    mode = target === "signup" ? "signup" : "signin";
    if (els.verify) els.verify.hidden = true;
    if (els.status) els.status.textContent = "";
    if (els.status) els.status.hidden = false;
    if (els.email) els.email.value = "";
    if (els.password) els.password.value = "";
    if (els.tabSignin) els.tabSignin.classList.toggle("active", mode === "signin");
    if (els.tabSignup) els.tabSignup.classList.toggle("active", mode === "signup");
    if (els.submit) els.submit.textContent = mode === "signup" ? "Create account" : "Sign in";
    els.modal.hidden = false;
    document.body.classList.add("auth-open");
    if (els.email) setTimeout(function () { els.email.focus(); }, 50);
  }

  function closeModal() {
    if (!els.modal) return;
    els.modal.hidden = true;
    document.body.classList.remove("auth-open");
  }

  function showStatus(el, msg, kind) {
    if (!el) return;
    el.textContent = msg;
    el.className = "auth-status" + (kind === "error" ? " error" : kind === "ok" ? " ok" : "");
    el.hidden = false;
  }

  function submitForm() {
    var email = els.email ? els.email.value.trim() : "";
    var password = els.password ? els.password.value : "";
    if (!email || !password) {
      showStatus(els.status, "Enter your email and a password (at least 6 characters).", "error");
      return;
    }
    if (notReady()) {
      showStatus(els.status, "Firebase isn't configured yet. Open static/firebase-config.js and add your keys.", "error");
      return;
    }
    showStatus(els.status, "", "");
    if (mode === "signup") signUp(email, password);
    else signIn(email, password);
  }

  function signUp(email, password) {
    auth.createUserWithEmailAndPassword(email, password)
      .then(function (cred) {
        pendingEmail = email;
        return cred.user.sendEmailVerification().then(function () {
          openVerifyPrompt(email);
          showStatus(els.status, "Account created! Verification email sent.", "ok");
        });
      })
      .catch(function (err) {
        showStatus(els.status, friendlyError(err), "error");
      });
  }

  function signIn(email, password) {
    auth.signInWithEmailAndPassword(email, password)
      .then(function () {
        closeModal();
      })
      .catch(function (err) {
        showStatus(els.status, friendlyError(err), "error");
      });
  }

  function signInWithGoogle() {
    if (notReady()) {
      if (els.status) showStatus(els.status, "Firebase isn't configured yet. Open static/firebase-config.js and add your keys.", "error");
      return;
    }
    var provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider)
      .then(function () { closeModal(); })
      .catch(function (err) {
        if (err.code === "auth/popup-blocked") {
          auth.signInWithRedirect(provider);
        } else {
          if (els.status) showStatus(els.status, friendlyError(err), "error");
        }
      });
  }

  function resendVerification() {
    if (!auth) return;
    auth.currentUser && auth.currentUser.sendEmailVerification()
      .then(function () {
        showStatus(els.status, "Verification email sent again. Check your Gmail inbox (and spam).", "ok");
      })
      .catch(function (err) {
        showStatus(els.status, friendlyError(err), "error");
      });
  }

  function refreshUser() {
    if (!auth || !auth.currentUser) return;
    auth.currentUser.reload()
      .then(function () {
        var u = auth.currentUser;
        if (u && u.emailVerified) {
          saveUser({
            uid: u.uid,
            email: u.email || "",
            name: u.displayName || displayNameFromEmail(u.email) || "Nova user",
            provider: "email",
            verified: true,
          });
          applyAuthUI(window.novaUser);
          emitChange();
          closeVerifyPrompt();
        }
      })
      .catch(function () {});
  }

  function openVerifyPrompt(email) {
    if (els.verifyMsg) els.verifyMsg.textContent =
      "Verification email sent to " + (email || "") +
      ". Open the link in your Gmail to verify this is really you, " +
      "then click the button below.";

    if (els.resend) els.resend.textContent = "I verified it \u2014 refresh";
    els.resend.removeEventListener("click", refreshUser);
    els.resend.addEventListener("click", refreshUser);

    var resendLink = document.getElementById("auth-resend-link");
    if (resendLink) {
      resendLink.hidden = false;
      resendLink.textContent = "Didn't get it? Resend";
      resendLink.addEventListener("click", resendVerification);
    }

    if (els.verify) els.verify.hidden = false;
    if (els.modal) els.modal.hidden = false;
    document.body.classList.add("auth-open");
  }

  function closeVerifyPrompt() {
    if (els.verify) els.verify.hidden = true;
    var resendLink = document.getElementById("auth-resend-link");
    if (resendLink) resendLink.hidden = true;
  }

  function closeVerifyPanel() {
    closeVerifyPrompt();
  }

  function signOut() {
    if (auth) {
      auth.signOut().catch(function () {});
    } else {
      saveUser(null);
      applyAuthUI(null);
      emitChange();
    }
  }

  function friendlyError(err) {
    var map = {
      "auth/email-already-in-use": "That email is already registered. Try signing in.",
      "auth/invalid-email": "That email address doesn't look valid.",
      "auth/user-not-found": "No account found for that email.",
      "auth/wrong-password": "Incorrect password. Try again.",
      "auth/weak-password": "Password is too weak (min 6 characters).",
      "auth/too-many-requests": "Too many attempts. Please wait a minute.",
      "auth/popup-closed-by-user": "Sign-in window was closed.",
      "auth/account-exists-with-different-credential":
        "An account already exists for that email. Try signing in instead.",
      "auth/network-request-failed": "Network problem. Check your connection.",
    };
    return map[err && err.code] || (err && err.message) || "Something went wrong. Try again.";
  }

  function boot() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }

  // Always wire the UI; then track Firebase auth state once it settles.
  boot();
  if (auth) {
    auth.onAuthStateChanged(function (u) {
      handleAuthUser(u, true);
    });
  }
})();