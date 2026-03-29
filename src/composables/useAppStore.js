import { ref, computed } from 'vue'
import {defineStore} from "pinia";

export const useAppStore = defineStore("appStore", ()=>{
    // 动态加载所有带 toolMeta 的工具组件
    const AppModules = import.meta.glob('@/components/*.vue', { eager: true })
    const allApps = ref(Object.values(AppModules)
        .filter(mod => mod.appMeta)
        .map(mod => mod.appMeta)
        .sort((a, b) => a.order - b.order))

    return {allApps}
})

