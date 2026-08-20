export function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

export function finiteNumber(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
}
