import {ref, computed, markRaw} from 'vue'
import {defineStore} from "pinia";

export const useWindowStore = defineStore("windowStore", ()=> {
  const AppModules = import.meta.glob('@/components/*.vue', { eager: true })
  const allWindows = ref(Object.values(AppModules)
      .filter(mod => mod.windowMeta)
      .map(mod => ({ ...mod.windowMeta, component: markRaw(mod.default) }))
      .sort((a, b) => a.order - b.order))
  const allOpenWindows = ref([])
  let winSeq = ref(0)
  let zCounter = ref(1000)

  // ── tool windows ──
  function openApp(app) {
    const w = allOpenWindows.value.find(w => w.windowId === app.id)
    if (w) {
      restoreWindow(w.windowId)
    }
    openWindowWithId(app.id)
  }

  function openWindow(component, title, id, icon, width, height, props = {}) {
    allOpenWindows.value.push(
        { id: ++(winSeq.value),
          windowId: id,
          windowTitle: title,
          windowIcon: icon,
          component: component,
          zIndex: ++(zCounter.value),
          minimized: false,
          width: width,
          height: height,
          props: props,
        }
    )
  }
  function openWindowWithId(windowId, args={}, props = {}) {
    let window = allWindows.value.findLast((w) => {
      return w.windowId === windowId
    });
    if (!window) return;
    window = {...window, ...args};
    openWindow(window.component, window.windowTitle, window.windowId, window.windowIcon, window.width, window.height, props)
  }

  function closeWindow(id) {
    allOpenWindows.value = allOpenWindows.value.filter(w => w.id !== id)
  }

  function bringToFront(id) {
    const win = allOpenWindows.value.find(w => w.id === id)
    if (win) {
      win.zIndex = ++(zCounter.value)
      win.minimized = false
    }
  }

  function minimizeWindow(id) {
    const win = allOpenWindows.value.find(w => w.id === id)
    if (win) win.minimized = true
  }

  function restoreWindow(id) {
    const win = allOpenWindows.value.find(w => w.id === id)
    if (win) {
      win.minimized = false
      bringToFront(id)
    }
  }

  // ── taskbar ──
  const taskbarButtonRefs = ref(new Map())

  function setTaskbarButtonRef(el, winId) {
    if (el) {
      taskbarButtonRefs.value.set(winId, el)
    }
  }

  function getTaskbarButtonRect(winId) {
    const el = taskbarButtonRefs.value.get(winId)
    if (el) {
      const rect = el.getBoundingClientRect()
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        width: rect.width,
        height: rect.height
      }
    }
    return null
  }

  const focusedWindowId = computed(() => {
    const all = allOpenWindows.value
    if (all.length === 0) return null
    const maxZ = Math.max(...all.map(w => w.zIndex))
    const focused = all.find(w => w.zIndex === maxZ)
    if (!focused) return null
    if (allOpenWindows.value.includes(focused)) return focused.id
    return null
  })

  const hasOpenWindows = computed(() => allOpenWindows.value.length > 0)

  function isWindowFocused(win) {
    return focusedWindowId.value === win.id && !win.minimized
  }

  function handleTaskbarClick(win) {
    if (win.minimized) {
      restoreWindow(win.id)
      return
    }
    if (isWindowFocused(win)) {
      minimizeWindow(win.id)
    } else {
      bringToFront(win.id)
    }
  }

  return {
    openApp, closeWindow,
    bringToFront,
    minimizeWindow,
    openWindowWithId,
    setTaskbarButtonRef, getTaskbarButtonRect,
    allOpenWindows, focusedWindowId, hasOpenWindows,
    handleTaskbarClick,
  }
})
