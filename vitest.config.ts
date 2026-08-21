import vue from '@vitejs/plugin-vue'
import yaml from '@maikolib/vite-plugin-yaml'
import { defineConfig } from 'vitest/config'

export default defineConfig({
    plugins: [vue(), yaml()],
    resolve: {
        alias: {
            'vue-i18n': '@koishijs/client',
            '@koishijs/components': '@koishijs/client',
        },
    },
    test: {
        include: ['src/**/*.test.ts', 'client/**/*.test.ts'],
        environment: 'node',
    },
})
