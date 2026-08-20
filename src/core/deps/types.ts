import type { DependencySource } from "../../shared/dependency-source.js";

/** 依赖条目：请求范围、已装版本、来源分类与 latest（dependencies 通道的值类型）。 */
export interface Dependency {
    /**
     * requested semver range
     * @example `^1.2.3` -> `1.2.3`
     */
    request: string;
    /**
     * installed package version
     * @example `1.2.5`
     */
    resolved?: string | undefined;
    /** whether it is a workspace package */
    workspace?: boolean | undefined;
    /** dependency origin used to decide whether npm may manage it */
    source?: DependencySource | undefined;
    /** whether this dependency is supplied by a local source */
    local?: boolean | undefined;
    /** whether package.json contains a reproducible local source */
    bound?: boolean | undefined;
    /** valid (unsupported) syntax */
    invalid?: boolean | undefined;
    /** latest version */
    latest?: string | undefined;
}
