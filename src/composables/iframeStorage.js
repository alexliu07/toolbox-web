// src/directives/iframeStorage.js
import {useAuth} from './useAuth.js'

const {createServerStorage,isLoggedIn,authFetch} = useAuth()

export function injectStoragePolyfill(targetWindow) {
    // 初始化时从后端加载localStorage数据
    let serverData = {}
    if (isLoggedIn.value) {
        try {
            const res = authFetch('/api/localstorage')
            if (res.ok) {
                serverData = res.json()
            }
        } catch (e) {
            console.warn('Failed to load localStorage from server:', e)
        }
    }
    const serverStorage = createServerStorage(serverData)
    // const trueLocalStorage = targetWindow.localStorage;
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

    // targetWindow.trueLocalStorage = trueLocalStorage

    return true // 已注入
}

function handleLoad(el) {
    try {
        injectStoragePolyfill(el.contentWindow)
    } catch (e) {
        console.warn('[v-iframe-storage] 注入失败', e)
    }
}

export const vIframeStorage = {
    mounted(el) {
        if (el.tagName !== 'IFRAME') return

        el.__storageLoadHandler__ = () => handleLoad(el)
        el.addEventListener('load', el.__storageLoadHandler__)

        // 已加载完成的情况
        if (el.contentDocument?.readyState === 'complete') {
            handleLoad(el)
        }
    },

    updated(el) {
        // src 变化时 iframe 会重新加载，load 事件会再次触发，无需处理
    },

    beforeUnmount(el) {
        el.removeEventListener('load', el.__storageLoadHandler__)
        delete el.__storageLoadHandler__
    }
}