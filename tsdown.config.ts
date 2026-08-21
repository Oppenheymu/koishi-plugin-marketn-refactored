import { defineConfig } from 'tsdown'

// 源码保持 ESM（package.json 仍为 type:module，tsconfig/编辑器按 ESM 解析）；
// 但 Koishi 的 loader 用 require() 加载插件，因此构建产物固定为 CJS（.cjs 扩展名）。
const outExtensions = () => ({ js: '.cjs', dts: '.d.ts' })

// 纯 ESM 依赖（execa/p-map 等）若外置，运行时 require(esm) 会触发
// ERR_REQUIRE_ESM_RACE_CONDITION 与命名导出互操作问题；打进 CJS 产物保证全同步。
const esmOnlyDeps = ['execa', 'p-map', 'package-manager-detector']

export default defineConfig([
    {
        entry: ['src/node/index.ts'],
        outDir: 'lib/node',
        dts: true,
        format: 'cjs',
        platform: 'node',
        outExtensions,
        deps: {
            alwaysBundle: esmOnlyDeps,
        },
    },
    {
        entry: ['src/shared/index.ts'],
        outDir: 'lib/shared',
        dts: true,
        format: 'cjs',
        outExtensions,
    },
])
