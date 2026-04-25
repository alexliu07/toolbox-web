<script setup>
import Vditor from "vditor"
import 'vditor/dist/index.css';

import {onMounted, ref} from 'vue'

const editor = ref();
const props = defineProps({
  fileUrl:  { type: String, required: true },
  fileName: { type: String, default: '' },
})

onMounted(() => {
  let contentEditor = new Vditor(editor.value, {
    height: 650,
    toolbarConfig: {
      pin: true,
    },
    cache: {
      enable: false,
    },
    toolbar: ["emoji",
      "headings",
      "bold",
      "italic",
      "strike",
      "|",
      "list",
      "ordered-list",
      "check",
      "outdent",
      "indent",
      "|",
      "quote",
      "line",
      "code",
      "inline-code",
      "insert-before",
      "insert-after",
      "|",
      "table",
      "|",
      "undo",
      "redo",
      "|",
      "fullscreen",
      "edit-mode",
      {
        name: "more",
        toolbar: [
          "both",
          "code-theme",
          "content-theme",
          "outline",
        ],
      },],
    cdn: "/vditor",
    after: () => {
      contentEditor.setTheme("dark", "dark", "fruity");
      contentEditor.setValue('hello, Vditor + Vue!')
    },
  })
})
</script>

<template>
  <div ref="editor"></div>
</template>

<style scoped>

</style>