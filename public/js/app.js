/**
 * app.js — 캘린더 SPA 진입점
 *
 * 비동기 I/O 흐름:
 * 1. 앱 로드 → 토큰 갱신 시도 (비동기)
 * 2. 인증 성공 → 일정 로드 (비동기)
 * 3. 일정 CRUD 모두 async/await + 낙관적 UI 업데이트
 */

import { authApi, scheduleApi, apiFetch, getAccessToken } from './api.js';
import { Calendar } from './calendar.js';
import { ScheduleModal, showConfirm } from './modal.js';
import { toast } from './toast.js';

// ── 전역 상태 ───────────────────────────────────────────

let currentUser      = null;
let allSchedules     = [];   // 전체 캐시
let selectedDate     = null;
let calendar         = null;
let modal            = null;
// [Fix #6] 삭제 중인 ID 추적 — 더블클릭 Race Condition 방어
const _deletingIds   = new Set();

// ── DOM 준비 후 진입 ────────────────────────────────────

// [Fix #3] initApp()의 Promise 에러를 반드시 catch
document.addEventListener('DOMContentLoaded', () => {
  initApp().catch(err => {
    console.error('[앱 초기화 오류]', err);
    document.body.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#f87171;font-size:1rem">앱 로드 중 오류가 발생했습니다. 새로고침 해주세요.</div>`;
  });
});

async function initApp() {
  // 기존 세션 복원 시도 (비동기 I/O)
  const session = await authApi.refresh();

  if (!session) {
    window.location.href = '/';
    return;
  }

  currentUser = session.user;
  renderUser();
  setupLogout();
  setupModal();
  setupCalendar();

  // 일정 + 통계 비동기 병렬 로드
  await Promise.all([loadSchedules(), loadStats()]);

  // 오늘 날짜 자동 선택
  const today = new Date();
  const todayStr = dateStr(today);
  selectedDate = todayStr;
  renderSidePanel(todayStr);

  // 검색 입력 이벤트 (300ms 디바운스)
  setupSearch();
}

// ── 사용자 정보 표시 ─────────────────────────────────────

function renderUser() {
  document.getElementById('nav-username').textContent = currentUser.username;
}

// ── 로그아웃 ─────────────────────────────────────────────

function setupLogout() {
  document.getElementById('btn-logout').addEventListener('click', async () => {
    await authApi.logout();
    window.location.href = '/';
  });
}

// ── 모달 초기화 ──────────────────────────────────────────

function setupModal() {
  const overlayEl = document.getElementById('modal-overlay');
  modal = new ScheduleModal(overlayEl, { onSave: handleSave });

  // 사이드 패널 "추가" 버튼
  document.getElementById('btn-add-schedule').addEventListener('click', () => {
    modal.open(selectedDate);
  });
}

// ── 캘린더 초기화 ────────────────────────────────────────

function setupCalendar() {
  const calEl = document.getElementById('calendar-section');
  calendar = new Calendar(calEl, {
    onDaySelect: (dateStr, schedules) => {
      selectedDate = dateStr;
      renderSidePanel(dateStr);
    },
  });
}

// ── 일정 로드 (비동기 I/O) ───────────────────────────────

async function loadSchedules() {
  try {
    allSchedules = await scheduleApi.getAll();
    calendar.setSchedules(allSchedules);
    if (selectedDate) renderSidePanel(selectedDate);
  } catch (err) {
    toast.error('일정을 불러오지 못했습니다: ' + err.message);
  }
}

// ── 통계 로드 ─────────────────────────────────────────────

async function loadStats() {
  try {
    const stats = await apiFetch('/api/schedules/stats');
    document.getElementById('stat-total').textContent    = stats.total;
    document.getElementById('stat-month').textContent   = stats.thisMonth;
    document.getElementById('stat-upcoming').textContent = stats.upcoming;
  } catch {
    // 통계 실패는 조용히 무시 (핵심 기능 아님)
  }
}

// ── 검색 (디바운스) ───────────────────────────────────────

let _searchTimer = null;

function setupSearch() {
  const input = document.getElementById('search-input');
  if (!input) return;

  input.addEventListener('input', () => {
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(async () => {
      const q = input.value.trim();
      if (!q) {
        // 검색어 없으면 전체 복원
        renderSidePanel(selectedDate);
        calendar.setSchedules(allSchedules);
        return;
      }
      try {
        const results = await scheduleApi.search(q);
        // 검색 결과를 캘린더와 사이드 패널에 반영
        renderSearchResults(results, q);
      } catch (err) {
        toast.error('검색 실패: ' + err.message);
      }
    }, 300);
  });
}

