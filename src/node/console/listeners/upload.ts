import type { Context } from "koishi";
import { registerContractListener } from "./helpers.js";

/** 本地 .tgz 上传类 listener：分块上传会话的 start/chunk/finish/commit/cancel。 */
export function registerUploadListeners(ctx: Context) {
    registerContractListener(ctx, "market/local-package-upload-start", (request) =>
        ctx.installer.startLocalPackageUpload(request),
    );
    registerContractListener(ctx, "market/local-package-upload-chunk", (request) =>
        ctx.installer.appendLocalPackageUpload(request),
    );
    registerContractListener(ctx, "market/local-package-upload-finish", (request) =>
        ctx.installer.finishLocalPackageUpload(request),
    );
    registerContractListener(ctx, "market/local-package-upload-commit", (uploadId) =>
        ctx.installer.commitLocalPackageUpload(uploadId),
    );
    registerContractListener(ctx, "market/local-package-upload-cancel", (uploadId) =>
        ctx.installer.cancelLocalPackageUpload(uploadId),
    );
}
