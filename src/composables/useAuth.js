import { ref, computed } from 'vue'

const API = '/api'

// ── localStorage safe helpers ──
function lsGet(key, fallback = '') {
  try { return localStorage.getItem(key) ?? fallback } catch { return fallback }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, val) } catch {}
}
function lsRemove(key) {
  try { localStorage.removeItem(key) } catch {}
}

// ── shared singleton state ──
const authToken = ref(lsGet('auth_token'))
const currentUser = ref(null)
const authChecked = ref(false)
const isLoggedIn = computed(() => !!currentUser.value)

export function useAuth() {
  async function checkAuth() {
    if (!authToken.value) {
      authChecked.value = true
      return
    }
    try {
      const res = await fetch(`${API}/auth/me`, {
        headers: { Authorization: `Bearer ${authToken.value}` }
      })
      if (res.ok) {
        currentUser.value = await res.json()
      } else {
        authToken.value = ''
        lsRemove('auth_token')
      }
    } catch {
      // server offline
    } finally {
      authChecked.value = true
    }
  }

  async function handleLogout() {
    try {
      await fetch(`${API}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken.value}` }
      })
    } catch { /* ignore */ }
    authToken.value = ''
    currentUser.value = null
    lsRemove('auth_token')
  }

  function authFetch(url, options = {}) {
    return fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${authToken.value}`,
      },
    })
  }

  async function submitAuth(mode, { username, password, displayName }) {
    const body = { username, password }
    if (mode === 'register') {
      body.displayName = displayName || username
    }
    const res = await fetch(`${API}/auth/${mode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '操作失败')
    authToken.value = data.token
    lsSet('auth_token', data.token)
    currentUser.value = { username: data.username, displayName: data.displayName }
  }

  return {
    authToken, currentUser, authChecked, isLoggedIn,
    checkAuth, handleLogout, authFetch, submitAuth,
  }
}
