import { mountHeader, onReady, isStaff, escapeHtml, openAuthModal } from "./common.js";
import {
  getBook, hasBookAccess, listBookMembers, listUsers,
  watchProgress, addProgressRow, updateProgressRow, deleteProgressRow,
  watchRelay, addRelayRow, updateRelayRow, deleteRelayRow,
  watchReviews, setReview,
  watchStaffArchive, addStaffArchiveEntry, deleteStaffArchiveEntry,
  watchBookMaterials, addBookMaterial, deleteBookMaterial
} from "./data.js";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB (storage.rules 와 동일하게 유지)

mountHeader("book");

const params = new URLSearchParams(location.search);
const bookId = params.get("id");
let currentUser = null, currentProfile = null, book = null, allowed = false;
let usersById = {};

if (!bookId) {
  document.getElementById("book-title").textContent = "책을 찾을 수 없습니다";
  document.getElementById("access-gate").innerHTML = `<div class="lock-screen"><p>잘못된 주소입니다. <a href="./index.html">포털로 돌아가기</a></p></div>`;
} else {
  boot();
}

async function boot() {
  book = await getBook(bookId);
  if (!book) {
    document.getElementById("book-title").textContent = "책을 찾을 수 없습니다";
    document.getElementById("access-gate").innerHTML = `<div class="lock-screen"><p>삭제되었거나 존재하지 않는 책입니다. <a href="./index.html">포털로 돌아가기</a></p></div>`;
    return;
  }
  document.getElementById("book-title").textContent = book.title;
  document.getElementById("book-sub").textContent = [book.author, book.month].filter(Boolean).join(" · ");

  onReady(async (user, profile) => {
    currentUser = user; currentProfile = profile;
    await evaluateAccess();
  });
}

async function evaluateAccess() {
  const gate = document.getElementById("access-gate");
  const content = document.getElementById("book-content");
  if (!currentUser) {
    allowed = false;
    gate.innerHTML = `
      <div class="lock-screen">
        <h2>🔒 로그인이 필요합니다</h2>
        <p>"${escapeHtml(book.title)}" 페이지를 보려면 로그인하거나 회원가입해주세요.</p>
        <button class="btn primary" id="gate-login-btn" style="margin-top:10px;">로그인 / 가입</button>
      </div>
    `;
    document.getElementById("gate-login-btn").onclick = () => openAuthModal();
    content.style.display = "none";
    return;
  }
  allowed = isStaff(currentProfile) || await hasBookAccess(bookId, currentUser.uid);
  if (!allowed) {
    gate.innerHTML = `<div class="lock-screen"><h2>🔒 접근 권한이 없습니다</h2><p>이 책의 열람 권한이 없습니다. 어드민에게 문의해주세요.</p></div>`;
    content.style.display = "none";
    return;
  }
  gate.innerHTML = "";
  content.style.display = "block";
  if (isStaff(currentProfile)) document.getElementById("staff-tab-btn").style.display = "";
  initTabs();
  initProgress();
  initRelay();
  initReview();
  initMaterials();
  if (isStaff(currentProfile)) initStaffArchive();
}

