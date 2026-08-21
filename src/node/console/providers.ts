import { DataService } from "@koishijs/console";
import type { DependencyMetaKey, RemotePackage } from "@koishijs/registry";
import type { Context, Dict } from "koishi";
import type { Dependency } from "../../core/deps/types.js";
import type { RegistryStatus } from "../../shared/types.js";

/** dependencies 通道：依赖快照。 */
export class DependencyProvider extends DataService<Dict<Dependency>> {
    constructor(ctx: Context) {
        super(ctx, "dependencies", { authority: 4 });
    }

    override async get() {
        return (await this.ctx.installer.getDeps({ background: false })) ?? {};
    }
}

/** registry 通道：包版本元数据全量缓存。 */
export class RegistryProvider extends DataService<
    Dict<Dict<Pick<RemotePackage, DependencyMetaKey>>>
> {
    constructor(ctx: Context) {
        super(ctx, "registry", { authority: 4 });
    }

    override async get() {
        return this.ctx.installer.fullCache;
    }
}

/** registryStatus 通道：npm 端点状态。 */
export class RegistryStatusProvider extends DataService<Dict<RegistryStatus>> {
    constructor(ctx: Context) {
        super(ctx, "registryStatus", { authority: 4 });
    }

    override async get() {
        return this.ctx.installer.registryStatus;
    }
}
