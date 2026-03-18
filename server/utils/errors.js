/**
 * errors.js — 커스텀 에러 클래스 계층
 *
 * 장점:
 * - instanceof 로 에러 종류 구분 → errorHandler 분기 단순화
 * - status/code 를 에러 생성 시점에 확정 → 라우트에서 매번 지정 불필요
 * - 스택 트레이스가 throw 지점을 정확히 가리킴
 */

export class AppError extends Error {
  constructor(message, status = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.name  = this.constructor.name;
    this.status = status;
    this.code   = code;
    // V8 스택 트레이스 최적화
    if (Error.captureStackTrace) Error.captureStackTrace(this, this.constructor);
  }
}

/** 400 — 입력값 형식/범위 오류 */
export class ValidationError extends AppError {
  constructor(message) { super(message, 400, 'VALIDATION_ERROR'); }
}

/** 401 — 인증 실패 */
export class AuthError extends AppError {
  constructor(message, code = 'AUTH_ERROR') { super(message, 401, code); }
}

/** 403 — 인가 실패 (접근 권한 없음) */
export class ForbiddenError extends AppError {
  constructor(message = '접근 권한이 없습니다.') { super(message, 403, 'FORBIDDEN'); }
}

/** 404 — 리소스 없음 */
export class NotFoundError extends AppError {
  constructor(message = '요청한 리소스를 찾을 수 없습니다.') { super(message, 404, 'NOT_FOUND'); }
}

/** 409 — 중복/충돌 */
export class ConflictError extends AppError {
  constructor(message) { super(message, 409, 'CONFLICT'); }
}

/** 429 — Rate Limit 초과 */
export class RateLimitError extends AppError {
  constructor(message = '너무 많은 요청입니다. 잠시 후 다시 시도해주세요.') {
    super(message, 429, 'RATE_LIMIT');
  }
}
