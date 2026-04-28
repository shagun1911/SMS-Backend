import { Model, Document, FilterQuery, UpdateQuery, Types } from 'mongoose';

export interface IBaseRepository<T extends Document> {
    create(data: Partial<T>): Promise<T>;
    findById(id: string): Promise<T | null>;
    findOne(filter: FilterQuery<T>): Promise<T | null>;
    find(filter: FilterQuery<T>, options?: any): Promise<T[]>;
    update(id: string, data: UpdateQuery<T>): Promise<T | null>;
    delete(id: string): Promise<T | null>;
    count(filter: FilterQuery<T>): Promise<number>;
}

export abstract class BaseRepository<T extends Document> implements IBaseRepository<T> {
    constructor(protected readonly model: Model<T>) { }

    async create(data: Partial<T>): Promise<T> {
        return (await this.model.create(data)) as T;
    }

    async findById(id: string): Promise<T | null> {
        return await this.model.findById(id).exec();
    }

    async findOne(filter: FilterQuery<T>): Promise<T | null> {
        return await this.model.findOne(filter).exec();
    }

    async find(filter: FilterQuery<T>, options: any = {}): Promise<T[]> {
        let query = this.model.find(filter);
        if (options.sort) query = query.sort(options.sort);
        if (options.limit) query = query.limit(options.limit);
        if (options.skip) query = query.skip(options.skip);
        return await query.exec();
    }

    async update(id: string, data: UpdateQuery<T>): Promise<T | null> {
        return await this.model
            .findByIdAndUpdate(id, data, { new: true, runValidators: true })
            .exec();
    }

    async delete(id: string): Promise<T | null> {
        // Soft delete if possible, otherwise hard delete
        // For this implementation, we'll assume hard delete unless overridden
        return await this.model.findByIdAndDelete(id).exec();
    }

    async count(filter: FilterQuery<T>): Promise<number> {
        return await this.model.countDocuments(filter).exec();
    }

    protected toObjectId(id: string): Types.ObjectId {
        return new Types.ObjectId(id);
    }

    getModel(): Model<T> {
        return this.model;
    }
}
