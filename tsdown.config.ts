import { defineConfig } from 'tsdown'

// package.json 的 exports 指向 .js：type:module 下 tsdown 默认产出 .mjs，这里固定为 .js
const outExtensions = () => ({ js: '.js', dts: '.d.ts' })

export default defineConfig([
    {
        entry: ['src/node/index.ts'],
        outDir: 'lib/node',
        dts: true,
        format: 'esm',
        platform: 'node',
        outExtensions,
    },
    {
        entry: ['src/shared/index.ts'],
        outDir: 'lib/shared',
        dts: true,
        format: 'esm',
        outExtensions,
    },
])