function initTabs() {
  const btns = [...document.querySelectorAll(".tab-btn")];
  btns.forEach(btn => btn.onclick = () => {
    btns.forEach(b => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    document.getElementById("panel-" + btn.dataset.tab).classList.add("active");
  });
}

/* ---------------- 진도표 ---------------- */
function initProgress() {
  const staff = isStaff(currentProfile);
  document.getElementById("progress-th-del").textContent = "";
  watchProgress(bookId, (rows) => {
    const tbody = document.getElementById("progress-rows");
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="mini-tag">아직 등록된 진도표가 없습니다.</td></tr>`;
    } else {
      tbody.innerHTML = rows.map(r => `
        <tr data-id="${r.id}">
          <td>${editableCell(staff, r.period, "period")}</td>
          <td>${editableCell(staff, r.pages, "pages")}</td>
          <td>${editableCell(staff, r.toc, "toc")}</td>
          <td>${staff ? `<button class="btn danger small" data-del="${r.id}">삭제</button>` : ""}</td>
        </tr>
      `).join("");
    }
    if (staff) wireEditable(tbody, (id, field, value) => updateProgressRow(bookId, id, { [field]: value }));
    wireDelete(tbody, (id) => deleteProgressRow(bookId, id));
  });

  const addWrap = document.getElementById("progress-add-wrap");
  addWrap.innerHTML = staff ? `<button class="btn ghost small" id="add-progress-btn">+ 주차 추가</button>` : "";
  if (staff) document.getElementById("add-progress-btn").onclick = () =>
    addProgressRow(bookId, { period: "새 기간", pages: "", toc: "" });
}

/* ---------------- 릴레이인증 ---------------- */
function initRelay() {
  const staff = isStaff(currentProfile);
  document.getElementById("relay-th-del").textContent = "";
  watchRelay(bookId, (rows) => {
    const tbody = document.getElementById("relay-rows");
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="mini-tag">아직 등록된 릴레이 일정이 없습니다.</td></tr>`;
    } else {
      tbody.innerHTML = rows.map(r => `
        <tr data-id="${r.id}">
          <td>${editableCell(staff, r.date, "date")}</td>
          <td>${editableCell(staff, r.weekday, "weekday")}</td>
          <td>${editableCell(staff, r.assignee, "assignee")}</td>
          <td><textarea data-id="${r.id}" data-field="quote" rows="2">${escapeHtml(r.quote || "")}</textarea></td>
          <td><textarea data-id="${r.id}" data-field="feeling" rows="2">${escapeHtml(r.feeling || "")}</textarea></td>
          <td style="text-align:center;">
            <label class="check-pill">
              <input type="checkbox" data-id="${r.id}" data-check="done" ${r.done ? "checked" : ""}/>
            </label>
          </td>
          <td>${staff ? `<button class="btn danger small" data-del="${r.id}">삭제</button>` : ""}</td>
        </tr>
      `).join("");
    }
    // 글귀/느낀점/체크는 모두(열람 권한자) 수정 가능
    [...tbody.querySelectorAll("textarea[data-field]")].forEach(el => {
      el.addEventListener("change", () => updateRelayRow(bookId, el.dataset.id, { [el.dataset.field]: el.value }));
    });
    [...tbody.querySelectorAll("input[data-check]")].forEach(el => {
      el.addEventListener("change", () => updateRelayRow(bookId, el.dataset.id, { done: el.checked }));
    });
    if (staff) wireEditable(tbody, (id, field, value) => updateRelayRow(bookId, id, { [field]: value }));
    wireDelete(tbody, (id) => deleteRelayRow(bookId, id));
  });

  const addWrap = document.getElementById("relay-add-wrap");
  addWrap.innerHTML = staff ? `<button class="btn ghost small" id="add-relay-btn">+ 날짜 추가</button>` : "";
  if (staff) document.getElementById("add-relay-btn").onclick = () =>
    addRelayRow(bookId, { date: "", weekday: "", assignee: "", quote: "", feeling: "", done: false });
}

