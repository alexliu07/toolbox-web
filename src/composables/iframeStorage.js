// src/directives/iframeStorage.js
import { injectStoragePolyfill } from './storage.js'

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