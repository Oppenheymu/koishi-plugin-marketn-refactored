import { describe, expect, it, vi } from "vitest";

vi.mock("../../installer/index.js", () => ({ SELF_PACKAGE: "koishi-plugin-marketn-refactored" }));
vi.mock("../index.js", () => ({
    configPatchKeys: [],
    configReloadKeys: new Set(),
    normalizeMarketSilentRules: (value: unknown) => value,
}));

import type { Config } from "../index.js";
import { ensureMarketNextConfigDefaults, removeLegacyCollapsedGroupsConfig } from "../manage.js";

function context(plugins: Record<string, unknown>) {
    return {
        loader: { config: { plugins }, writable: true },
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
});
