import { describe, expect, it, vi } from "vitest";
import { removeBundleConfigs } from "../bundle.js";

function context(plugins: Record<string, unknown>, writable = true) {
    const writeConfig = vi.fn(async () => {});
    const fullReload = vi.fn();
    const refresh = vi.fn();
    return {
        ctx: {
            loader: { config: { plugins }, writable, writeConfig, fullReload },
            scope: { isActive: true },
            get: () => ({ refresh }),
        } as never,
        writeConfig,
        fullReload,
        refresh,
    };
}

describe("removeBundleConfigs", () => {
    it("按成员筛选删除配置并保留其他成员", async () => {
        const plugins = {
            "group:pa-demo-bundle": {
                "~foo:one": {},
                "~bar:two": {},
            },
        };
        const fixture = context(plugins);

        const result = await removeBundleConfigs(fixture.ctx, {
            package: "koishi-plugin-demo-bundle",
            members: [{ package: "koishi-plugin-foo", plugin: "foo" }],
            removeEmptyGroup: false,
        });

        expect(result.removed).toEqual(["~foo:one"]);
        expect(plugins["group:pa-demo-bundle"]).toMatchObject({ "~bar:two": {} });
        expect(fixture.writeConfig).toHaveBeenCalledTimes(1);
        expect(fixture.refresh).toHaveBeenCalledTimes(2);
    });

    it("删除最后成员时移除空 group", async () => {
        const plugins = { "group:pa-demo-bundle": { "~foo:one": {} } };
        const fixture = context(plugins);

        const result = await removeBundleConfigs(fixture.ctx, {
            package: "koishi-plugin-demo-bundle",
            removeEmptyGroup: true,
        });

        expect(result.removedGroup).toBe(true);
        expect(plugins).toEqual({});
    });

    it("不可写配置时不产生变更", async () => {
        const plugins = { "group:pa-demo-bundle": { "~foo:one": {} } };
        const fixture = context(plugins, false);

        const result = await removeBundleConfigs(fixture.ctx, {
            package: "koishi-plugin-demo-bundle",
        });

        expect(result).toEqual({ groupKey: "group:pa-demo-bundle", removed: [] });
        expect(fixture.writeConfig).not.toHaveBeenCalled();
    });
});
