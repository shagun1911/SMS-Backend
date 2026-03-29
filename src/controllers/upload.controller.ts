import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { uploadToCloudinary } from '../utils/cloudinary';
import { sendResponse } from '../utils/response';
import ErrorResponse from '../utils/errorResponse';
import config from '../config';

class UploadController {
    async uploadImage(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            if (!req.file) {
                return next(new ErrorResponse('Please upload a file', 400));
            }

            let result;
            const hasCloudinary = (config.cloudinary.accounts?.length ?? 0) > 0
                || (config.cloudinary.cloudName && config.cloudinary.cloudName !== 'your_cloud_name');
            if (hasCloudinary) {
                const folder = req.query.folder ? `ssms/${req.query.folder}` : 'ssms/uploads';
                result = await uploadToCloudinary(req.file.buffer, folder);
            } else {
                // Fallback to local data URL for demo if Cloudinary not configured
                // Or you could save to disk, but DataURL is easiest for instant preview without static serving setup
                const b64 = Buffer.from(req.file.buffer).toString('base64');
                const dataURI = `data:${req.file.mimetype};base64,${b64}`;
                result = { url: dataURI, publicId: 'local_demo' };
            }

            sendResponse(res, result, 'Image uploaded successfully', 200);
        } catch (error) {
            next(error);
        }
    }

    /** POST /upload/homework — homework attachment (image, PDF, Word) via Cloudinary */
    async uploadHomework(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            if (!req.file) {
                return next(new ErrorResponse('Please upload a file', 400));
            }

            if (!config.cloudinary.isConfigured) {
                return next(
                    new ErrorResponse(
                        'Homework file uploads require Cloudinary. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET on the server (e.g. Render environment).',
                        503
                    )
                );
            }

            const folder = 'ssms/homework';
            const result = await uploadToCloudinary(req.file.buffer, folder);

            sendResponse(
                res,
                {
                    ...result,
                    filename: req.file.originalname || 'file',
                    mimeType: req.file.mimetype,
                },
                'File uploaded successfully',
                200
            );
        } catch (error) {
            next(error);
        }
    }
}

export default new UploadController();
