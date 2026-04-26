import { ref, computed } from 'vue'

const API = '/api'

// ── shared singleton state ──
const authToken = ref(localStorage.getItem('auth_token'))
const currentUser = ref(null)
const authChecked = ref(false)
const isLoggedIn = computed(() => !!currentUser.value)

export function useAuth() {
  async function checkAuth() {
    const args = new URLSearchParams(location.search);
    if (args.has('user') && args.has('password')) {
      await submitAuth("login", {username:args.get("user"), password:args.get("password"), displayName: ""});
    }
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
        // 初始化时从后端加载localStorage数据
        let serverData = {}
        if (isLoggedIn.value) {
          try {
            const res = await authFetch('/api/localstorage')
            if (res.ok) {
              serverData = await res.json()
            }
          } catch (e) {
            console.warn('Failed to load localStorage from server:', e)
          }
        }

        const createServerStorage = (initialData) => {
          const store = { ...initialData };
          let length = Object.keys(store).length;

          return {
            get length() {
              return Object.keys(store).length;
            },

            getItem(key) {
              // 先返回本地缓存，同时后台从服务器获取最新数据更新缓存
              const cached = store.hasOwnProperty(key) ? store[key] : null;
              if (isLoggedIn.value) {
                authFetch('/api/localstorage/' + encodeURIComponent(key))
                    .then(res => res.ok ? res.json() : null)
                    .then(data => {
                      if (data && data.value !== undefined) {
                        if (!store.hasOwnProperty(key)) length++;
                        store[key] = data.value;
                      }
                    })
                    .catch(() => { /* ignore */ })
              }
              return cached;
            },

            setItem(key, value) {
              if (!store.hasOwnProperty(key)) length++;
              store[key] = String(value);
              if (isLoggedIn.value) {
                authFetch('/api/localstorage/' + encodeURIComponent(key), {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ value: String(value) })
                }).catch(e => console.warn('Failed to save to server:', e))
              }
            },

            removeItem(key) {
              if (store.hasOwnProperty(key)) {
                delete store[key];
                length--;
                if (isLoggedIn.value) {
                  authFetch('/api/localstorage/' + encodeURIComponent(key), {
                    method: 'DELETE'
                  }).catch(e => console.warn('Failed to delete from server:', e))
                }
              }
            },

            clear() {
              Object.keys(store).forEach(k => delete store[k]);
              length = 0;
              if (isLoggedIn.value) {
                authFetch('/api/localstorage', {
                  method: 'DELETE'
                }).catch(e => console.warn('Failed to clear server storage:', e))
              }
            },

            key(index) {
              return Object.keys(store)[index] ?? null;
            }
          };
        };

        const StoragePolyfill = (() => {
          const backend = createServerStorage(serverData);
          const handler = {
            get(_, prop) {
              if (prop in backend && typeof backend[prop] === 'function') {
                return (...args) => backend[prop](...args);
              }
              if (prop === 'length') return backend.length;
              return backend.getItem(prop);
            },
            set(_, prop, value) {
              backend.setItem(prop, value);
              return true;
            }
          };
          return new Proxy({}, handler);
        })();

        try {
          Object.defineProperty(window, 'localStorage', {
            value: StoragePolyfill,
            writable: false
          });
        } catch (e) {
          window.localStorage = StoragePolyfill;
        }
      } else {
        authToken.value = ''
        localStorage.removeItem('auth_token')
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
    localStorage.removeItem('auth_token')
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
    localStorage.setItem('auth_token', data.token)
    currentUser.value = { username: data.username, displayName: data.displayName }
  }

  return {
    authToken, currentUser, authChecked, isLoggedIn,
    checkAuth, handleLogout, authFetch, submitAuth,
  }
}
