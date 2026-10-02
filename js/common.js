// 머니브레인클럽 대시보드 — 공통 모듈 (Firebase 초기화, 인증, 헤더, 공용 유틸)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { firebaseConfig, SUPER_ADMIN_EMAIL } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

const isConfigured = firebaseConfig.apiKey && firebaseConfig.apiKey !== "REPLACE_ME";

let currentUser = null;
let currentProfile = null; // { nickname, role, email }
const listeners = [];

export function onReady(cb) {
  listeners.push(cb);
  if (currentProfile !== null || currentUser === null) cb(currentUser, currentProfile);
}

function notify() {
  listeners.forEach(cb => cb(currentUser, currentProfile));
}

export function getCurrentUser() { return currentUser; }
export function getCurrentProfile() { return currentProfile; }
export function isStaff(profile = currentProfile) {
  return !!profile && (profile.role === "admin" || profile.role === "staff");
}
export function isAdmin(profile = currentProfile) {
  return !!profile && profile.role === "admin";
}

async function ensureUserDoc(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const role = (user.email === SUPER_ADMIN_EMAIL) ? "admin" : "member";
    const profile = {
      email: user.email,
      nickname: user.displayName || user.email.split("@")[0],
      role,
      createdAt: Date.now()
    };
    await setDoc(ref, profile);
    return profile;
  }
  return snap.data();
}

if (isConfigured) {
  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    if (user) {
      try {
        currentProfile = await ensureUserDoc(user);
      } catch (e) {
        console.error("프로필 로드 실패", e);
        currentProfile = { email: user.email, nickname: user.email, role: "member" };
      }
    } else {
      currentProfile = null;
    }
    notify();
  });
} else {
  console.warn("firebase-config.js 가 아직 설정되지 않았습니다. README.md 를 참고해 Firebase 프로젝트를 연결하세요.");
}

export async function doSignUp(email, password, nickname) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  if (nickname) await updateProfile(cred.user, { displayName: nickname });
  const role = (email === SUPER_ADMIN_EMAIL) ? "admin" : "member";
  await setDoc(doc(db, "users", cred.user.uid), {
    email, nickname: nickname || email.split("@")[0], role, createdAt: Date.now()
  });
  return cred.user;
}

export async function doLogIn(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export async function doLogOut() {
  return signOut(auth);
}

// ---------- 헤더 ----------
export function mountHeader(activePage) {
  const host = document.getElementById("site-header");
  if (!host) return;
  host.innerHTML = `
    <div class="bar">
      <a class="brand" href="./index.html">
        <span class="mark">MB</span>
        <span>머니브레인클럽</span>
      </a>
      <div class="header-actions" id="header-actions"></div>
    </div>
  `;
  const actions = document.getElementById("header-actions");

  function render(user, profile) {
    if (!isConfigured) {
      actions.innerHTML = `<span class="whoami" style="color:#b2452c;">⚠ Firebase 설정 필요 (README.md 참고)</span>`;
      return;
    }
    if (!user) {
      actions.innerHTML = `<button class="btn primary small" id="open-login-btn">로그인 / 가입</button>`;
      document.getElementById("open-login-btn").onclick = () => openAuthModal();
      return;
    }
    const navHtml = [];
    if (activePage !== "portal") navHtml.push(`<a class="navlink" href="./index.html">포털</a>`);
    if (isStaff(profile) && activePage !== "admin") navHtml.push(`<a class="navlink" href="./admin.html">관리자</a>`);
    actions.innerHTML = `
      ${navHtml.join("")}
      <span class="whoami"><b>${escapeHtml(profile?.nickname || user.email)}</b>${roleLabel(profile?.role)}</span>
      <button class="btn ghost small" id="logout-btn">로그아웃</button>
    `;
    document.getElementById("logout-btn").onclick = () => doLogOut();
  }
  onReady(render);
}

function roleLabel(role) {
  if (role === "admin") return ` · <span style="color:#c99a3e;">어드민</span>`;
  if (role === "staff") return ` · <span style="color:#2f8f5b;">운영진</span>`;
  return "";
}

export function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[m]);
}

