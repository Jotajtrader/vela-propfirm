/** `money()` del HTML: `-$1,234` sin decimales. */
export function money(x: number): string {
    const s = x < 0 ? '-' : '';
    return `${s}$${Math.abs(x).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}
