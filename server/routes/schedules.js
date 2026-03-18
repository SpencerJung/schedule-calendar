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

function validateTimeRange(start, end) {
  if (start && end && start >= end) {
    throw new ValidationError('시작 시간이 종료 시간보다 늦거나 같습니다.');
  }
}

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

// ── 일정 통계 ────────────────────────────────────────────────
// GET /api/schedules/stats
// 반드시 /:id 보다 먼저 등록해야 라우트 충돌 없음
router.get('/stats', (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const db = getDB();

    const total = prepare(
      'SELECT COUNT(*) AS cnt FROM schedules WHERE user_id = ?'
    ).get(req.user.id).cnt;

    const upcoming = prepare(
      'SELECT COUNT(*) AS cnt FROM schedules WHERE user_id = ? AND date >= ?'
    ).get(req.user.id, today).cnt;

    // 이번 달 일정 수
    const ym = today.slice(0, 7);
    const thisMonth = prepare(
      "SELECT COUNT(*) AS cnt FROM schedules WHERE user_id = ? AND date LIKE ?"
    ).get(req.user.id, `${ym}-%`).cnt;

    // 가장 많이 사용한 색상 Top 3
    const topColors = db.prepare(`
      SELECT color, COUNT(*) AS cnt
      FROM schedules
      WHERE user_id = ?
      GROUP BY color
      ORDER BY cnt DESC
      LIMIT 3
    `).all(req.user.id);

    res.json({ total, upcoming, thisMonth, topColors });
  } catch (err) {
    next(err);
  }
});

// ── 일정 조회 (월별 + 키워드 검색) ─────────────────────────
// GET /api/schedules?year=2026&month=3&search=미팅
router.get('/', (req, res, next) => {
  try {
    const { year, month, search } = req.query;

    if ((year && !isValidYear(year)) || (month && !isValidMonth(month))) {
      throw new ValidationError('올바른 연도/월 형식이 아닙니다.');
    }

    // search 키워드 길이 제한
    if (search && search.length > 100) {
      throw new ValidationError('검색어는 100자 이하이어야 합니다.');
    }

    const db = getDB();
    let rows;

    if (search?.trim()) {
      // 키워드 검색: title 또는 description에서 LIKE 매칭
      // % 이스케이프 처리 → LIKE 와일드카드 오용 방지
      const keyword = `%${search.trim().replace(/[%_\\]/g, '\\$&')}%`;

      if (year && month) {
        const m      = String(month).padStart(2, '0');
        const prefix = `${year}-${m}-%`;
        rows = db.prepare(`
          SELECT * FROM schedules
          WHERE user_id = ?
            AND date LIKE ?
            AND (title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')
          ORDER BY date, start_time
          LIMIT 200
        `).all(req.user.id, prefix, keyword, keyword);
      } else {
        rows = db.prepare(`
          SELECT * FROM schedules
          WHERE user_id = ?
            AND (title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')
          ORDER BY date, start_time
          LIMIT 200
        `).all(req.user.id, keyword, keyword);
      }
    } else if (year && month) {
      const m      = String(month).padStart(2, '0');
      const prefix = `${year}-${m}-%`;
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

// ── 단건 조회 ───────────────────────────────────────────────
// GET /api/schedules/:id
router.get('/:id', (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) throw new ValidationError('유효하지 않은 ID입니다.');

    const schedule = prepare(
      'SELECT * FROM schedules WHERE id = ? AND user_id = ?'
    ).get(id, req.user.id);

    if (!schedule) throw new NotFoundError('일정을 찾을 수 없습니다.');
    res.json(schedule);
  } catch (err) {
    next(err);
  }
});

// ── 일정 생성 ───────────────────────────────────────────────
router.post('/', (req, res, next) => {
  try {
    const { title, description, date, start_time, end_time, color } = req.body;

    validateScheduleFields({ title, description, date, start_time, end_time, color });

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
