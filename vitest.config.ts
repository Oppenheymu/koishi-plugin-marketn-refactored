import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
    plugins: [vue()],
    test: {
        include: ['src/**/*.test.ts', 'client/**/*.test.ts'],
        environment: 'node',
    },
})
