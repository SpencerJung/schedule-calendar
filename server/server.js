import 'dotenv/config';
import app from './app.js';
import { initDB, cleanExpiredTokens } from './db/database.js';

// ── 전역 미처리 예외/거부 핸들러 ──────────────────────────
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err.stack || err.message);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    initDB();
    cleanExpiredTokens();

    const server = app.listen(PORT, () => {
      console.log(`\n🗓  스케줄 캘린더 서버 시작`);
      console.log(`   URL: http://localhost:${PORT}`);
      console.log(`   환경: ${process.env.NODE_ENV || 'development'}`);
      console.log(`   헬스: http://localhost:${PORT}/health\n`);
    });

    // ── 운영: Graceful Shutdown ──────────────────────────
    // SIGTERM: Docker/K8s 종료 신호 | SIGINT: Ctrl+C
    function shutdown(signal) {
      console.log(`\n[${signal}] 서버를 안전하게 종료합니다...`);

      // 새 연결 중단, 기존 요청 완료 대기
      server.close((err) => {
        if (err) {
          console.error('[종료 오류]', err.message);
          process.exit(1);
        }
        console.log('[완료] HTTP 서버 종료됨');
        process.exit(0);
      });

      // 10초 내 완료 안 되면 강제 종료 (hung request 방어)
      setTimeout(() => {
        console.error('[타임아웃] 강제 종료');
        process.exit(1);
      }, 10_000).unref(); // unref(): 이 타이머가 이벤트 루프를 잡지 않도록
    }

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));

  } catch (err) {
    console.error('[시작 실패]', err);
    process.exit(1);
  }
}

start();
