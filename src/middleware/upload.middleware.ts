import multer from 'multer';
import path from 'path';
import ErrorResponse from '../utils/errorResponse';
import config from '../config';

// Memory storage is better for direct Cloudinary uploads via Buffer
const storage = multer.memoryStorage();

const upload = multer({
    storage,
    limits: {
        fileSize: config.upload.maxFileSize, // Default 5MB
    },
    fileFilter: (_req, file, cb) => {
        const filetypes = /jpeg|jpg|png|webp/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new ErrorResponse('Error: Only images (jpeg, jpg, png, webp) are allowed!', 400) as any);
    },
});

const HOMEWORK_MAX = 15 * 1024 * 1024; // 15MB for PDF / Word

/** Homework attachments: images, PDF, Word (.doc / .docx) */
export const uploadHomeworkFile = multer({
    storage,
    limits: { fileSize: HOMEWORK_MAX },
    fileFilter: (_req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase();
        const allowedExt = ['.jpg', '.jpeg', '.png', '.webp', '.pdf', '.doc', '.docx'];
        const okExt = allowedExt.includes(ext);
        const okMime = [
            'image/jpeg',
            'image/png',
            'image/webp',
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ].includes(file.mimetype);
        if (okMime || okExt) return cb(null, true);
        cb(
            new ErrorResponse(
                'Allowed files: JPEG, PNG, WebP, PDF, Word (.doc, .docx)',
                400
            ) as any
        );
    },
});

export default upload;
