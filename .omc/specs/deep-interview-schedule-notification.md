# Deep Interview Spec: Schedule Calendar Windows Notification

## Metadata
- Interview ID: di-schedule-notification-20260319
- Rounds: 3
- Final Ambiguity Score: 8.75%
- Type: brownfield
- Generated: 2026-03-19
- Threshold: 20%
- Status: PASSED

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.95 | 35% | 0.333 |
| Constraint Clarity | 0.90 | 25% | 0.225 |
| Success Criteria | 0.85 | 25% | 0.213 |
| Context Clarity | 0.95 | 15% | 0.143 |
| **Total Clarity** | | | **0.9125** |
| **Ambiguity** | | | **8.75%** |

## Goal
기존 schedule-calendar 프로젝트(Node.js + SQLite + Express)에 서버 내장 방식으로 Windows 알림 서비스를 추가한다. 서버가 실행 중일 때 DB의 모든 사용자 일정에 대해 시작 15분 전에 Windows 토스트 알림을 자동 발송한다.

## Constraints
- 기존 server.js에 내장 (별도 프로세스 불필요)
- `npm start` 한 번으로 서버 + 알림 서비스 동시 실행
- node-cron으로 1분마다 DB 체크
- node-notifier로 Windows 네이티브 토스트 알림 발송
- DB의 모든 사용자 일정 대상 (로그인 여부 무관)
- 중복 알림 방지: 인메모리 Set으로 이미 알린 schedule ID 추적
- 브라우저 불필요 (서버만 실행되면 알림 동작)

## Non-Goals
- 브라우저 Web Notifications API 사용하지 않음
- 알림 ON/OFF UI 불필요
- 이메일 알림 불필요
- 반복 일정, 드래그앤드롭 등 기타 기능 추가 불필요

## Acceptance Criteria
- [ ] `npm start` 실행 시 서버와 함께 알림 스케줄러가 시작됨
- [ ] 일정 start_time 15분 전에 Windows 토스트 알림이 팝업됨
- [ ] 알림에 일정 제목과 시간이 표시됨
- [ ] 동일 일정에 대해 중복 알림이 발생하지 않음
- [ ] 알림이 이미 발송된 후 서버 재시작 시 동일 일정 재알림 없음 (당일 기준)
- [ ] start_time이 없는 일정은 알림 대상에서 제외됨
- [ ] 회원가입/로그인/달력/CRUD 기존 기능 그대로 동작

## Technical Context
### 기존 코드베이스
- **서버**: `server/server.js` (Express, port 3000)
- **DB**: `server/db/database.js` (SQLite, WAL mode, node:sqlite)
- **스케쥴 테이블**: schedules (id, user_id, title, description, date, start_time HH:MM, end_time, color, created_at, updated_at)
- **의존성**: express, bcryptjs, jsonwebtoken, cors, cookie-parser, dotenv

### 추가 필요 패키지
- `node-cron`: 크론 스케줄러
- `node-notifier`: Windows 네이티브 알림

### 구현 위치
- `server/notification.js`: 알림 서비스 모듈 (새 파일)
- `server/server.js`: notification 모듈 임포트 및 시작

## Implementation Plan

### 1. 패키지 설치
```bash
npm install node-cron node-notifier
```

### 2. server/notification.js 생성
```javascript
// 1분마다 실행되는 크론잡
// DB에서 오늘 날짜 + 15분 후 시작 일정 조회
// 인메모리 Set으로 중복 방지
// node-notifier로 Windows 토스트 알림 발송
```

### 3. server/server.js 수정
```javascript
// notification 모듈 import 후 startNotificationService() 호출
```

## Ontology (Key Entities)
| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| Schedule | core domain | id, user_id, title, date, start_time | belongs to User |
| User | core domain | id, username, email | has many Schedules |
| NotificationService | supporting | notifiedIds (Set), cronJob | monitors Schedules |
| WindowsNotification | external system | title, message, icon | triggered by NotificationService |

## Interview Transcript
<details>
<summary>Full Q&A (3 rounds)</summary>

### Round 1
**Q:** 윈도우 알림을 어떻게 구현하길 원하시나요?
**A:** 백그라운드 서비스
**Ambiguity:** 50%

### Round 2
**Q:** 백그라운드 서비스를 서버 내장으로 할까요, 별도 스크립트로 할까요?
**A:** 서버 내장 (Recommended)
**Ambiguity:** 30%

### Round 3
**Q:** 알림 대상 사용자 처리 방식?
**A:** DB 전체 사용자
**Q:** 추가 기능?
**A:** 알림만 구현
**Ambiguity:** 8.75%
</details>
