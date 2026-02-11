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

export default upload;
