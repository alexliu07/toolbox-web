import { ref, computed, markRaw } from 'vue'

export function useWindowManager() {
  const windows = ref([])
  let seq = 0
  let zCounter = 1000

  // singletonKey: 同一 key 只允许一个窗口存在
  function openWindow({ title, icon = '', width = 800, height = 600, component, props = {}, singletonKey = null }) {
    if (singletonKey && windows.value.find(w => w.singletonKey === singletonKey)) return null
    const id = `win-${++seq}`
    windows.value.push({
      id, title, icon, width, height,
      component: markRaw(component),
      props,
      singletonKey,
      zIndex: ++zCounter,
      minimized: false,
    })
    return id
  }

  function closeWindow(id) {
    windows.value = windows.value.filter(w => w.id !== id)
  }

  function bringToFront(id) {
    const win = windows.value.find(w => w.id === id)
    if (win) { win.zIndex = ++zCounter; win.minimized = false }
  }

  function minimizeWindow(id) {
    const win = windows.value.find(w => w.id === id)
    if (win) win.minimized = true
  }

  function restoreWindow(id) {
    const win = windows.value.find(w => w.id === id)
    if (win) { win.minimized = false; bringToFront(id) }
  }

  // 允许外部更新窗口标题、图标或 props（用于文件导航等场景）
  function updateWindow(id, patch) {
    const win = windows.value.find(w => w.id === id)
    if (!win) return
    if (patch.title !== undefined) win.title = patch.title
    if (patch.icon  !== undefined) win.icon  = patch.icon
    if (patch.props !== undefined) Object.assign(win.props, patch.props)
  }

  // ── taskbar ──
  const taskbarButtonRefs = ref(new Map())

  function setTaskbarButtonRef(el, winId) {
    if (el) taskbarButtonRefs.value.set(winId, el)
  }

  function getTaskbarButtonRect(winId) {
    const el = taskbarButtonRefs.value.get(winId)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width, height: r.height }
  }

  // ── computed ──
  const allOpenWindows = computed(() =>
    windows.value.map(w => ({
      id: w.id, title: w.title, icon: w.icon,
      zIndex: w.zIndex, minimized: w.minimized,
      bringToFront: () => bringToFront(w.id),
      minimize:     () => minimizeWindow(w.id),
      restore:      () => restoreWindow(w.id),
    }))
  )

  const focusedWindowId = computed(() => {
    if (!windows.value.length) return null
    const maxZ = Math.max(...windows.value.map(w => w.zIndex))
    return windows.value.find(w => w.zIndex === maxZ)?.id ?? null
  })

  const hasOpenWindows = computed(() => windows.value.length > 0)

  function handleTaskbarClick(win) {
    if (win.minimized) { win.restore(); return }
    if (focusedWindowId.value === win.id) win.minimize()
    else win.bringToFront()
  }

  return {
    windows,
    openWindow, closeWindow, bringToFront, minimizeWindow, restoreWindow, updateWindow,
    setTaskbarButtonRef, getTaskbarButtonRect,
    allOpenWindows, focusedWindowId, hasOpenWindows, handleTaskbarClick,
  }
}
