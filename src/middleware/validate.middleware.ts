import { Request, Response, NextFunction } from 'express';
import { ZodError, ZodTypeAny } from 'zod';
import ErrorResponse from '../utils/errorResponse';

export const validate = (schema: ZodTypeAny) => {
    return async (req: Request, _res: Response, next: NextFunction) => {
        try {
            await schema.parseAsync({
                body: req.body,
                query: req.query,
                params: req.params,
            });
            return next();
        } catch (error: any) {
            if (error instanceof ZodError) {
                const message = error.issues.map((issue: any) => `${issue.path.join('.')}: ${issue.message}`).join(', ');
                return next(new ErrorResponse(message, 400));
            }
            return next(error);
        }
    };
};
