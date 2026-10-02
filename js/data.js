// Firestore 데이터 접근 헬퍼
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc,
  onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  ref, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { db, storage } from "./common.js";

/* ---------- books ---------- */
export async function listBooks() {
  const snap = await getDocs(query(collection(db, "books"), orderBy("order", "desc")));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
export function watchBooks(cb) {
  return onSnapshot(query(collection(db, "books"), orderBy("order", "desc")),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}
export async function getBook(bookId) {
  const snap = await getDoc(doc(db, "books", bookId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}
export async function createBook(data) {
  const ref2 = doc(collection(db, "books"));
  await setDoc(ref2, { ...data, order: Date.now(), createdAt: Date.now() });
  return ref2.id;
}
export async function updateBook(bookId, data) {
  await updateDoc(doc(db, "books", bookId), data);
}
export async function deleteBook(bookId) {
  await deleteDoc(doc(db, "books", bookId));
}

/* ---------- 책별 열람 권한 (members) ---------- */
export async function listBookMembers(bookId) {
  const snap = await getDocs(collection(db, "books", bookId, "members"));
  return snap.docs.map(d => d.id); // uid 배열
}
export async function grantBookAccess(bookId, uid) {
  await setDoc(doc(db, "books", bookId, "members", uid), { grantedAt: Date.now() });
}
export async function revokeBookAccess(bookId, uid) {
  await deleteDoc(doc(db, "books", bookId, "members", uid));
}
export async function hasBookAccess(bookId, uid) {
  const snap = await getDoc(doc(db, "books", bookId, "members", uid));
  return snap.exists();
}

/* ---------- 전체 사용자 ---------- */
export async function listUsers() {
  const snap = await getDocs(collection(db, "users"));
  return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
}
export async function setUserRole(uid, role) {
  await updateDoc(doc(db, "users", uid), { role });
}

/* ---------- 진도표 ---------- */
export function watchProgress(bookId, cb) {
  return onSnapshot(query(collection(db, "books", bookId, "progress"), orderBy("order", "asc")),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}
export async function addProgressRow(bookId, data) {
  await addDoc(collection(db, "books", bookId, "progress"), { ...data, order: Date.now() });
}
export async function updateProgressRow(bookId, rowId, data) {
  await updateDoc(doc(db, "books", bookId, "progress", rowId), data);
}
export async function deleteProgressRow(bookId, rowId) {
  await deleteDoc(doc(db, "books", bookId, "progress", rowId));
}

/* ---------- 릴레이 인증 ---------- */
export function watchRelay(bookId, cb) {
  return onSnapshot(query(collection(db, "books", bookId, "relay"), orderBy("order", "asc")),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}
export async function addRelayRow(bookId, data) {
  await addDoc(collection(db, "books", bookId, "relay"), { ...data, order: Date.now() });
}
export async function updateRelayRow(bookId, rowId, data) {
  await updateDoc(doc(db, "books", bookId, "relay", rowId), data);
}
export async function deleteRelayRow(bookId, rowId) {
  await deleteDoc(doc(db, "books", bookId, "relay", rowId));
}

/* ---------- 서평 인증 ---------- */
export function watchReviews(bookId, cb) {
  return onSnapshot(collection(db, "books", bookId, "reviews"),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}
export async function setReview(bookId, uid, data) {
  await setDoc(doc(db, "books", bookId, "reviews", uid), data, { merge: true });
}

/* ---------- 운영진 전용 자료실 ---------- */
export function watchStaffArchive(bookId, cb) {
  return onSnapshot(query(collection(db, "books", bookId, "staffArchive"), orderBy("createdAt", "desc")),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}
export async function addStaffArchiveEntry(bookId, { file, memberName, note, uploadedBy }) {
  let photoUrl = "";
  let photoPath = "";
  if (file) {
    photoPath = `staffArchive/${bookId}/${Date.now()}_${file.name}`;
    const sref = ref(storage, photoPath);
    await uploadBytes(sref, file);
    photoUrl = await getDownloadURL(sref);
  }
  await addDoc(collection(db, "books", bookId, "staffArchive"), {
    memberName, note: note || "", photoUrl, photoPath, uploadedBy, createdAt: Date.now()
  });
}
export async function deleteStaffArchiveEntry(bookId, entryId, photoPath) {
  if (photoPath) {
    try { await deleteObject(ref(storage, photoPath)); } catch (e) { /* 이미 없을 수 있음 */ }
  }
  await deleteDoc(doc(db, "books", bookId, "staffArchive", entryId));
}

/* ---------- 책 표지 업로드 ---------- */
export async function uploadBookCover(bookId, file) {
  const path = `covers/${bookId}_${Date.now()}_${file.name}`;
  const sref = ref(storage, path);
  await uploadBytes(sref, file);
  return getDownloadURL(sref);
}
