import { ref, computed } from 'vue'

export function useWindowManager() {
  const openWindows = ref([])
  const pdfWindows = ref([])
  const fileWindows = ref([])
  let winSeq = 0
  let pdfWinSeq = 0
  let fileWinSeq = 0
  let zCounter = 1000

  // ── tool windows ──
  function openTool(tool) {
    if (openWindows.value.find(w => w.toolId === tool.id)) return
    openWindows.value.push({ id: ++winSeq, toolId: tool.id, tool, zIndex: ++zCounter, minimized: false })
  }

  function closeWindow(winId) {
    openWindows.value = openWindows.value.filter(w => w.id !== winId)
  }

  function bringToFront(winId) {
    const win = openWindows.value.find(w => w.id === winId)
    if (win) {
      win.zIndex = ++zCounter
      win.minimized = false
    }
  }

  function minimizeToolWindow(winId) {
    const win = openWindows.value.find(w => w.id === winId)
    if (win) win.minimized = true
  }

  function restoreToolWindow(winId) {
    const win = openWindows.value.find(w => w.id === winId)
    if (win) {
      win.minimized = false
      bringToFront(winId)
    }
  }

  // ── PDF windows ──
  function openPDFViewer(pdfUrl, title = 'PDF Viewer') {
    pdfWindows.value.push({
      id: ++pdfWinSeq,
      pdfUrl,
      title: title.length > 40 ? title.slice(0, 37) + '...' : title,
      zIndex: ++zCounter,
      minimized: false
    })
  }

  function closePDFWindow(winId) {
    pdfWindows.value = pdfWindows.value.filter(w => w.id !== winId)
  }

  function bringPDFToFront(winId) {
    const win = pdfWindows.value.find(w => w.id === winId)
    if (win) {
      win.zIndex = ++zCounter
      win.minimized = false
    }
  }

  function minimizePDFWindow(winId) {
    const win = pdfWindows.value.find(w => w.id === winId)
    if (win) win.minimized = true
  }

  function restorePDFWindow(winId) {
    const win = pdfWindows.value.find(w => w.id === winId)
    if (win) {
      win.minimized = false
      bringPDFToFront(winId)
    }
  }

  // ── file windows ──
  function openFileViewer(fileUrl, fileName, mimeType, fileList = [], currentIndex = -1) {
    let icon = '📄'
    if (mimeType?.startsWith('image/')) icon = '🖼'
    else if (mimeType?.startsWith('video/')) icon = '🎬'
    else if (mimeType?.startsWith('audio/')) icon = '🎵'
    else if (mimeType?.startsWith('text/')) icon = '📝'

    fileWindows.value.push({
      id: ++fileWinSeq,
      fileUrl,
      fileName: fileName.length > 40 ? fileName.slice(0, 37) + '...' : fileName,
      mimeType,
      icon,
      fileList,
      currentIndex,
      zIndex: ++zCounter,
      minimized: false
    })
  }

  function closeFileWindow(winId) {
    fileWindows.value = fileWindows.value.filter(w => w.id !== winId)
  }

  function bringFileToFront(winId) {
    const win = fileWindows.value.find(w => w.id === winId)
    if (win) {
      win.zIndex = ++zCounter
      win.minimized = false
    }
  }

  function minimizeFileWindow(winId) {
    const win = fileWindows.value.find(w => w.id === winId)
    if (win) win.minimized = true
  }

  function restoreFileWindow(winId) {
    const win = fileWindows.value.find(w => w.id === winId)
    if (win) {
      win.minimized = false
      bringFileToFront(winId)
    }
  }

  function navigateFileViewer(winId, newIndex) {
    const win = fileWindows.value.find(w => w.id === winId)
    if (!win || !win.fileList || newIndex < 0 || newIndex >= win.fileList.length) return

    const newFile = win.fileList[newIndex]
    win.currentIndex = newIndex
    win.fileUrl = newFile.url
    win.fileName = newFile.name.length > 40 ? newFile.name.slice(0, 37) + '...' : newFile.name
    win.mimeType = newFile.mime

    if (newFile.mime?.startsWith('image/')) win.icon = '🖼'
    else if (newFile.mime?.startsWith('video/')) win.icon = '🎬'
    else if (newFile.mime?.startsWith('audio/')) win.icon = '🎵'
    else if (newFile.mime?.startsWith('text/')) win.icon = '📝'
    else win.icon = '📄'
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

  const allOpenWindows = computed(() => {
    const tools = openWindows.value.map(w => ({
      id: `tool-${w.id}`,
      winId: w.id,
      type: 'tool',
      title: w.tool.windowTitle,
      icon: w.tool.windowIcon,
      zIndex: w.zIndex,
      minimized: w.minimized,
      bringToFront: () => bringToFront(w.id),
      minimize: () => minimizeToolWindow(w.id),
      restore: () => restoreToolWindow(w.id)
    }))
    const pdfs = pdfWindows.value.map(w => ({
      id: `pdf-${w.id}`,
      winId: w.id,
      type: 'pdf',
      title: w.title,
      icon: '📄',
      zIndex: w.zIndex,
      minimized: w.minimized,
      bringToFront: () => bringPDFToFront(w.id),
      minimize: () => minimizePDFWindow(w.id),
      restore: () => restorePDFWindow(w.id)
    }))
    const files = fileWindows.value.map(w => ({
      id: `file-${w.id}`,
      winId: w.id,
      type: 'file',
      title: w.fileName,
      icon: w.icon,
      zIndex: w.zIndex,
      minimized: w.minimized,
      bringToFront: () => bringFileToFront(w.id),
      minimize: () => minimizeFileWindow(w.id),
      restore: () => restoreFileWindow(w.id)
    }))
    return [...tools, ...pdfs, ...files]
  })

  const focusedWindowId = computed(() => {
    const all = [...openWindows.value, ...pdfWindows.value, ...fileWindows.value]
    if (all.length === 0) return null
    const maxZ = Math.max(...all.map(w => w.zIndex))
    const focused = all.find(w => w.zIndex === maxZ)
    if (!focused) return null
    if (openWindows.value.includes(focused)) return `tool-${focused.id}`
    if (pdfWindows.value.includes(focused)) return `pdf-${focused.id}`
    if (fileWindows.value.includes(focused)) return `file-${focused.id}`
    return null
  })

  const hasOpenWindows = computed(() => allOpenWindows.value.length > 0)

  function isWindowFocused(win) {
    return focusedWindowId.value === win.id && !win.minimized
  }

  function handleTaskbarClick(win) {
    if (win.minimized) {
      win.restore()
      return
    }
    if (isWindowFocused(win)) {
      win.minimize()
    } else {
      win.bringToFront()
    }
  }

  return {
    openWindows, pdfWindows, fileWindows,
    openTool, closeWindow, closePDFWindow, closeFileWindow,
    bringToFront, bringPDFToFront, bringFileToFront,
    minimizeToolWindow, minimizePDFWindow, minimizeFileWindow,
    openPDFViewer, openFileViewer, navigateFileViewer,
    setTaskbarButtonRef, getTaskbarButtonRect,
    allOpenWindows, focusedWindowId, hasOpenWindows,
    handleTaskbarClick,
  }
}
