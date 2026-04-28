import './assets/main.css'

import { createApp } from 'vue'
import App from './App.vue'
import { vIframeStorage } from './composables/iframeStorage.js'

const app = createApp(App)
app.directive('iframe-storage', vIframeStorage)
app.mount('#app')
