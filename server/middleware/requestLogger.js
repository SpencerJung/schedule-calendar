/**
 * requestLogger.js — 요청/응답 로거
 *
 * - 요청마다 고유 ID 부여 → 분산 추적 기반
 * - 응답 시간(ms) 측정
 * - 4xx/5xx 색상 구분 (터미널)
 */

import crypto from 'crypto';

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED    = '\x1b[31m';
const CYAN   = '\x1b[36m';
const GRAY   = '\x1b[90m';

function colorForStatus(s) {
  if (s < 300) return GREEN;
  if (s < 400) return CYAN;
  if (s < 500) return YELLOW;
  return RED;
}

export default function requestLogger(req, res, next) {
  const start = process.hrtime.bigint();
  req.id = crypto.randomBytes(4).toString('hex'); // 8자 요청 ID

  res.setHeader('X-Request-Id', req.id);

  res.on('finish', () => {
    // 정적 파일 요청은 생략 (로그 과부하 방지)
    if (req.path.match(/\.(css|js|ico|png|jpg|svg|woff)$/)) return;

    const ms  = Number(process.hrtime.bigint() - start) / 1_000_000;
    const col = colorForStatus(res.statusCode);
    console.log(
      `${GRAY}[${req.id}]${RESET} ${req.method.padEnd(6)} ` +
      `${req.path.padEnd(30)} ${col}${res.statusCode}${RESET} ` +
      `${GRAY}${ms.toFixed(1)}ms${RESET}`
    );
  });

  next();
}
