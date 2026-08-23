import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * @file prefs.ts 的单元测试:前端渲染模式与依赖页布局的读取矩阵。
 */

vi.mock("@koishijs/client", async () => {
    const { createKoishiClientStub } = await import("../../__tests__/helpers");
    return createKoishiClientStub();
});

const { store } = await import("@koishijs/client");
const { getDepsLayout, getFrontendMode } = await import("../prefs");

/** 布置插件配置节点。 */
function setupPluginConfig(config: any) {
    store.config = { plugins: { "market-next": config } };
}

beforeEach(() => {
    store.config = {};
});

describe("getFrontendMode", () => {
    it("插件未配置时默认 performance", () => {
        expect(getFrontendMode()).toBe("performance");
    });

    it("显式配置 polished/performance 按原值返回", () => {
        setupPluginConfig({ frontendMode: "polished" });
        expect(getFrontendMode()).toBe("polished");
        setupPluginConfig({ frontendMode: "performance" });
        expect(getFrontendMode()).toBe("performance");
    });

    it("非法取值回退 performance", () => {
        setupPluginConfig({ frontendMode: "fancy" });
        expect(getFrontendMode()).toBe("performance");
    });
});

describe("getDepsLayout", () => {
    it("插件未配置时默认 grid", () => {
        expect(getDepsLayout()).toBe("grid");
    });

    it("list 原值返回,其余取值回退 grid", () => {
        setupPluginConfig({ depsLayout: "list" });
        expect(getDepsLayout()).toBe("list");
        setupPluginConfig({ depsLayout: "masonry" });
        expect(getDepsLayout()).toBe("grid");
    });
});
