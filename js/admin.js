import { mountHeader, onReady, isAdmin, isStaff, escapeHtml, getCurrentUser } from "./common.js";
import {
  listBooks, watchBooks, createBook, updateBook, deleteBook,
  listBookMembers, grantBookAccess, revokeBookAccess,
  listUsers, setUserRole, uploadBookCover
} from "./data.js";

mountHeader("admin");

let currentUser = null, currentProfile = null;
let books = [];
let users = [];
let selectedBookId = null;

onReady(async (user, profile) => {
  currentUser = user; currentProfile = profile;
  const gate = document.getElementById("access-gate");
  const content = document.getElementById("admin-content");
  if (!user) {
    gate.innerHTML = `<div class="lock-screen"><h2>🔒 로그인이 필요합니다</h2></div>`;
    content.style.display = "none";
    return;
  }
  if (!isStaff(profile)) {
    gate.innerHTML = `<div class="lock-screen"><h2>🔒 운영진/어드민만 접근할 수 있습니다</h2></div>`;
    content.style.display = "none";
    return;
  }
  gate.innerHTML = "";
  content.style.display = "grid";
  init();
});

async function init() {
  users = await listUsers();
  renderUserList();

  watchBooks(async (b) => {
    books = b;
    renderBookList();
    renderAccessBookSelect();
  });

  document.getElementById("book-form").onsubmit = async (e) => {
    e.preventDefault();
    const title = document.getElementById("bf-title").value.trim();
    const author = document.getElementById("bf-author").value.trim();
    const month = document.getElementById("bf-month").value.trim();
    const status = document.getElementById("bf-status").value;
    const challenge = document.getElementById("bf-challenge").checked;
    const coverFile = document.getElementById("bf-cover").files[0];
    if (!title) return;
    const submitBtn = e.target.querySelector("button[type=submit]");
    submitBtn.disabled = true;
    submitBtn.textContent = coverFile ? "표지 업로드 중…" : "추가 중…";
    try {
      const bookId = await createBook({ title, author, month, status, challenge });
      if (coverFile) {
        const coverUrl = await uploadBookCover(bookId, coverFile);
        await updateBook(bookId, { coverUrl });
      }
      e.target.reset();
      document.getElementById("bf-challenge").checked = true;
    } catch (err) {
      alert("책 추가 중 오류가 발생했습니다: " + (err.message || err));
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "책 추가";
    }
  };

  document.getElementById("access-book-select").onchange = (e) => {
    selectedBookId = e.target.value;
    renderAccessGrid();
  };
}

function renderBookList() {
  const host = document.getElementById("book-list");
  if (!books.length) { host.innerHTML = `<p class="hint">등록된 책이 없습니다.</p>`; return; }
  host.innerHTML = books.map(b => `
    <div class="list-row" data-id="${b.id}">
      <div style="display:flex;gap:10px;align-items:center;">
        <div class="cover-thumb" style="background-image:url('${b.coverUrl || ""}');">${b.coverUrl ? "" : escapeHtml((b.title || "?")[0])}</div>
        <div>
          <div class="name">${escapeHtml(b.title)}</div>
          <div class="sub">${[b.author, b.month].filter(Boolean).map(escapeHtml).join(" · ")}</div>
        </div>
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
        <select class="role-select" data-status="${b.id}">
          <option value="ongoing" ${b.status !== "finished" ? "selected" : ""}>진행중</option>
          <option value="finished" ${b.status === "finished" ? "selected" : ""}>Finished</option>
        </select>
        <label class="btn ghost small" style="cursor:pointer;">
          <span>표지 변경</span>
          <input type="file" accept="image/*" data-cover="${b.id}" style="display:none;" />
        </label>
        <a class="btn ghost small" href="./book.html?id=${b.id}">열기</a>
        <button class="btn danger small" data-del="${b.id}">삭제</button>
      </div>
    </div>
  `).join("");
  [...host.querySelectorAll("[data-status]")].forEach(sel => {
    sel.onchange = () => updateBook(sel.dataset.status, { status: sel.value });
  });
  [...host.querySelectorAll("[data-del]")].forEach(btn => {
    btn.onclick = () => { if (confirm("이 책과 모든 데이터 열람 설정을 삭제하시겠습니까?")) deleteBook(btn.dataset.del); };
  });
  [...host.querySelectorAll("[data-cover]")].forEach(input => {
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      const bookId = input.dataset.cover;
      const span = input.closest("label").querySelector("span");
      const originalText = span.textContent;
      span.textContent = "업로드 중…";
      try {
        const coverUrl = await uploadBookCover(bookId, file);
        await updateBook(bookId, { coverUrl });
      } catch (err) {
        alert("표지 업로드 중 오류가 발생했습니다: " + (err.message || err));
      } finally {
        span.textContent = originalText;
      }
    };
  });
}

