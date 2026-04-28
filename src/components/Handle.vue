<template>
  <iframe v-iframe-storage
    src="/handle/index.html"
    class="handle-frame"
    allow="fullscreen"
  />
</template>

<style scoped>
.handle-frame {
  width: 100%;
  height: 100%;
  display: block;
  border: none;
}
</style>
