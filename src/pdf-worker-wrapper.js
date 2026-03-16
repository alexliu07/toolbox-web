// Polyfill for older WebViews before loading pdf.js worker
if (typeof Promise.withResolvers === 'undefined') {
  Promise.withResolvers = function () {
    let resolve, reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }
}

import 'pdfjs-dist/build/pdf.worker.min.mjs'
