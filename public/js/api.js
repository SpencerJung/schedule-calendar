/**
 * api.js — 비동기 I/O 기반 HTTP 클라이언트
 *
 * - accessToken은 JS 메모리에만 저장 (XSS 방어)
 * - refreshToken은 httpOnly 쿠키 → JS 접근 불가
 * - 401 응답 시 자동으로 토큰 갱신 후 재시도 (Silent Refresh)
 */

let accessToken = null;
let refreshPromise = null; // 동시 갱신 요청 방지

export function setAccessToken(token) { accessToken = token; }
export function getAccessToken()      { return accessToken;  }
export function clearAccessToken()    { accessToken = null;  }

const REQUEST_TIMEOUT_MS = 10_000; // 네트워크: 10초 타임아웃

/**
 * 기본 fetch 래퍼 — 인증 헤더 자동 첨부 + 타임아웃
 */
async function request(url, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

  // 네트워크: AbortController로 타임아웃 구현
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      ...options,
      headers,
      credentials: 'include',
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      const e = new Error('요청 시간이 초과되었습니다. 네트워크를 확인해주세요.');
      e.status = 0;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(tid);
  }

  // 204 No Content
  if (res.status === 204) return null;

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.code   = data.code;
    throw err;
  }
  return data;
}

/**
 * Silent Token Refresh — accessToken 만료 시 자동 갱신
 */
async function refreshAccessToken() {
  // 이미 갱신 중이면 같은 Promise 공유 (중복 요청 방지)
  if (!refreshPromise) {
    refreshPromise = request('/api/auth/refresh', { method: 'POST' })
      .then(data => {
        setAccessToken(data.accessToken);
        return data.accessToken;
      })
      .catch(err => {
        clearAccessToken();
        throw err;
      })
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

/**
 * apiFetch — 자동 재시도 포함 최상위 API 호출 함수
 */
export async function apiFetch(url, options = {}) {
  try {
    return await request(url, options);
  } catch (err) {
    // 401 + TOKEN_EXPIRED → 토큰 갱신 후 1회 재시도
    if (err.status === 401 && err.code === 'TOKEN_EXPIRED') {
      try {
        await refreshAccessToken();
        return await request(url, options);
      } catch (refreshErr) {
        // 갱신 실패 → 로그인 페이지로 이동
        clearAccessToken();
        window.location.href = '/';
        throw refreshErr;
      }
    }
    throw err;
  }
}

// ── Auth API ────────────────────────────────────────────

export const authApi = {
  async register(username, email, password) {
    return request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password }),
    });
  },

  async login(email, password) {
    const data = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setAccessToken(data.accessToken);
    return data;
  },

  async refresh() {
    try {
      const data = await request('/api/auth/refresh', { method: 'POST' });
      setAccessToken(data.accessToken);
      return data;
    } catch {
      clearAccessToken();
      return null;
    }
  },

  async logout() {
    try {
      await request('/api/auth/logout', { method: 'POST' });
    } finally {
      clearAccessToken();
    }
  },
};

// ── Schedule API ────────────────────────────────────────

export const scheduleApi = {
  async getAll(year, month) {
    const q = year && month ? `?year=${year}&month=${month}` : '';
    return apiFetch(`/api/schedules${q}`);
  },

  async create(data) {
    return apiFetch('/api/schedules', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async update(id, data) {
    return apiFetch(`/api/schedules/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async delete(id) {
    return apiFetch(`/api/schedules/${id}`, { method: 'DELETE' });
  },
};
