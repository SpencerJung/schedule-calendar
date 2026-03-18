import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { getDB, withTransaction, prepare } from '../db/database.js';
import { generateAccessToken, generateRefreshToken, hashToken, refreshTokenExpiry } from '../utils/jwt.js';
import { ValidationError, AuthError, ConflictError } from '../utils/errors.js';

const router = Router();
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'strict',
  maxAge: 7 * 24 * 60 * 60 * 1000,
  secure: process.env.NODE_ENV === 'production',
};

// ── 회원가입 ────────────────────────────────────────────────
router.post('/register', async (req, res, next) => {
  try {
    const { username, email, password } = req.body;

    // 타입 검증 — JSON 숫자/불리언 방어
    if (typeof username !== 'string' || typeof email !== 'string' || typeof password !== 'string') {
      throw new ValidationError('올바른 형식으로 입력해주세요.');
    }
    if (!username.trim() || !email.trim() || !password) {
      throw new ValidationError('모든 필드를 입력해주세요.');
    }
    if (username.trim().length < 2 || username.trim().length > 30) {
      throw new ValidationError('사용자명은 2~30자이어야 합니다.');
    }
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ValidationError('올바른 이메일 형식이 아닙니다.');
    }
    if (password.length < 6 || password.length > 128) {
      throw new ValidationError('비밀번호는 6~128자이어야 합니다.');
    }

    // bcrypt 비동기 해싱 (CPU 집약적 작업을 이벤트 루프 외부로)
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const db = getDB();

    // 트랜잭션 + IMMEDIATE 락: 동시 INSERT 충돌 방지
    const result = withTransaction(db, () => {
      return prepare(
        'INSERT INTO users (username, email, password) VALUES (?, ?, ?)'
      ).run(username.trim(), email.trim().toLowerCase(), hash);
    })();

    const user = prepare('SELECT id, username, email FROM users WHERE id = ?')
      .get(result.lastInsertRowid);

    res.status(201).json({ message: '회원가입이 완료되었습니다.', user });
  } catch (err) {
    next(err);
  }
});

// ── 로그인 ──────────────────────────────────────────────────
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (typeof email !== 'string' || typeof password !== 'string') {
      throw new ValidationError('올바른 형식으로 입력해주세요.');
    }
    if (!email.trim() || !password) {
      throw new ValidationError('이메일과 비밀번호를 입력해주세요.');
    }
    if (password.length > 128 || email.length > 254) {
      // 길이 초과도 동일 메시지 — 존재 여부 노출 방지
      throw new AuthError('이메일 또는 비밀번호가 올바르지 않습니다.');
    }

    const user = prepare('SELECT * FROM users WHERE email = ?')
      .get(email.trim().toLowerCase());

    if (!user) {
      throw new AuthError('이메일 또는 비밀번호가 올바르지 않습니다.');
    }

    // bcrypt 비동기 비교
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      throw new AuthError('이메일 또는 비밀번호가 올바르지 않습니다.');
    }

    const accessToken = generateAccessToken({ id: user.id, username: user.username, email: user.email });
    const refreshRaw  = generateRefreshToken();
    const tokenHash   = hashToken(refreshRaw);
    const expiresAt   = refreshTokenExpiry();

    // 트랜잭션: 기존 토큰 제거 + 새 토큰 저장 (원자적)
    withTransaction(getDB(), () => {
      prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(user.id);
      prepare('INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)')
        .run(user.id, tokenHash, expiresAt);
    })();

    res.cookie('refreshToken', refreshRaw, COOKIE_OPTS);
    res.json({
      accessToken,
      user: { id: user.id, username: user.username, email: user.email },
    });
  } catch (err) {
    next(err);
  }
});

// ── 액세스 토큰 갱신 (토큰 로테이션) ───────────────────────
router.post('/refresh', (req, res, next) => {
  try {
    const raw = req.cookies?.refreshToken;
    if (!raw) throw new AuthError('리프레시 토큰이 없습니다.');

    const now       = Math.floor(Date.now() / 1000);
    const tokenHash = hashToken(raw);

    // 조회 + 삭제 + 재발급을 트랜잭션으로 묶어 토큰 재사용 방지
    const db = getDB();
    const rotated = withTransaction(db, () => {
      const stored = prepare(
        'SELECT * FROM refresh_tokens WHERE token_hash = ? AND expires_at > ?'
      ).get(tokenHash, now);

      if (!stored) return null;

      const newRaw     = generateRefreshToken();
      const newHash    = hashToken(newRaw);
      const newExpires = refreshTokenExpiry();

      prepare('DELETE FROM refresh_tokens WHERE id = ?').run(stored.id);
      prepare('INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)')
        .run(stored.user_id, newHash, newExpires);

      return { userId: stored.user_id, newRaw };
    })();

    if (!rotated) {
      res.clearCookie('refreshToken');
      throw new AuthError('유효하지 않거나 만료된 리프레시 토큰입니다.');
    }

    const user = prepare('SELECT id, username, email FROM users WHERE id = ?')
      .get(rotated.userId);

    if (!user) throw new AuthError('사용자를 찾을 수 없습니다.');

    const accessToken = generateAccessToken({ id: user.id, username: user.username, email: user.email });

    res.cookie('refreshToken', rotated.newRaw, COOKIE_OPTS);
    res.json({ accessToken, user });
  } catch (err) {
    next(err);
  }
});

// ── 로그아웃 ────────────────────────────────────────────────
router.post('/logout', (req, res, next) => {
  try {
    const raw = req.cookies?.refreshToken;
    if (raw) {
      withTransaction(getDB(), () => {
        prepare('DELETE FROM refresh_tokens WHERE token_hash = ?').run(hashToken(raw));
      })();
    }
    res.clearCookie('refreshToken');
    res.json({ message: '로그아웃되었습니다.' });
  } catch (err) {
    next(err);
  }
});

export default router;
