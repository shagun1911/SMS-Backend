import { Response } from 'express';

interface PaginationResult<T> {
    data: T[];
    pagination: {
        total: number;
        pages: number;
        page: number;
        limit: number;
        next?: number;
        prev?: number;
    };
}

export const paginate = <T>(
    data: T[],
    count: number,
    page: number,
    limit: number
): PaginationResult<T> => {
    const totalPages = Math.ceil(count / limit);
    const pagination: any = {
        total: count,
        pages: totalPages,
        page: page,
        limit: limit,
    };

    if (page < totalPages) pagination.next = page + 1;
    if (page > 1) pagination.prev = page - 1;

    return {
        data,
        pagination,
    };
};

export const sendResponse = <T>(
    res: Response,
    data: T,
    message: string = 'Success',
    statusCode: number = 200,
    meta?: any
) => {
    res.status(statusCode).json({
        success: true,
        message,
        data,
        meta,
    });
};
