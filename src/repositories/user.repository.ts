import { IUser, UserRole } from '../types';
import User from '../models/user.model';
import { BaseRepository } from './base.repository';

class UserRepository extends BaseRepository<IUser> {
    constructor() {
        super(User);
    }

    async findByEmail(email: string): Promise<IUser | null> {
        return await this.model.findOne({ email }).select('+password').exec();
    }

    async findBySchool(schoolId: string, role?: UserRole): Promise<IUser[]> {
        const query: any = { schoolId };
        if (role) {
            query.role = role;
        }
        return await this.find(query);
    }

    async updateRefreshToken(userId: string, refreshToken: string): Promise<void> {
        await this.model.findByIdAndUpdate(userId, { refreshToken }).exec();
    }

    async clearRefreshToken(userId: string): Promise<void> {
        await this.model.findByIdAndUpdate(userId, { refreshToken: null }).exec();
    }
}

export default new UserRepository();