// ---------- 로그인/가입 모달 ----------
let modalEl = null;
export function openAuthModal() {
  if (modalEl) return;
  modalEl = document.createElement("div");
  modalEl.className = "modal-backdrop";
  modalEl.innerHTML = `
    <div class="modal">
      <button class="close-x" id="auth-close">✕</button>
      <div class="modal-tabs">
        <button class="active" data-mode="login">로그인</button>
        <button data-mode="signup">회원가입</button>
      </div>
      <h3 id="auth-title">로그인</h3>
      <p class="sub" id="auth-sub">가입하신 이메일로 로그인하세요.</p>
      <form id="auth-form">
        <div class="field" id="nickname-field" style="display:none;">
          <label>닉네임</label>
          <input type="text" id="auth-nickname" placeholder="예) 슈페로" />
        </div>
        <div class="field">
          <label>이메일</label>
          <input type="email" id="auth-email" required />
        </div>
        <div class="field">
          <label>비밀번호</label>
          <input type="password" id="auth-password" required minlength="6" />
        </div>
        <div class="form-error" id="auth-error"></div>
        <button class="btn primary" type="submit" style="width:100%;" id="auth-submit">로그인</button>
      </form>
    </div>
  `;
  document.body.appendChild(modalEl);
  let mode = "login";

  const tabs = modalEl.querySelectorAll(".modal-tabs button");
  tabs.forEach(btn => btn.onclick = () => {
    mode = btn.dataset.mode;
    tabs.forEach(b => b.classList.toggle("active", b === btn));
    document.getElementById("nickname-field").style.display = mode === "signup" ? "block" : "none";
    document.getElementById("auth-title").textContent = mode === "signup" ? "회원가입" : "로그인";
    document.getElementById("auth-sub").textContent = mode === "signup"
      ? "이메일과 닉네임으로 가입하세요. 책별 열람 권한은 어드민이 부여합니다."
      : "가입하신 이메일로 로그인하세요.";
    document.getElementById("auth-submit").textContent = mode === "signup" ? "가입하기" : "로그인";
    document.getElementById("auth-error").textContent = "";
  });

  document.getElementById("auth-close").onclick = closeAuthModal;
  modalEl.addEventListener("click", (e) => { if (e.target === modalEl) closeAuthModal(); });

  document.getElementById("auth-form").onsubmit = async (e) => {
    e.preventDefault();
    const email = document.getElementById("auth-email").value.trim();
    const password = document.getElementById("auth-password").value;
    const nickname = document.getElementById("auth-nickname").value.trim();
    const errEl = document.getElementById("auth-error");
    errEl.textContent = "";
    try {
      if (mode === "signup") {
        if (!nickname) { errEl.textContent = "닉네임을 입력해주세요."; return; }
        await doSignUp(email, password, nickname);
      } else {
        await doLogIn(email, password);
      }
      closeAuthModal();
    } catch (err) {
      errEl.textContent = friendlyAuthError(err);
    }
  };
}

export function closeAuthModal() {
  if (modalEl) { modalEl.remove(); modalEl = null; }
}

function friendlyAuthError(err) {
  const code = err?.code || "";
  if (code.includes("email-already-in-use")) return "이미 가입된 이메일입니다. 로그인 해주세요.";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) return "이메일 또는 비밀번호가 올바르지 않습니다.";
  if (code.includes("weak-password")) return "비밀번호는 6자 이상이어야 합니다.";
  if (code.includes("invalid-email")) return "이메일 형식이 올바르지 않습니다.";
  return "오류가 발생했습니다: " + (err?.message || err);
}

export function qs(sel, root = document) { return root.querySelector(sel); }
export function qsa(sel, root = document) { return [...root.querySelectorAll(sel)]; }
