import { v2 as cloudinary } from 'cloudinary';
import config from '../config';

export interface UploadResult {
    url: string;
    publicId: string;
    /** Index of the Cloudinary account used (for delete). Omit when using single account. */
    cloudKey?: number;
}

/**
 * Upload to Cloudinary. Tries each configured account in order; when one fails (e.g. storage full), tries the next.
 */
export const uploadToCloudinary = async (
    fileBuffer: Buffer,
    folder: string = 'ssms/general'
): Promise<UploadResult> => {
    const accounts = config.cloudinary.accounts?.length
        ? config.cloudinary.accounts
        : config.cloudinary.cloudName && config.cloudinary.apiKey
            ? [{ cloudName: config.cloudinary.cloudName, apiKey: config.cloudinary.apiKey, apiSecret: config.cloudinary.apiSecret }]
            : [];

    if (accounts.length === 0) {
        throw new Error('No Cloudinary account configured');
    }

    let lastError: Error | null = null;
    for (let i = 0; i < accounts.length; i++) {
        const cred = accounts[i];
        if (!cred.cloudName || !cred.apiKey || !cred.apiSecret) continue;
        cloudinary.config({
            cloud_name: cred.cloudName,
            api_key: cred.apiKey,
            api_secret: cred.apiSecret,
        });
        try {
            const result = await new Promise<{ secure_url: string; public_id: string }>((resolve, reject) => {
                const uploadStream = cloudinary.uploader.upload_stream(
                    { folder, resource_type: 'auto' },
                    (error, result) => {
                        if (error) return reject(error);
                        if (!result) return reject(new Error('Cloudinary upload failed: No result'));
                        resolve({ secure_url: result.secure_url, public_id: result.public_id });
                    }
                );
                uploadStream.end(fileBuffer);
            });
            if (accounts.length > 1 && i > 0) {
                console.log(`[Cloudinary] Account 0 failed, used account ${i} (${cred.cloudName})`);
            }
            return {
                url: result.secure_url,
                publicId: result.public_id,
                cloudKey: accounts.length > 1 ? i : undefined,
            };
        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            const msg = String((err as any)?.message || err);
            if (/quota|storage|limit|full/i.test(msg) && i < accounts.length - 1) {
                console.warn(`[Cloudinary] Account ${i} (${cred.cloudName}) failed:`, msg, '→ trying next');
                continue;
            }
            throw err;
        }
    }
    throw lastError || new Error('Cloudinary upload failed');
};

/**
 * Delete from Cloudinary. Pass cloudKey if the asset was uploaded with a multi-account config.
 */
export const deleteFromCloudinary = async (publicId: string, cloudKey?: number): Promise<void> => {
    const accounts = config.cloudinary.accounts?.length
        ? config.cloudinary.accounts
        : config.cloudinary.cloudName && config.cloudinary.apiKey
            ? [{ cloudName: config.cloudinary.cloudName, apiKey: config.cloudinary.apiKey, apiSecret: config.cloudinary.apiSecret }]
            : [];
    const idx = cloudKey ?? 0;
    const cred = accounts[idx];
    if (!cred) return;
    cloudinary.config({
        cloud_name: cred.cloudName,
        api_key: cred.apiKey,
        api_secret: cred.apiSecret,
    });
    try {
        await cloudinary.uploader.destroy(publicId);
    } catch (error) {
        console.error('[Cloudinary] Delete error:', error);
    }
};

export default cloudinary;
