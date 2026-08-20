export function sleep(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** 等待一个任务至多 timeout 毫秒，超时返回 false（不拒绝）。 */
export async function waitFor(task: Promise<unknown>, timeout: number) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            task.then(() => true),
            new Promise<boolean>((resolve) => {
                timer = setTimeout(() => resolve(false), timeout);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}
