<template>
  <iframe v-iframe-storage
    src="/wordle/index.html"
    class="wordle-frame"
    allow="fullscreen"
  />
</template>

<style scoped>
.wordle-frame {
  width: 100%;
  height: 100%;
  display: block;
  border: none;
}
</style>
