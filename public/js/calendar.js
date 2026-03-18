/**
 * calendar.js — 월간 캘린더 렌더링 모듈
 */

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export class Calendar {
  constructor(containerEl, { onDaySelect } = {}) {
    this.container   = containerEl;
    this.onDaySelect = onDaySelect || (() => {});
    this.today       = new Date();
    this.year        = this.today.getFullYear();
    this.month       = this.today.getMonth(); // 0-indexed
    this.selectedDate = null;
    this.scheduleMap  = {}; // { 'YYYY-MM-DD': [schedule, ...] }

    this._build();
  }

  // ── 초기 DOM 구성 ─────────────────────────────────────

  _build() {
    this.container.innerHTML = `
      <div class="calendar-header">
        <div class="calendar-title" id="cal-title"></div>
        <div class="calendar-nav">
          <button class="today-btn" id="btn-today">오늘</button>
          <button class="btn-icon" id="btn-prev">&#8249;</button>
          <button class="btn-icon" id="btn-next">&#8250;</button>
        </div>
      </div>

      <div class="calendar-weekdays">
        ${WEEKDAYS.map(d => `<div>${d}</div>`).join('')}
      </div>

      <div class="calendar-grid" id="cal-grid"></div>
    `;

    this.titleEl = this.container.querySelector('#cal-title');
    this.gridEl  = this.container.querySelector('#cal-grid');

    this.container.querySelector('#btn-prev')
      .addEventListener('click', () => this.prevMonth());
    this.container.querySelector('#btn-next')
      .addEventListener('click', () => this.nextMonth());
    this.container.querySelector('#btn-today')
      .addEventListener('click', () => this.goToday());

    this._render();
  }

  // ── 캘린더 렌더링 ─────────────────────────────────────

  _render() {
    const y = this.year;
    const m = this.month;

    // 헤더 제목
    this.titleEl.innerHTML =
      `${y}년 <span>${m + 1}월</span>`;

    // 이번 달 첫날/마지막날
    const firstDay  = new Date(y, m, 1);
    const lastDay   = new Date(y, m + 1, 0);
    const startDow  = firstDay.getDay(); // 0=일
    const totalDays = lastDay.getDate();

    // 이전달 마지막 날
    const prevLast = new Date(y, m, 0).getDate();

    // 그리드 셀 생성 (6주 × 7일 = 42칸)
    const cells = [];

    // 이전달 채우기
    for (let i = startDow - 1; i >= 0; i--) {
      cells.push({ day: prevLast - i, cur: false, date: this._dateStr(y, m - 1, prevLast - i) });
    }
    // 이번달
    for (let d = 1; d <= totalDays; d++) {
      cells.push({ day: d, cur: true, date: this._dateStr(y, m, d) });
    }
    // 다음달 채우기
    let next = 1;
    while (cells.length < 42) {
      cells.push({ day: next, cur: false, date: this._dateStr(y, m + 1, next) });
      next++;
    }

    // DOM 생성
    this.gridEl.innerHTML = '';
    const todayStr = this._todayStr();

    cells.forEach(({ day, cur, date }) => {
      const el = document.createElement('div');
      el.className = 'calendar-day';
      el.dataset.date = date;
      if (!cur) el.classList.add('other-month');
      if (date === todayStr) el.classList.add('today');
      if (date === this.selectedDate) el.classList.add('selected');

      // 날짜 숫자
      const numEl = document.createElement('div');
      numEl.className = 'day-num';
      numEl.textContent = day;
      el.appendChild(numEl);

      // 일정 칩 렌더링
      const schedules = this.scheduleMap[date] || [];
      const maxShow = 3;
      schedules.slice(0, maxShow).forEach(s => {
        const chip = document.createElement('div');
        chip.className = 'event-chip';
        chip.textContent = s.title;
        chip.style.background = s.color + '33';
        chip.style.color       = s.color;
        chip.style.borderLeft  = `3px solid ${s.color}`;
        chip.dataset.id = s.id;
        el.appendChild(chip);
      });
      if (schedules.length > maxShow) {
        const more = document.createElement('div');
        more.className   = 'event-more';
        more.textContent = `+${schedules.length - maxShow}개 더`;
        el.appendChild(more);
      }

      el.addEventListener('click', (e) => {
        // 칩 클릭 시 날짜도 선택
        this._selectDate(date);
      });

      this.gridEl.appendChild(el);
    });
  }

  // ── 날짜 선택 ─────────────────────────────────────────

  _selectDate(dateStr) {
    // 이전 선택 해제
    const prev = this.gridEl.querySelector('.calendar-day.selected');
    if (prev) prev.classList.remove('selected');

    this.selectedDate = dateStr;
    const cur = this.gridEl.querySelector(`[data-date="${dateStr}"]`);
    if (cur) cur.classList.add('selected');

    this.onDaySelect(dateStr, this.scheduleMap[dateStr] || []);
  }

  // ── 일정 데이터 주입 ──────────────────────────────────

  setSchedules(schedules) {
    this.scheduleMap = {};
    schedules.forEach(s => {
      if (!this.scheduleMap[s.date]) this.scheduleMap[s.date] = [];
      this.scheduleMap[s.date].push(s);
    });
    this._render();

    // 선택 날짜 유지
    if (this.selectedDate) {
      const el = this.gridEl.querySelector(`[data-date="${this.selectedDate}"]`);
      if (el) el.classList.add('selected');
    }
  }

  // 특정 날짜의 칩만 다시 그림 (전체 재렌더 없이 빠른 업데이트)
  refreshDay(dateStr) {
    const el = this.gridEl.querySelector(`[data-date="${dateStr}"]`);
    if (!el) return;

    // 기존 칩 제거
    el.querySelectorAll('.event-chip, .event-more').forEach(c => c.remove());

    const schedules = this.scheduleMap[dateStr] || [];
    const maxShow = 3;
    schedules.slice(0, maxShow).forEach(s => {
      const chip = document.createElement('div');
      chip.className = 'event-chip';
      chip.textContent = s.title;
      chip.style.background = s.color + '33';
      chip.style.color       = s.color;
      chip.style.borderLeft  = `3px solid ${s.color}`;
      chip.dataset.id = s.id;
      el.appendChild(chip);
    });
    if (schedules.length > maxShow) {
      const more = document.createElement('div');
      more.className   = 'event-more';
      more.textContent = `+${schedules.length - maxShow}개 더`;
      el.appendChild(more);
    }
  }

  // ── 네비게이션 ────────────────────────────────────────

  prevMonth() {
    this.month--;
    if (this.month < 0) { this.month = 11; this.year--; }
    this._render();
  }

  nextMonth() {
    this.month++;
    if (this.month > 11) { this.month = 0; this.year++; }
    this._render();
  }

  goToday() {
    this.year  = this.today.getFullYear();
    this.month = this.today.getMonth();
    this._render();
    this._selectDate(this._todayStr());
  }

  get currentYear()  { return this.year;  }
  get currentMonth() { return this.month + 1; } // 1-indexed

  // ── 유틸 ──────────────────────────────────────────────

  _dateStr(y, m, d) {
    const date = new Date(y, m, d);
    const yy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
  }

  _todayStr() {
    const t = this.today;
    return this._dateStr(t.getFullYear(), t.getMonth(), t.getDate());
  }
}
