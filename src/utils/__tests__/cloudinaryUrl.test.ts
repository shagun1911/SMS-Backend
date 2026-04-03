import { parseCloudinaryPublicIdFromUrl, isLikelyCloudinaryAssetUrl } from '../cloudinaryUrl';

describe('cloudinaryUrl', () => {
    it('parses public_id from versioned URL', () => {
        const url =
            'https://res.cloudinary.com/demo/image/upload/v1700000000/ssms/students/abc_xyz.jpg';
        expect(parseCloudinaryPublicIdFromUrl(url)).toBe('ssms/students/abc_xyz');
    });

    it('parses public_id without version segment', () => {
        const url = 'https://res.cloudinary.com/demo/image/upload/ssms/staff/photo.png';
        expect(parseCloudinaryPublicIdFromUrl(url)).toBe('ssms/staff/photo');
    });

    it('returns null for non-cloudinary URLs', () => {
        expect(parseCloudinaryPublicIdFromUrl('https://example.com/a.jpg')).toBeNull();
        expect(isLikelyCloudinaryAssetUrl('data:image/png;base64,AAA')).toBe(false);
    });
});
