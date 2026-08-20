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
        entry: ['src/browser/index.ts'],
        outDir: 'lib/browser',
        dts: true,
        format: 'esm',
        platform: 'browser',
    },
    {
        entry: ['src/shared/index.ts'],
        outDir: 'lib/shared',
        dts: true,
        format: 'esm',
    },
])
