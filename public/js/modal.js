/**
 * modal.js — 일정 추가/수정 모달 & 확인 다이얼로그
 */

const COLORS = [
  '#7c6aff', '#ff6b9d', '#4ade80', '#facc15',
  '#f87171', '#38bdf8', '#fb923c',
];

export class ScheduleModal {
  constructor(overlayEl, { onSave } = {}) {
    this.overlay = overlayEl;
    this.onSave  = onSave || (() => {});
    this.editId  = null;
    this._build();
  }

  _build() {
    this.overlay.innerHTML = `
      <div class="modal" id="schedule-modal">
        <div class="modal-header">
          <h3 id="modal-title">일정 추가</h3>
          <button class="btn-icon" id="modal-close">✕</button>
        </div>
        <div class="modal-form" id="modal-form">
          <div class="field">
            <label>제목 <span style="color:var(--red)">*</span></label>
            <input type="text" id="f-title" placeholder="일정 제목을 입력하세요" maxlength="100">
          </div>
          <div class="field">
            <label>날짜 <span style="color:var(--red)">*</span></label>
            <input type="date" id="f-date">
          </div>
          <div class="modal-row">
            <div class="field">
              <label>시작 시간</label>
              <input type="time" id="f-start">
            </div>
            <div class="field">
              <label>종료 시간</label>
              <input type="time" id="f-end">
            </div>
          </div>
          <div class="field">
            <label>메모</label>
            <textarea id="f-desc" placeholder="메모 (선택사항)" rows="3"></textarea>
          </div>
          <div class="field">
            <label>색상</label>
            <div class="color-picker" id="color-picker">
              ${COLORS.map((c, i) =>
                `<div class="color-opt${i === 0 ? ' active' : ''}"
                      data-color="${c}"
                      style="background:${c}"
                      title="${c}"></div>`
              ).join('')}
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" id="modal-cancel">취소</button>
          <button class="btn btn-primary" id="modal-save">
            <span id="save-label">저장</span>
          </button>
        </div>
      </div>
    `;

    this.titleEl  = this.overlay.querySelector('#modal-title');
    this.saveBtn  = this.overlay.querySelector('#modal-save');
    this.saveLabel = this.overlay.querySelector('#save-label');
    this.colorPicker = this.overlay.querySelector('#color-picker');

    this.overlay.querySelector('#modal-close').addEventListener('click',  () => this.close());
    this.overlay.querySelector('#modal-cancel').addEventListener('click', () => this.close());
    this.overlay.addEventListener('click', e => { if (e.target === this.overlay) this.close(); });
    this.saveBtn.addEventListener('click', () => this._handleSave());

    // 색상 선택
    this.colorPicker.addEventListener('click', e => {
      const opt = e.target.closest('.color-opt');
      if (!opt) return;
      this.colorPicker.querySelectorAll('.color-opt').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
    });
  }

  _getFields() {
    return {
      title:      this.overlay.querySelector('#f-title'),
      date:       this.overlay.querySelector('#f-date'),
      start_time: this.overlay.querySelector('#f-start'),
      end_time:   this.overlay.querySelector('#f-end'),
      desc:       this.overlay.querySelector('#f-desc'),
    };
  }

  _getColor() {
    const active = this.colorPicker.querySelector('.color-opt.active');
    return active ? active.dataset.color : COLORS[0];
  }

  _setColor(color) {
    this.colorPicker.querySelectorAll('.color-opt').forEach(o => {
      o.classList.toggle('active', o.dataset.color === color);
    });
    if (!this.colorPicker.querySelector('.color-opt.active')) {
      this.colorPicker.querySelector('.color-opt').classList.add('active');
    }
  }

  open(prefillDate = null, schedule = null) {
    const f = this._getFields();

    if (schedule) {
      // 수정 모드
      this.editId = schedule.id;
      this.titleEl.textContent = '일정 수정';
      this.saveLabel.textContent = '수정';
      f.title.value      = schedule.title;
      f.date.value       = schedule.date;
      f.start_time.value = schedule.start_time || '';
      f.end_time.value   = schedule.end_time   || '';
      f.desc.value       = schedule.description || '';
      this._setColor(schedule.color || COLORS[0]);
    } else {
      // 추가 모드
      this.editId = null;
      this.titleEl.textContent = '일정 추가';
      this.saveLabel.textContent = '저장';
      f.title.value      = '';
      f.date.value       = prefillDate || '';
      f.start_time.value = '';
      f.end_time.value   = '';
      f.desc.value       = '';
      this._setColor(COLORS[0]);
    }

    this.overlay.classList.remove('hidden');
    setTimeout(() => f.title.focus(), 50);
  }

  close() {
    this.overlay.classList.add('hidden');
    this.editId = null;
  }

  async _handleSave() {
    const f = this._getFields();
    const title = f.title.value.trim();
    const date  = f.date.value;

    if (!title) { f.title.focus(); return; }
    if (!date)  { f.date.focus();  return; }

    const payload = {
      title,
      date,
      start_time:  f.start_time.value || '',
      end_time:    f.end_time.value   || '',
      description: f.desc.value.trim(),
      color:       this._getColor(),
    };

    this.saveBtn.disabled = true;
    this.saveLabel.innerHTML = '<span class="spinner"></span>';

    try {
      await this.onSave(payload, this.editId);
      this.close();
    } finally {
      this.saveBtn.disabled = false;
      this.saveLabel.textContent = this.editId ? '수정' : '저장';
    }
  }
}

// ── 확인 다이얼로그 ─────────────────────────────────────────

// [Fix #1] XSS 방어: innerHTML 대신 textContent 사용
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

export function showConfirm(message, subMessage = '') {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    // message/subMessage는 esc()로 이스케이프 후 삽입
    overlay.innerHTML = `
      <div class="modal" style="max-width:360px">
        <div class="confirm-box">
          <p>${esc(message)}</p>
          ${subMessage ? `<p class="warn">${esc(subMessage)}</p>` : ''}
          <div class="confirm-btns">
            <button class="btn btn-ghost" id="conf-no">취소</button>
            <button class="btn btn-danger" id="conf-yes">삭제</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const cleanup = (result) => {
      overlay.remove();
      resolve(result);
    };

    overlay.querySelector('#conf-yes').addEventListener('click', () => cleanup(true));
    overlay.querySelector('#conf-no').addEventListener('click',  () => cleanup(false));
    overlay.addEventListener('click', e => { if (e.target === overlay) cleanup(false); });
  });
}
