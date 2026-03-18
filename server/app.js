import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import authRoutes from './routes/auth.js';
import scheduleRoutes from './routes/schedules.js';
import errorHandler from './middleware/errorHandler.js';
import requestLogger from './middleware/requestLogger.js';
import { getDB } from './db/database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// ── 네트워크: 보안 헤더 ────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// ── 운영: 요청 로거 (Request ID 포함) ─────────────────────
app.use(requestLogger);

app.use(cors({
  origin: `http://localhost:${process.env.PORT || 3000}`,
  credentials: true,
}));
app.use(express.json({ limit: '16kb' }));
app.use(cookieParser());

// ── 운영: 헬스체크 엔드포인트 ─────────────────────────────
app.get('/health', (req, res) => {
  try {
    const db = getDB();
    db.prepare('SELECT 1').get(); // DB 연결 확인
    res.json({
      status:  'ok',
      uptime:  Math.floor(process.uptime()),
      memory:  process.memoryUsage().heapUsed,
      version: process.env.npm_package_version || '1.0.0',
    });
  } catch (err) {
    res.status(503).json({ status: 'error', message: err.message });
  }
});

// ── 네트워크: Rate Limiter ─────────────────────────────────
const _rateStore = new Map();
export function rateLimit(maxReqs, windowMs) {
  return (req, res, next) => {
    const key = req.ip || req.socket.remoteAddress;
    const now = Date.now();
    const entry = _rateStore.get(key);

    if (!entry || now > entry.resetAt) {
      _rateStore.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (entry.count >= maxReqs) {
      res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
      return res.status(429).json({ error: '너무 많은 요청입니다. 잠시 후 다시 시도해주세요.', code: 'RATE_LIMIT' });
    }
    entry.count++;
    next();
  };
}

// 만료된 Rate Limit 항목 정리 (메모리 누수 방지)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of _rateStore) {
    if (now > entry.resetAt) _rateStore.delete(key);
  }
}, 60_000);

// 정적 파일 서빙
app.use(express.static(path.join(__dirname, '../public')));

// Rate Limit 적용: 로그인/회원가입 — 15분에 20회
const authLimiter = rateLimit(20, 15 * 60 * 1000);
app.use('/api/auth/login',    authLimiter);
app.use('/api/auth/register', authLimiter);

// API 라우트
app.use('/api/auth',      authRoutes);
app.use('/api/schedules', scheduleRoutes);

// 404 처리
app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: '엔드포인트를 찾을 수 없습니다.', code: 'NOT_FOUND' });
  }
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// 중앙 에러 핸들러 (반드시 마지막)
app.use(errorHandler);

export default app;
