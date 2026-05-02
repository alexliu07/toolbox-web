<script setup>
import { useDisclosure } from '@overlastic/vue'
import { defineEmits, defineProps } from 'vue'
const props = defineProps({
  title: String,
  type: {
    default: 'normal',
    validator(value, props) {
      // The value must match one of these strings
      return ["normal", 'success', 'warning', 'danger'].includes(value)
    }
  }
})

// Get Overlay information from useDisclosure
const { visible, confirm, cancel } = useDisclosure({
  // Duration of pop-up animation, prevents premature destruction of the component
  duration: 1000,
})
</script>

<template>
  <div v-if="visible" class="dialog-overlay">
    <div class="dialog-card">
      <h1 class="dialog-title">{{ title }}</h1>
      <button class="dialog-btn" :class="[props.type]" @click="confirm(`confirmed`)">确定</button>
      <button class="dialog-btn" @click="cancel()">取消</button>
    </div>
  </div>
</template>

<style scoped>
.dialog-overlay {
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

.dialog-card {
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
  display: flex;
  flex-direction: column;
  gap: 16px;
  text-align: left;
}

.dialog-title {
  font-size: 28px;
  font-weight: 600;
  color: #fff;
  margin: 0 0 6px;
  letter-spacing: 1px;
  text-align: center;
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

.dialog-btn {
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

.dialog-btn.danger { background: #f85149; border-color: #f85149; color: #fff0ff; }

.dialog-btn:hover:not(:disabled) {
  opacity: 0.9;
  transform: translateY(-1px);
}

.dialog-btn:active:not(:disabled) {
  transform: translateY(0);
  opacity: 0.85;
}

.dialog-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}


</style>