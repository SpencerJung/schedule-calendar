import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const ACCESS_SECRET  = process.env.ACCESS_TOKEN_SECRET  || 'fallback_access_secret';
const REFRESH_SECRET = process.env.REFRESH_TOKEN_SECRET || 'fallback_refresh_secret';

export function generateAccessToken(payload) {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: '15m' });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, ACCESS_SECRET);
}

// Refresh token: JWT가 아닌 불투명(opaque) 랜덤 토큰
// DB에 해시값만 저장 → 서버 측 즉시 폐기 가능
export function generateRefreshToken() {
  return crypto.randomBytes(64).toString('hex');
}

export function hashToken(raw) {
  return crypto
    .createHmac('sha256', REFRESH_SECRET)
    .update(raw)
    .digest('hex');
}

// 7일 후 만료 시각 (Unix timestamp)
export function refreshTokenExpiry() {
  return Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
}