function renderAccessBookSelect() {
  const sel = document.getElementById("access-book-select");
  const prev = selectedBookId;
  sel.innerHTML = books.map(b => `<option value="${b.id}">${escapeHtml(b.title)}</option>`).join("");
  if (books.length) {
    selectedBookId = prev && books.some(b => b.id === prev) ? prev : books[0].id;
    sel.value = selectedBookId;
    renderAccessGrid();
  } else {
    document.getElementById("access-grid").innerHTML = `<p class="hint">먼저 책을 추가해주세요.</p>`;
  }
}

async function renderAccessGrid() {
  if (!selectedBookId) return;
  const grid = document.getElementById("access-grid");
  grid.innerHTML = `<p class="hint">불러오는 중…</p>`;
  const grantedUids = new Set(await listBookMembers(selectedBookId));
  if (!users.length) { grid.innerHTML = `<p class="hint">가입한 멤버가 없습니다.</p>`; return; }
  grid.innerHTML = users.map(u => `
    <label class="access-chip ${grantedUids.has(u.uid) ? "granted" : ""}" data-uid="${u.uid}">
      <input type="checkbox" ${grantedUids.has(u.uid) ? "checked" : ""} ${isStaff(u) ? "disabled" : ""} />
      <span>${escapeHtml(u.nickname)}${isStaff(u) ? " (운영진)" : ""}</span>
    </label>
  `).join("");
  [...grid.querySelectorAll(".access-chip")].forEach(chip => {
    const input = chip.querySelector("input");
    if (input.disabled) return;
    chip.addEventListener("click", async (e) => {
      e.preventDefault();
      const uid = chip.dataset.uid;
      const nowChecked = !input.checked;
      if (nowChecked) await grantBookAccess(selectedBookId, uid);
      else await revokeBookAccess(selectedBookId, uid);
      input.checked = nowChecked;
      chip.classList.toggle("granted", nowChecked);
    });
  });
}

function renderUserList() {
  const host = document.getElementById("user-list");
  if (!users.length) { host.innerHTML = `<p class="hint">가입한 멤버가 없습니다.</p>`; return; }
  const amAdmin = isAdmin(currentProfile);
  host.innerHTML = users.map(u => `
    <div class="list-row" data-uid="${u.uid}">
      <div>
        <div class="name">${escapeHtml(u.nickname)}</div>
        <div class="sub">${escapeHtml(u.email)}</div>
      </div>
      <select class="role-select" data-role="${u.uid}" ${amAdmin ? "" : "disabled"}>
        <option value="member" ${u.role === "member" ? "selected" : ""}>member</option>
        <option value="staff" ${u.role === "staff" ? "selected" : ""}>staff (운영진)</option>
        <option value="admin" ${u.role === "admin" ? "selected" : ""}>admin</option>
      </select>
    </div>
  `).join("");
  if (!amAdmin) return;
  [...host.querySelectorAll("[data-role]")].forEach(sel => {
    sel.onchange = async () => {
      await setUserRole(sel.dataset.role, sel.value);
      users = await listUsers();
    };
  });
}