/* ---------------- 서평인증 ---------------- */
async function initReview() {
  const members = await listBookMembers(bookId);
  const users = await listUsers();
  usersById = Object.fromEntries(users.map(u => [u.uid, u]));
  const staff = isStaff(currentProfile);

  watchReviews(bookId, (reviewDocs) => {
    const reviewsByUid = Object.fromEntries(reviewDocs.map(r => [r.id, r]));
    const tbody = document.getElementById("review-rows");
    if (!members.length) {
      tbody.innerHTML = `<tr><td colspan="3" class="mini-tag">이 책에 열람 권한이 부여된 멤버가 없습니다.</td></tr>`;
      return;
    }
    tbody.innerHTML = members.map(uid => {
      const u = usersById[uid];
      const nickname = u?.nickname || "(알 수 없음)";
      const review = reviewsByUid[uid] || {};
      const canEdit = staff || uid === currentUser.uid;
      const link = review.link || "";
      return `
        <tr data-uid="${uid}">
          <td>${escapeHtml(nickname)}</td>
          <td>${canEdit
            ? `<input type="url" data-uid="${uid}" placeholder="https://..." value="${escapeHtml(link)}" />`
            : (link ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener">${escapeHtml(link)}</a>` : `<span class="mini-tag">미제출</span>`)
          }</td>
          <td>${link ? `<span class="pill-done">제출완료</span>` : `<span class="pill-pending">미제출</span>`}</td>
        </tr>
      `;
    }).join("");

    [...tbody.querySelectorAll("input[type=url]")].forEach(el => {
      el.addEventListener("change", () => setReview(bookId, el.dataset.uid, { link: el.value, updatedAt: Date.now() }));
    });
  });
}

/* ---------------- 자료 게시판 ---------------- */
function initMaterials() {
  const staff = isStaff(currentProfile);
  document.getElementById("materials-upload-card").style.display = staff ? "" : "none";

  watchBookMaterials(bookId, (items) => {
    const host = document.getElementById("materials-list");
    if (!items.length) {
      host.innerHTML = `<p class="hint">아직 등록된 자료가 없습니다.</p>`;
      return;
    }
    host.innerHTML = items.map(it => `
      <div class="list-row" data-id="${it.id}">
        <div>
          <div class="name"><a href="${escapeHtml(it.fileUrl)}" target="_blank" rel="noopener">${escapeHtml(it.title)}</a></div>
          <div class="sub">${escapeHtml(it.fileName || "")}${it.note ? " · " + escapeHtml(it.note) : ""}</div>
        </div>
        ${staff ? `<button class="btn danger small" data-del="${it.id}" data-path="${it.filePath || ""}">삭제</button>` : ""}
      </div>
    `).join("");
    if (staff) {
      [...host.querySelectorAll("[data-del]")].forEach(btn => {
        btn.onclick = () => {
          if (confirm("정말 삭제하시겠습니까?")) deleteBookMaterial(bookId, btn.dataset.id, btn.dataset.path);
        };
      });
    }
  });

  if (!staff) return;
  document.getElementById("materials-form").onsubmit = async (e) => {
    e.preventDefault();
    const title = document.getElementById("material-title").value.trim();
    const file = document.getElementById("material-file").files[0];
    const note = document.getElementById("material-note").value.trim();
    if (!title || !file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      alert("파일은 10MB 이하만 업로드할 수 있습니다.");
      return;
    }
    const submitBtn = e.target.querySelector("button[type=submit]");
    submitBtn.disabled = true;
    submitBtn.textContent = "업로드 중…";
    try {
      await addBookMaterial(bookId, { file, title, note, uploadedBy: currentUser.uid });
      e.target.reset();
    } catch (err) {
      alert("자료 업로드 중 오류가 발생했습니다: " + (err.message || err));
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "올리기";
    }
  };
}

/* ---------------- 운영진 전용 자료실 ---------------- */
function initStaffArchive() {
  watchStaffArchive(bookId, (items) => {
    const grid = document.getElementById("archive-grid");
    if (!items.length) {
      grid.innerHTML = `<div class="empty">아직 등록된 인증 기록이 없습니다.</div>`;
      return;
    }
    grid.innerHTML = items.map(it => `
      <div class="archive-item">
        ${it.photoUrl ? `<img src="${it.photoUrl}" alt="">` : ""}
        <div class="meta">
          <div class="who">${escapeHtml(it.memberName)}</div>
          ${it.note ? `<div class="note">${escapeHtml(it.note)}</div>` : ""}
          <button class="btn danger small del" data-id="${it.id}" data-path="${it.photoPath || ""}">삭제</button>
        </div>
      </div>
    `).join("");
    [...grid.querySelectorAll(".del")].forEach(btn => {
      btn.onclick = () => deleteStaffArchiveEntry(bookId, btn.dataset.id, btn.dataset.path);
    });
  });

  document.getElementById("archive-form").onsubmit = async (e) => {
    e.preventDefault();
    const name = document.getElementById("archive-name").value.trim();
    const file = document.getElementById("archive-file").files[0];
    const note = document.getElementById("archive-note").value.trim();
    if (!name) return;
    if (file && file.size > MAX_UPLOAD_BYTES) {
      alert("사진은 10MB 이하만 업로드할 수 있습니다.");
      return;
    }
    await addStaffArchiveEntry(bookId, { file, memberName: name, note, uploadedBy: currentUser.uid });
    e.target.reset();
  };
}

/* ---------------- 공통 편집 유틸 ---------------- */
function editableCell(editable, value, field) {
  if (!editable) return escapeHtml(value || "");
  return `<input type="text" data-field="${field}" value="${escapeHtml(value || "")}" />`;
}
function wireEditable(root, onSave) {
  [...root.querySelectorAll("input[data-field]")].forEach(el => {
    el.addEventListener("change", () => {
      const tr = el.closest("tr");
      onSave(tr.dataset.id, el.dataset.field, el.value);
    });
  });
}
function wireDelete(root, onDelete) {
  [...root.querySelectorAll("[data-del]")].forEach(btn => {
    btn.addEventListener("click", () => {
      if (confirm("정말 삭제하시겠습니까?")) onDelete(btn.dataset.del);
    });
  });
}
