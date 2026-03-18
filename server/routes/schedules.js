import { Router } from 'express';
import { getDB, withTransaction, prepare } from '../db/database.js';
import authMiddleware from '../middleware/auth.js';
import { ValidationError, NotFoundError } from '../utils/errors.js';

const router = Router();
router.use(authMiddleware);

// ── 입력 검증 헬퍼 ──────────────────────────────────────────
function isValidDate(str) {
  return /^\d{4}-\d{2}-\d{2}$/.test(str) && !isNaN(Date.parse(str));
}
function isValidTime(str) {
  return !str || /^([01]\d|2[0-3]):[0-5]\d$/.test(str);
}
function isValidColor(str) {
  return !str || /^#[0-9a-fA-F]{6}$/.test(str);
}
function isValidYear(str)  { return /^\d{4}$/.test(str); }
function isValidMonth(str) { return /^(0?[1-9]|1[0-2])$/.test(str); }

/** 데이터 무결성: start_time이 end_time보다 늦으면 거부 */
function validateTimeRange(start, end) {
  if (start && end && start >= end) {
    throw new ValidationError('시작 시간이 종료 시간보다 늦거나 같습니다.');
  }
}

/** 공통 필드 검증 (생성/수정 공유) */
function validateScheduleFields({ title, description, date, start_time, end_time, color }) {
  if (!title?.trim())                           throw new ValidationError('제목을 입력해주세요.');
  if (title.trim().length > 100)                throw new ValidationError('제목은 100자 이하이어야 합니다.');
  if (description && description.length > 1000) throw new ValidationError('메모는 1000자 이하이어야 합니다.');
  if (!date || !isValidDate(date))              throw new ValidationError('올바른 날짜 형식이 아닙니다. (YYYY-MM-DD)');
  if (!isValidTime(start_time))                 throw new ValidationError('올바른 시작 시간 형식이 아닙니다. (HH:MM)');
  if (!isValidTime(end_time))                   throw new ValidationError('올바른 종료 시간 형식이 아닙니다. (HH:MM)');
  if (!isValidColor(color))                     throw new ValidationError('올바른 색상 형식이 아닙니다. (#RRGGBB)');
  validateTimeRange(start_time, end_time);
}

// ── 일정 조회 (월별) ────────────────────────────────────────
// GET /api/schedules?year=2026&month=3
router.get('/', (req, res, next) => {
  try {
    const { year, month } = req.query;

    if ((year && !isValidYear(year)) || (month && !isValidMonth(month))) {
      throw new ValidationError('올바른 연도/월 형식이 아닙니다.');
    }

    let rows;
    if (year && month) {
      const m      = String(month).padStart(2, '0');
      const prefix = `${year}-${m}-%`;
      // 성능: 캐시된 prepared statement 재사용
      rows = prepare(
        'SELECT * FROM schedules WHERE user_id = ? AND date LIKE ? ORDER BY date, start_time LIMIT 500'
      ).all(req.user.id, prefix);
    } else {
      rows = prepare(
        'SELECT * FROM schedules WHERE user_id = ? ORDER BY date, start_time LIMIT 500'
      ).all(req.user.id);
    }

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ── 일정 생성 ───────────────────────────────────────────────
router.post('/', (req, res, next) => {
  try {
    const { title, description, date, start_time, end_time, color } = req.body;

    validateScheduleFields({ title, description, date, start_time, end_time, color });

    // 트랜잭션 + IMMEDIATE 락: 동시 쓰기 충돌 방지
    const created = withTransaction(getDB(), () => {
      const result = prepare(`
        INSERT INTO schedules (user_id, title, description, date, start_time, end_time, color)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        req.user.id,
        title.trim(),
        description?.trim() || '',
        date,
        start_time || '',
        end_time   || '',
        color      || '#7c6aff'
      );
      return prepare('SELECT * FROM schedules WHERE id = ?').get(result.lastInsertRowid);
    })();

    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// ── 일정 수정 ───────────────────────────────────────────────
router.put('/:id', (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) throw new ValidationError('유효하지 않은 ID입니다.');

    const { title, description, date, start_time, end_time, color } = req.body;

    validateScheduleFields({ title, description, date, start_time, end_time, color });

    // 트랜잭션: 소유권 확인 + 업데이트 원자적 처리
    const updated = withTransaction(getDB(), () => {
      const existing = prepare(
        'SELECT id FROM schedules WHERE id = ? AND user_id = ?'
      ).get(id, req.user.id);

      if (!existing) return null;

      prepare(`
        UPDATE schedules
        SET title = ?, description = ?, date = ?, start_time = ?, end_time = ?,
            color = ?, updated_at = unixepoch()
        WHERE id = ? AND user_id = ?
      `).run(
        title.trim(),
        description?.trim() || '',
        date,
        start_time || '',
        end_time   || '',
        color      || '#7c6aff',
        id,
        req.user.id
      );

      return prepare('SELECT * FROM schedules WHERE id = ?').get(id);
    })();

    if (!updated) throw new NotFoundError('일정을 찾을 수 없습니다.');
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ── 일정 삭제 ───────────────────────────────────────────────
router.delete('/:id', (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) throw new ValidationError('유효하지 않은 ID입니다.');

    const deleted = withTransaction(getDB(), () => {
      return prepare(
        'DELETE FROM schedules WHERE id = ? AND user_id = ?'
      ).run(id, req.user.id).changes;
    })();

    if (!deleted) throw new NotFoundError('일정을 찾을 수 없습니다.');
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
