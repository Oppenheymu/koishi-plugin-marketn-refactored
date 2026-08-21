import type { Context } from "koishi";
import { assertContract } from "../contracts.js";

/** 本地 .tgz 上传类 listener：分块上传会话的 start/chunk/finish/commit/cancel。 */
export function registerUploadListeners(ctx: Context) {
    ctx.console.addListener(
        "market/local-package-upload-start",
        async (request) => {
            assertContract("market/local-package-upload-start", request);
            return ctx.installer.startLocalPackageUpload(request);
        },
        { authority: 4 },
    );

    ctx.console.addListener(
        "market/local-package-upload-chunk",
        async (request) => {
            assertContract("market/local-package-upload-chunk", request);
            return ctx.installer.appendLocalPackageUpload(request);
        },
        { authority: 4 },
    );

    ctx.console.addListener(
        "market/local-package-upload-finish",
        async (request) => {
            assertContract("market/local-package-upload-finish", request);
            return ctx.installer.finishLocalPackageUpload(request);
        },
        { authority: 4 },
    );

    ctx.console.addListener(
        "market/local-package-upload-commit",
        async (uploadId) => {
            assertContract("market/local-package-upload-commit", uploadId);
            return ctx.installer.commitLocalPackageUpload(uploadId);
        },
        { authority: 4 },
    );

    ctx.console.addListener(
        "market/local-package-upload-cancel",
        async (uploadId) => {
            assertContract("market/local-package-upload-cancel", uploadId);
            return ctx.installer.cancelLocalPackageUpload(uploadId);
        },
        { authority: 4 },
    );
}
