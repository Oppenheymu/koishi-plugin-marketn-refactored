import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import yaml from '@maikolib/vite-plugin-yaml'
import uno from 'unocss/vite'
import presetMini from 'unocss/preset-mini'

// 对齐 @koishijs/client 官方打包配置，保证宿主 dev 模式（宿主内置 vite + unocss）
// 与本地 prod 构建（vite 8）行为一致：
// - external 只留运行时由 console 提供的包
// - alias 把 vue-i18n / @koishijs/components 指向 @koishijs/client
// - unocss 仅 preset-mini、无 preflight
// - lib 模式下 Vite 会把入口 CSS 产物命名为 style.css（prod console 只探测它）
export default defineConfig({
    build: {
        outDir: 'dist',
        assetsDir: '',
        minify: true,
        emptyOutDir: true,
        commonjsOptions: {
            strictRequires: true,
        },
        lib: {
            entry: 'client/index.ts',
            fileName: 'index',
            // prod console 只探测 style.css；Vite 8 默认按入口名产出 index.css，需显式指定
            cssFileName: 'style',
            formats: ['es'],
        },
        rollupOptions: {
            makeAbsoluteExternalsRelative: true,
            external: ['vue', 'vue-router', '@vueuse/core', '@koishijs/client'],
        },
    },
    plugins: [
        vue(),
        yaml(),
        uno({
            presets: [presetMini({ preflight: false })],
        }),
    ],
    css: {
        preprocessorOptions: {
            scss: {
                api: 'modern-compiler',
            },
        },
    },
    resolve: {
        alias: {
            'vue-i18n': '@koishijs/client',
            '@koishijs/components': '@koishijs/client',
        },
    },
    define: {
        'process.env.NODE_ENV': '"production"',
    },
})
