import { mountHeader, onReady, isAdmin } from "./common.js";
import { createBook, addProgressRow, addRelayRow } from "./data.js";

mountHeader("portal");

onReady((user, profile) => {
  const gate = document.getElementById("gate");
  const action = document.getElementById("action");
  if (!user) { gate.innerHTML = `<div class="lock-screen"><h2>🔒 로그인이 필요합니다</h2></div>`; action.style.display = "none"; return; }
  if (!isAdmin(profile)) { gate.innerHTML = `<div class="lock-screen"><h2>🔒 어드민만 사용할 수 있습니다</h2></div>`; action.style.display = "none"; return; }
  gate.innerHTML = "";
  action.style.display = "block";
});

const PROGRESS = [
  { period: "10월 1일(목) ~ 10월 7일(수)", pages: "~138p", toc: "PART 1~2 (1장 ~ 7장)" },
  { period: "10월 8일(목) ~ 10월 14일(수)", pages: "p139~p.228", toc: "PART 3 (8장 ~ 11장)" },
  { period: "10월 15일(목) ~ 10월 21일(수)", pages: "p229~p.350", toc: "PART 4 (12~14장) + PART 5 (15~16장)" },
  { period: "10월 22일(목) ~ 10월 24일(토)", pages: "p.351 ~ 끝", toc: "PART 5 (17~18장) + 에필로그" },
  { period: "2026.10.24(토) 오후 6:00", pages: "서평인증 제출", toc: "서평인증 제출 마감" },
  { period: "2026.10.25(일) 오후 9:00", pages: "줌 모임 참석", toc: "줌 모임 참석 (링크 별도 안내 예정)" },
];

const RELAY = [
  ["2026.10.1", "목", "슈페로"], ["2026.10.2", "금", "글앤리치"], ["2026.10.3", "토", "육달선생"],
  ["2026.10.4", "일", "원씽고, 아키빌더"], ["2026.10.5", "월", "로보트황"], ["2026.10.6", "화", "부지모"],
  ["2026.10.7", "수", "에디"], ["2026.10.8", "목", "올포"], ["2026.10.9", "금", "글앤리치, 아키빌더"],
  ["2026.10.10", "토", "육달선생"], ["2026.10.11", "일", "원씽고"], ["2026.10.12", "월", "로보트황"],
  ["2026.10.13", "화", "부지모"], ["2026.10.14", "수", "에디"], ["2026.10.15", "목", "올포"],
  ["2026.10.16", "금", "글앤리치, 아키빌더"], ["2026.10.17", "토", "육달선생"], ["2026.10.18", "일", "원씽고"],
  ["2026.10.19", "월", "로보트황"], ["2026.10.20", "화", "부지모"], ["2026.10.21", "수", "에디"],
  ["2026.10.22", "목", "올포"], ["2026.10.23", "금", "슈페로"], ["2026.10.24", "토", "서평제출일"],
];

document.getElementById("seed-btn")?.addEventListener("click", async () => {
  const resultEl = document.getElementById("seed-result");
  resultEl.textContent = "생성 중…";
  try {
    const bookId = await createBook({
      title: "부의 갈림길",
      author: "",
      month: "2026.10",
      status: "ongoing",
      challenge: true,
    });
    for (const row of PROGRESS) await addProgressRow(bookId, row);
    for (const [date, weekday, assignee] of RELAY) {
      await addRelayRow(bookId, { date, weekday, assignee, quote: "", feeling: "", done: false });
    }
    resultEl.innerHTML = `완료! <a href="./book.html?id=${bookId}">부의 갈림길 책 페이지로 이동</a>`;
  } catch (e) {
    resultEl.textContent = "오류: " + (e.message || e);
    console.error(e);
  }
});
