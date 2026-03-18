/**
 * database.js — Node.js 내장 node:sqlite 사용 (빌드 불필요)
 *
 * - WAL 모드: 동시 읽기 허용, 쓰기 성능 향상
 * - Foreign Keys 강제
 * - IMMEDIATE 트랜잭션: 쓰기 작업 시 즉시 락 획득
 * - Prepared Statement 캐시: SQL 파싱 비용 1회로 절감
 */

import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.cwd(), process.env.DB_PATH)
  : path.join(__dirname, '../../data/calendar.db');

// DB 디렉토리 자동 생성
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

let _db = null;

// ── 성능 최적화: Prepared Statement 캐시 ─────────────────
// db.prepare()는 SQL을 파싱해 실행 계획을 만드는 비용이 있음.
// 동일 SQL을 매 요청마다 파싱하는 대신, 최초 1회 파싱 후 재사용.
const _stmtCache = new Map();

export function getDB() {
  if (!_db) {
    _db = new DatabaseSync(DB_PATH);
    _db.exec("PRAGMA journal_mode = WAL");   // WAL: 동시 읽기 허용
    _db.exec("PRAGMA foreign_keys = ON");    // 외래 키 제약 활성화
    _db.exec("PRAGMA busy_timeout = 5000");  // 락 대기 5초
    _db.exec("PRAGMA cache_size = -64000");  // 캐시 64MB
    _db.exec("PRAGMA synchronous = NORMAL"); // WAL 모드에서 안전하고 빠른 동기화
  }
  return _db;
}

/**
 * prepare — Prepared Statement 캐시 래퍼
 * 동일 SQL은 한 번만 컴파일됨 (성능 최적화)
 */
export function prepare(sql) {
  if (!_stmtCache.has(sql)) {
    _stmtCache.set(sql, getDB().prepare(sql));
  }
  return _stmtCache.get(sql);
}

/**
 * withTransaction — IMMEDIATE 트랜잭션 헬퍼
 * IMMEDIATE: 쓰기 트랜잭션 시작 시 즉시 쓰기 락 획득 (TOCTOU 방지)
 */
export function withTransaction(db, fn) {
  return (...args) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch (rollbackErr) {
        console.error('[DB] ROLLBACK 실패:', rollbackErr.message);
      }
      throw err;
    }
  };
}

export function initDB() {
  const db = getDB();

  withTransaction(db, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        username    TEXT    UNIQUE NOT NULL,
        email       TEXT    UNIQUE NOT NULL,
        password    TEXT    NOT NULL,
        created_at  INTEGER DEFAULT (unixepoch())
      );

      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash  TEXT    UNIQUE NOT NULL,
        expires_at  INTEGER NOT NULL,
        created_at  INTEGER DEFAULT (unixepoch())
      );

      CREATE TABLE IF NOT EXISTS schedules (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title       TEXT    NOT NULL CHECK(length(title) <= 100),
        description TEXT    DEFAULT '' CHECK(length(description) <= 1000),
        date        TEXT    NOT NULL,
        start_time  TEXT    DEFAULT '',
        end_time    TEXT    DEFAULT '',
        color       TEXT    DEFAULT '#7c6aff' CHECK(color GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'),
        created_at  INTEGER DEFAULT (unixepoch()),
        updated_at  INTEGER DEFAULT (unixepoch())
      );

      CREATE INDEX IF NOT EXISTS idx_schedules_user_date
        ON schedules(user_id, date);

      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash
        ON refresh_tokens(token_hash);

      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires
        ON refresh_tokens(expires_at);
    `);
  })();

  console.log('[DB] 초기화 완료:', DB_PATH);
  return db;
}

export function cleanExpiredTokens() {
  const now = Math.floor(Date.now() / 1000);
  const result = prepare('DELETE FROM refresh_tokens WHERE expires_at < ?').run(now);
  if (result.changes > 0) {
    console.log(`[DB] 만료 토큰 ${result.changes}개 삭제`);
  }
}
