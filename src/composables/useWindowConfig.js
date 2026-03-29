import {inject} from "vue";

export function useWindowConfig() {
    const title = inject('title')
    const icon = inject('icon')
    const minimized = inject('minimize')

    return {title, icon, minimized}
}