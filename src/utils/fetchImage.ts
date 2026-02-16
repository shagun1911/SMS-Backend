/**
 * Fetch image from URL and return as Buffer for use in PDFKit.
 * Returns null if URL is invalid or fetch fails.
 */
export async function fetchImageBuffer(url: string | undefined | null): Promise<Buffer | null> {
    if (!url || typeof url !== 'string') return null;
    const trimmed = url.trim();
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) return null;
    try {
        const res = await fetch(trimmed, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) return null;
        const arr = await res.arrayBuffer();
        return Buffer.from(arr);
    } catch {
        return null;
    }
}
