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
let relayRowsCache = [];

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
async function initRelay() {
  const staff = isStaff(currentProfile);
  document.getElementById("relay-th-del").textContent = "";

  // 담당 인증자 지정에 쓸 멤버 목록 (운영진 전용 폼에서만 필요)
  let memberOptions = [];
  if (staff) {
    const memberUids = await listBookMembers(bookId);
    const users = await listUsers();
    const usersByUid2 = Object.fromEntries(users.map(u => [u.uid, u]));
    memberOptions = memberUids.map(uid => ({ uid, nickname: usersByUid2[uid]?.nickname || "(알 수 없음)" }));
  }

  document.getElementById("relay-pdf-btn").onclick = () => exportRelayPdf(relayRowsCache);

  watchRelay(bookId, (rows) => {
    relayRowsCache = rows;
    const tbody = document.getElementById("relay-rows");
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="mini-tag">아직 등록된 릴레이 일정이 없습니다.</td></tr>`;
    } else {
      tbody.innerHTML = rows.map(r => {
        const canEdit = staff || isMyRelayRow(r);
        const mine = !staff && isMyRelayRow(r);
        const weekdayClass = r.weekday === "토" ? "weekday-sat" : (r.weekday === "일" ? "weekday-sun" : "");
        const rowClass = [r.done ? "is-done" : "", mine ? "is-mine" : ""].filter(Boolean).join(" ");
        return `
        <tr data-id="${r.id}" class="${rowClass}">
          <td>${escapeHtml(r.date || "")}</td>
          <td class="${weekdayClass}">${escapeHtml(r.weekday || "")}</td>
          <td>
            <div class="assignee-cell">
              <span>${escapeHtml(r.assignee || "")}</span>
              ${staff ? `<button class="btn ghost small" data-reassign="${r.id}">담당자 수정</button>` : ""}
            </div>
          </td>
          <td>${canEdit
            ? `<textarea data-id="${r.id}" data-field="quote" rows="2">${escapeHtml(r.quote || "")}</textarea>`
            : `<div class="readonly-text">${r.quote ? escapeHtml(r.quote) : `<span class="mini-tag">—</span>`}</div>`}</td>
          <td>${canEdit
            ? `<textarea data-id="${r.id}" data-field="feeling" rows="2">${escapeHtml(r.feeling || "")}</textarea>`
            : `<div class="readonly-text">${r.feeling ? escapeHtml(r.feeling) : `<span class="mini-tag">—</span>`}</div>`}</td>
          <td style="text-align:center;">
            ${canEdit
              ? `<label class="check-pill"><input type="checkbox" data-id="${r.id}" data-check="done" ${r.done ? "checked" : ""}/></label>`
              : (r.done ? `<span class="pill-done">완료</span>` : `<span class="pill-pending">대기</span>`)}
          </td>
          <td>${staff ? `<button class="btn danger small" data-del="${r.id}">삭제</button>` : ""}</td>
        </tr>
      `;
      }).join("");
    }
    [...tbody.querySelectorAll("textarea[data-field]")].forEach(el => {
      el.addEventListener("change", () => updateRelayRow(bookId, el.dataset.id, { [el.dataset.field]: el.value }));
    });
    [...tbody.querySelectorAll("input[data-check]")].forEach(el => {
      el.addEventListener("change", () => updateRelayRow(bookId, el.dataset.id, { done: el.checked }));
    });
    if (staff) {
      [...tbody.querySelectorAll("[data-reassign]")].forEach(btn => {
        btn.onclick = () => {
          const row = rows.find(r => r.id === btn.dataset.reassign);
          if (row) openReassignModal(row, memberOptions);
        };
      });
    }
    wireDelete(tbody, (id) => deleteRelayRow(bookId, id));
  });

  const addWrap = document.getElementById("relay-add-wrap");
  if (!staff) { addWrap.innerHTML = ""; return; }
  addWrap.innerHTML = `
    <div class="card" id="relay-add-card">
      <h3>릴레이 일정 추가</h3>
      <p class="hint">날짜를 고르면 요일은 자동으로 계산됩니다. 담당 인증자를 선택해주세요(복수 선택 가능). 등록 후 날짜·요일·인증자는 "담당자 수정"으로만 바꿀 수 있습니다.</p>
      <form id="relay-add-form">
        <div class="field" style="max-width:220px;"><label>날짜</label><input type="date" id="relay-add-date" required /></div>
        <div class="field">
          <label>담당 인증자</label>
          <div class="access-grid" id="relay-add-assignees">
            ${memberOptions.map(m => `
              <label class="access-chip"><input type="checkbox" value="${m.uid}" data-nickname="${escapeHtml(m.nickname)}" /> ${escapeHtml(m.nickname)}</label>
            `).join("") || `<span class="mini-tag">이 책에 권한이 부여된 멤버가 없습니다. 먼저 admin.html에서 열람 권한을 부여해주세요.</span>`}
          </div>
        </div>
        <button class="btn primary small" type="submit" style="margin-top:12px;">+ 추가</button>
      </form>
    </div>
  `;
  [...addWrap.querySelectorAll(".access-chip")].forEach(chip => {
    const input = chip.querySelector("input");
    input.addEventListener("change", () => chip.classList.toggle("granted", input.checked));
  });
  const addForm = document.getElementById("relay-add-form");
  if (addForm) {
    addForm.onsubmit = async (e) => {
      e.preventDefault();
      const dateVal = document.getElementById("relay-add-date").value;
      if (!dateVal) return;
      const checked = [...addWrap.querySelectorAll("#relay-add-assignees input:checked")];
      if (!checked.length) { alert("담당 인증자를 한 명 이상 선택해주세요."); return; }
      const assigneeUids = checked.map(c => c.value);
      const assignee = checked.map(c => c.dataset.nickname).join(", ");
      const weekday = weekdayKo(dateVal);
      await addRelayRow(bookId, {
        date: formatDateDot(dateVal), weekday, assignee, assigneeUids, quote: "", feeling: "", done: false
      });
      addForm.reset();
      [...addWrap.querySelectorAll(".access-chip")].forEach(c => c.classList.remove("granted"));
    };
  }
}

function isMyRelayRow(r) {
  if (!currentUser) return false;
  if (Array.isArray(r.assigneeUids) && r.assigneeUids.length) {
    return r.assigneeUids.includes(currentUser.uid);
  }
  // 담당자 UID가 없는 예전 데이터(닉네임 텍스트만 저장된 경우) 대비
  const nickname = currentProfile?.nickname;
  if (!nickname || !r.assignee) return false;
  return r.assignee.split(/[,、·]/).map(s => s.trim()).includes(nickname);
}

function weekdayKo(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return "";
  return ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
}

function formatDateDot(dateStr) {
  const [y, m, d] = String(dateStr).split("-");
  if (!y || !m || !d) return dateStr;
  return `${y}.${Number(m)}.${Number(d)}`;
}

function openReassignModal(row, memberOptions) {
  const currentUids = new Set(Array.isArray(row.assigneeUids) ? row.assigneeUids : []);
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal">
      <button class="close-x" id="reassign-close">✕</button>
      <h3>담당 인증자 수정</h3>
      <p class="sub">${escapeHtml(row.date || "")}${row.weekday ? ` (${escapeHtml(row.weekday)})` : ""}</p>
      <div class="access-grid">
        ${memberOptions.map(m => `
          <label class="access-chip ${currentUids.has(m.uid) ? "granted" : ""}">
            <input type="checkbox" value="${m.uid}" data-nickname="${escapeHtml(m.nickname)}" ${currentUids.has(m.uid) ? "checked" : ""}/> ${escapeHtml(m.nickname)}
          </label>
        `).join("") || `<span class="mini-tag">이 책에 권한이 부여된 멤버가 없습니다.</span>`}
      </div>
      <button class="btn primary" id="reassign-save" style="width:100%;margin-top:16px;">저장</button>
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  document.getElementById("reassign-close").onclick = close;
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  [...backdrop.querySelectorAll(".access-chip")].forEach(chip => {
    const input = chip.querySelector("input");
    input.addEventListener("change", () => chip.classList.toggle("granted", input.checked));
  });
  document.getElementById("reassign-save").onclick = async () => {
    const checked = [...backdrop.querySelectorAll("input:checked")];
    const assigneeUids = checked.map(c => c.value);
    const assignee = checked.map(c => c.dataset.nickname).join(", ");
    await updateRelayRow(bookId, row.id, { assigneeUids, assignee });
    close();
  };
}

function exportRelayPdf(rows) {
  if (!rows || !rows.length) { alert("아직 등록된 릴레이 일정이 없습니다."); return; }
  const items = rows.filter(r => r.done);
  const win = window.open("", "_blank");
  if (!win) { alert("팝업이 차단되어 있습니다. 브라우저의 팝업 차단을 해제한 뒤 다시 시도해주세요."); return; }
  const esc = escapeHtml;
  const cards = items.map(r => `
    <div class="cert-card">
      <div class="cert-head">
        <span class="cert-date">${esc(r.date || "")}${r.weekday ? ` (${esc(r.weekday)})` : ""}</span>
        <span class="cert-assignee">${esc(r.assignee || "")}</span>
      </div>
      <div class="cert-row"><span class="cert-label">글귀</span><div class="cert-body">${esc(r.quote || "(작성 없음)")}</div></div>
      <div class="cert-row"><span class="cert-label">느낀점</span><div class="cert-body">${esc(r.feeling || "(작성 없음)")}</div></div>
    </div>
  `).join("");
  win.document.write(`<!doctype html>
<html lang="ko"><head><meta charset="utf-8" />
<title>${esc(book?.title || "")} 릴레이인증 기록</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700;900&display=swap');
  *{box-sizing:border-box;}
  body{font-family:'Noto Sans KR',-apple-system,BlinkMacSystemFont,sans-serif;color:#1a2233;padding:32px;max-width:720px;margin:0 auto;}
  h1{font-size:1.25rem;margin:0 0 4px;}
  p.sub{color:#5b6478;font-size:.85rem;margin:0 0 24px;}
  .cert-card{border:1px solid #e6e2d8;border-radius:10px;padding:16px 18px;margin-bottom:14px;page-break-inside:avoid;}
  .cert-head{display:flex;justify-content:space-between;align-items:baseline;gap:10px;font-weight:800;border-bottom:1px solid #e6e2d8;padding-bottom:8px;margin-bottom:10px;flex-wrap:wrap;}
  .cert-date{color:#1f2a44;}
  .cert-assignee{color:#c99a3e;}
  .cert-row{margin-bottom:10px;}
  .cert-label{display:inline-block;font-size:.72rem;font-weight:700;color:#5b6478;background:#f1efe8;padding:2px 9px;border-radius:999px;}
  .cert-body{font-size:.92rem;line-height:1.65;white-space:pre-wrap;word-break:break-word;margin-top:5px;}
  @media print{ body{padding:0;} }
</style>
</head><body>
  <h1>${esc(book?.title || "")} — 릴레이인증 기록</h1>
  <p class="sub">완료된 인증 ${items.length}건 · 출력일 ${new Date().toLocaleDateString("ko-KR")}</p>
  ${cards || "<p>완료된 인증이 없습니다.</p>"}
</body></html>`);
  win.document.close();
  win.onload = () => { win.focus(); win.print(); };
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
async function initMaterials() {
  const staff = isStaff(currentProfile);
  document.getElementById("materials-upload-card").style.display = staff ? "" : "none";

  const materialUsers = await listUsers();
  const materialUsersById = Object.fromEntries(materialUsers.map(u => [u.uid, u]));

  watchBookMaterials(bookId, (items) => {
    const host = document.getElementById("materials-list");
    if (!items.length) {
      host.innerHTML = `<p class="hint">아직 등록된 자료가 없습니다.</p>`;
      return;
    }
    host.innerHTML = items.map(it => {
      const uploaderName = materialUsersById[it.uploadedBy]?.nickname || "(알 수 없음)";
      const uploadedAt = it.createdAt ? new Date(it.createdAt).toLocaleString("ko-KR", {
        year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
      }) : "";
      return `
      <div class="list-row" data-id="${it.id}">
        <div>
          <div class="name"><a href="${escapeHtml(it.fileUrl)}" target="_blank" rel="noopener">${escapeHtml(it.title)}</a></div>
          <div class="sub">${escapeHtml(it.fileName || "")}${it.note ? " · " + escapeHtml(it.note) : ""}</div>
          <div class="sub">${escapeHtml(uploaderName)}${uploadedAt ? " · " + uploadedAt : ""}</div>
        </div>
        ${staff ? `<button class="btn danger small" data-del="${it.id}" data-path="${it.filePath || ""}">삭제</button>` : ""}
      </div>
    `;
    }).join("");
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
