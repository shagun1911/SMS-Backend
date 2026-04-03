/**
 * Extract Cloudinary public_id from a typical secure URL.
 * Example: https://res.cloudinary.com/<cloud>/image/upload/v123/ssms/students/abc.jpg → ssms/students/abc
 */
export function parseCloudinaryPublicIdFromUrl(url: string): string | null {
    if (!url || typeof url !== 'string') return null;
    if (!/cloudinary\.com/i.test(url)) return null;
    const m = url.match(/\/upload\/(?:v\d+\/)?([^?]+)$/i);
    if (!m?.[1]) return null;
    return m[1].replace(/\.(jpe?g|png|gif|webp|pdf)$/i, '');
}

export function isLikelyCloudinaryAssetUrl(url?: string | null): boolean {
    if (!url || typeof url !== 'string') return false;
    if (url.startsWith('data:')) return false;
    return /cloudinary\.com/i.test(url);
}
