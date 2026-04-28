// src/polyfills/storage.js
import {useAuth} from "@/composables/useAuth.js";

const {isLoggedIn, authFetch} = useAuth()

// 初始化时从后端加载localStorage数据
let serverData = {}
if (isLoggedIn) {
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

export function injectStoragePolyfill(targetWindow) {
    const serverStorage = createServerStorage(serverData)

    try {
        targetWindow.Object.defineProperty(targetWindow, 'localStorage', {
            value: serverStorage,
            configurable: true,
            enumerable: true,
            writable: false
        })
    } catch (e) {
        targetWindow.localStorage = serverStorage
    }

    return true // 已注入
}