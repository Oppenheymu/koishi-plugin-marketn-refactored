import { defineConfig } from 'tsdown'

export default defineConfig([
    {
        entry: ['src/node/index.ts'],
        outDir: 'lib/node',
        dts: true,
        format: 'esm',
        platform: 'node',
    },
    {
        entry: ['src/shared/index.ts'],
        outDir: 'lib/shared',
        dts: true,
        format: 'esm',
    },
])
