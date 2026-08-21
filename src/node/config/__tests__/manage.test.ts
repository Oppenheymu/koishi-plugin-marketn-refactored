import { describe, expect, it, vi } from "vitest";

vi.mock("../../installer/index.js", () => ({ SELF_PACKAGE: "koishi-plugin-marketn-refactored" }));
vi.mock("../index.js", () => ({
    configPatchKeys: ["frontendMode", "depsLayout"],
    configReloadKeys: new Set(),
    normalizeMarketSilentRules: (value: unknown) => value,
}));

import type { Config } from "../index.js";
import { ensureMarketNextConfigDefaults, removeLegacyCollapsedGroupsConfig } from "../manage.js";

function context(plugins: Record<string, unknown>) {
    const writeConfig = vi.fn(async () => {});
    const refresh = vi.fn();
    return {
        loader: { config: { plugins }, writable: true, writeConfig, entry: undefined },
        get: () => ({ refresh }),
    } as never;
}

describe("market config tree management", () => {
    it("finds nested market config and repairs defaults", () => {
        const config = {} as Config;
        const plugins = {
            "group:market": {
                "koishi-plugin-marketn-refactored": {},
            },
        };

        expect(ensureMarketNextConfigDefaults(context(plugins), config)).toBe(true);
        expect(plugins["group:market"]).toMatchObject({
            "koishi-plugin-marketn-refactored": {
                frontendMode: "performance",
                depsLayout: "grid",
            },
        });
    });

    it("prefers enabled config over disabled fallback", () => {
        const config = {} as Config;
        const plugins = {
            "~koishi-plugin-marketn-refactored:old": { frontendMode: "polished" },
            "koishi-plugin-marketn-refactored": {
                frontendMode: "performance",
                depsLayout: "legacy",
            },
        };

        expect(ensureMarketNextConfigDefaults(context(plugins), config)).toBe(true);
        expect(plugins["koishi-plugin-marketn-refactored"]).toMatchObject({ depsLayout: "grid" });
        expect(plugins["~koishi-plugin-marketn-refactored:old"]).toEqual({
            frontendMode: "polished",
        });
    });

    it("removes the legacy collapsedGroups field only when present", () => {
        const config = {} as Config;
        const plugins = { "koishi-plugin-marketn-refactored": { collapsedGroups: { core: true } } };
        const ctx = context(plugins);

        expect(removeLegacyCollapsedGroupsConfig(ctx, config)).toBe(true);
        expect(plugins["koishi-plugin-marketn-refactored"]).toEqual({});
        expect(removeLegacyCollapsedGroupsConfig(ctx, config)).toBe(false);
    });

    it("只应用允许的配置字段并刷新配置视图", async () => {
        const config = {} as Config;
        const plugins = { "koishi-plugin-marketn-refactored": { frontendMode: "performance" } };
        const fixture = context(plugins) as {
            loader: { writeConfig: ReturnType<typeof vi.fn> };
            get: () => { refresh: ReturnType<typeof vi.fn> };
        };

        const { updateMarketNextConfig } = await import("../manage.js");
        expect(await updateMarketNextConfig(fixture as never, config, { depsLayout: "list" })).toBe(
            true,
        );
        expect(plugins["koishi-plugin-marketn-refactored"]).toMatchObject({ depsLayout: "list" });
        expect(fixture.loader.writeConfig).toHaveBeenCalledWith(true);
        expect(fixture.get().refresh).toHaveBeenCalledWith("config");
    });
});
