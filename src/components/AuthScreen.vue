<script setup>
import { ref } from 'vue'
import { useAuth } from '../composables/useAuth.js'

const { authChecked, isLoggedIn, submitAuth } = useAuth()

const authMode = ref('login')
const authUsername = ref('')
const authPassword = ref('')
const authDisplayName = ref('')
const authError = ref('')
const authLoading = ref(false)

async function handleAuthSubmit() {
  authError.value = ''
  if (!authUsername.value.trim() || !authPassword.value) {
    authError.value = '请填写用户名和密码'
    return
  }
  authLoading.value = true
  try {
    await submitAuth(authMode.value, {
      username: authUsername.value.trim(),
      password: authPassword.value,
      displayName: authDisplayName.value.trim(),
    })
    authPassword.value = ''
  } catch (e) {
    authError.value = e.message === 'Failed to fetch' ? '无法连接到服务器' : e.message
  } finally {
    authLoading.value = false
  }
}
</script>

<template>
  <Transition name="auth-screen">
    <div v-if="authChecked && !isLoggedIn" class="auth-overlay">
      <div class="auth-card">
        <div class="auth-logo">🧰</div>
        <h1 class="auth-title">Toolbox</h1>
        <p class="auth-subtitle">{{ authMode === 'login' ? '登录以继续' : '创建新账户' }}</p>

        <form class="auth-form" @submit.prevent="handleAuthSubmit">
          <div class="auth-field">
            <label>用户名</label>
            <input
              v-model="authUsername"
              type="text"
              placeholder="输入用户名"
              autocomplete="username"
              :disabled="authLoading"
            />
          </div>

          <div v-if="authMode === 'register'" class="auth-field">
            <label>显示名称 <span class="optional">(可选)</span></label>
            <input
              v-model="authDisplayName"
              type="text"
              placeholder="留空则使用用户名"
              :disabled="authLoading"
            />
          </div>

          <div class="auth-field">
            <label>密码</label>
            <input
              v-model="authPassword"
              type="password"
              placeholder="输入密码"
              autocomplete="current-password"
              :disabled="authLoading"
            />
          </div>

          <p v-if="authError" class="auth-error">{{ authError }}</p>

          <button type="submit" class="auth-btn" :disabled="authLoading">
            <span v-if="authLoading">处理中…</span>
            <span v-else>{{ authMode === 'login' ? '登 录' : '注 册' }}</span>
          </button>
        </form>

        <p class="auth-switch">
          <span v-if="authMode === 'login'">
            还没有账户？
            <button class="auth-link" @click="authMode = 'register'; authError = ''">注册</button>
          </span>
          <span v-else>
            已有账户？
            <button class="auth-link" @click="authMode = 'login'; authError = ''">登录</button>
          </span>
        </p>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.auth-overlay {
  position: fixed;
  inset: 0;
  z-index: 9000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(8, 12, 26, 0.7);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.auth-card {
  background: rgba(255, 255, 255, 0.07);
  backdrop-filter: blur(32px);
  -webkit-backdrop-filter: blur(32px);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 28px;
  padding: 48px 48px 40px;
  width: 380px;
  max-width: 90vw;
  box-shadow:
    0 24px 64px rgba(0, 0, 0, 0.6),
    inset 0 1px 0 rgba(255, 255, 255, 0.15);
  text-align: center;
}

.auth-logo {
  font-size: 52px;
  margin-bottom: 8px;
  line-height: 1;
  filter: drop-shadow(0 4px 12px rgba(99, 102, 241, 0.5));
}

.auth-title {
  font-size: 28px;
  font-weight: 600;
  color: #fff;
  margin: 0 0 6px;
  letter-spacing: 1px;
}

.auth-subtitle {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.5);
  margin: 0 0 28px;
}

.auth-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
  text-align: left;
}

.auth-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.auth-field label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  letter-spacing: 0.5px;
  font-weight: 500;
}

.auth-field .optional {
  font-weight: 400;
  opacity: 0.6;
}

.auth-field input {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 10px;
  padding: 10px 14px;
  color: #fff;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s, background 0.2s;
  width: 100%;
  box-sizing: border-box;
}

.auth-field input::placeholder {
  color: rgba(255, 255, 255, 0.3);
}

.auth-field input:focus {
  border-color: rgba(99, 102, 241, 0.7);
  background: rgba(99, 102, 241, 0.08);
}

.auth-field input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.auth-error {
  font-size: 13px;
  color: #f87171;
  margin: 0;
  padding: 8px 12px;
  background: rgba(248, 113, 113, 0.1);
  border-radius: 8px;
  border: 1px solid rgba(248, 113, 113, 0.25);
}

.auth-btn {
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  border: none;
  border-radius: 10px;
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  padding: 12px;
  cursor: pointer;
  transition: opacity 0.2s, transform 0.15s;
  letter-spacing: 2px;
  margin-top: 4px;
}

.auth-btn:hover:not(:disabled) {
  opacity: 0.9;
  transform: translateY(-1px);
}

.auth-btn:active:not(:disabled) {
  transform: translateY(0);
  opacity: 0.85;
}

.auth-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.auth-switch {
  margin: 20px 0 0;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.5);
}

.auth-link {
  background: none;
  border: none;
  color: #818cf8;
  font-size: 13px;
  cursor: pointer;
  padding: 0;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.auth-link:hover {
  color: #a5b4fc;
}

.auth-screen-enter-active,
.auth-screen-leave-active {
  transition: opacity 0.35s ease;
}
.auth-screen-enter-from,
.auth-screen-leave-to {
  opacity: 0;
}
</style>