function renderSearchResults(results, query) {
  const listEl  = document.getElementById('schedule-list');
  const dateEl  = document.getElementById('side-date');
  dateEl.textContent = `"${query}" 검색 결과 ${results.length}건`;

  if (results.length === 0) {
    listEl.innerHTML = `
      <div class="no-schedule">
        <span class="icon">🔍</span>
        검색 결과가 없습니다
      </div>
    `;
    return;
  }

  listEl.innerHTML = '';
  results.forEach(s => listEl.appendChild(buildScheduleCard(s)));
}

// ── 사이드 패널 렌더링 ───────────────────────────────────

function renderSidePanel(dateStr) {
  const dateEl  = document.getElementById('side-date');
  const listEl  = document.getElementById('schedule-list');

  const [y, m, d] = dateStr.split('-');
  dateEl.textContent = `${parseInt(y)}년 ${parseInt(m)}월 ${parseInt(d)}일`;

  const daySchedules = allSchedules
    .filter(s => s.date === dateStr)
    .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));

  if (daySchedules.length === 0) {
    listEl.innerHTML = `
      <div class="no-schedule">
        <span class="icon">📭</span>
        이 날의 일정이 없습니다
      </div>
    `;
    return;
  }

  listEl.innerHTML = '';
  daySchedules.forEach(s => {
    const card = buildScheduleCard(s);
    listEl.appendChild(card);
  });
}

function buildScheduleCard(s) {
  const card = document.createElement('div');
  card.className = 'schedule-card';
  card.dataset.id = s.id;

  const timeStr = formatTime(s.start_time, s.end_time);

  card.innerHTML = `
    <div class="schedule-color-bar" style="background:${s.color}"></div>
    <div class="schedule-info">
      <div class="schedule-title">${escHtml(s.title)}</div>
      ${timeStr ? `<div class="schedule-time">⏰ ${timeStr}</div>` : ''}
      ${s.description ? `<div class="schedule-desc">${escHtml(s.description)}</div>` : ''}
    </div>
    <div class="schedule-actions">
      <button class="btn-icon btn-edit" title="수정">✏️</button>
      <button class="btn-icon btn-delete" title="삭제">🗑️</button>
    </div>
  `;

  card.querySelector('.btn-edit').addEventListener('click', e => {
    e.stopPropagation();
    modal.open(s.date, s);
  });

  card.querySelector('.btn-delete').addEventListener('click', async e => {
    e.stopPropagation();
    await handleDelete(s);
  });

  return card;
}

// ── 일정 저장 (생성/수정) ────────────────────────────────

async function handleSave(payload, editId) {
  try {
    if (editId) {
      // 수정 (트랜잭션 + 락 → 서버)
      const updated = await scheduleApi.update(editId, payload);
      const idx = allSchedules.findIndex(s => s.id === editId);
      if (idx !== -1) allSchedules[idx] = updated;
      toast.success('일정이 수정되었습니다.');
    } else {
      // 생성 (트랜잭션 → 서버)
      const created = await scheduleApi.create(payload);
      allSchedules.push(created);
      toast.success('일정이 추가되었습니다.');
    }

    // 캘린더 및 사이드 패널 업데이트
    calendar.setSchedules(allSchedules);
    renderSidePanel(payload.date);

    // 저장한 날짜로 이동
    selectedDate = payload.date;
  } catch (err) {
    toast.error(err.message);
    throw err; // 모달 닫힘 방지
  }
}

// ── 일정 삭제 ────────────────────────────────────────────

async function handleDelete(schedule) {
  // [Fix #6] 동일 ID가 이미 삭제 중이면 무시 (더블클릭/Race Condition 방어)
  if (_deletingIds.has(schedule.id)) return;
  _deletingIds.add(schedule.id);

  try {
    const confirmed = await showConfirm(
      `"${schedule.title}" 일정을 삭제하시겠습니까?`,
      '삭제된 일정은 복구할 수 없습니다.'
    );
    if (!confirmed) return;

    await scheduleApi.delete(schedule.id);
    allSchedules = allSchedules.filter(s => s.id !== schedule.id);
    calendar.setSchedules(allSchedules);
    renderSidePanel(schedule.date);
    toast.success('일정이 삭제되었습니다.');
  } catch (err) {
    toast.error(err.message);
  } finally {
    _deletingIds.delete(schedule.id);
  }
}

// ── 유틸 ─────────────────────────────────────────────────

function dateStr(date) {
  const y  = date.getFullYear();
  const m  = String(date.getMonth() + 1).padStart(2, '0');
  const d  = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatTime(start, end) {
  if (!start && !end) return '';
  if (start && end)   return `${start} ~ ${end}`;
  if (start)          return `${start}~`;
  return `~${end}`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
