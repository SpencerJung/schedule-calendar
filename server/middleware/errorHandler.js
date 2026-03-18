import { AppError } from '../utils/errors.js';

export default function errorHandler(err, req, res, next) {
  // 헤더가 이미 전송된 경우 Express 기본 핸들러에 위임
  if (res.headersSent) return next(err);

  // 413: 요청 바디 크기 초과 (스택 불필요)
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: '요청 데이터가 너무 큽니다. (최대 16KB)' });
  }

  // 커스텀 AppError 계층 처리 (ValidationError, AuthError, NotFoundError 등)
  if (err instanceof AppError) {
    // 4xx는 예상된 에러 → 메시지만 로그
    if (err.status < 500) {
      console.log(`[${req.id || '-'}] ${err.name}: ${err.message}`);
    } else {
      console.error(`[${req.id || '-'}] ${err.name}:`, err.stack);
    }
    return res.status(err.status).json({ error: err.message, code: err.code });
  }

  // SQLite 제약 조건 위반 (중복 이메일/유저명)
  if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || err.message?.includes('UNIQUE constraint failed')) {
    const field = err.message?.includes('email') ? '이메일' : '사용자명';
    return res.status(409).json({ error: `이미 사용 중인 ${field}입니다.`, code: 'CONFLICT' });
  }

  if (err.code === 'SQLITE_BUSY') {
    return res.status(503).json({ error: '서버가 바쁩니다. 잠시 후 다시 시도해주세요.', code: 'DB_BUSY' });
  }

  // 미분류 에러 → 5xx, 스택 트레이스 로그
  console.error(`[${req.id || '-'}] UnhandledError:`, err.stack || err.message);
  res.status(500).json({ error: '서버 내부 오류가 발생했습니다.' });
}
