import { IUser, UserRole } from '../types';
import User from '../models/user.model';
import { BaseRepository } from './base.repository';

class UserRepository extends BaseRepository<IUser> {
    constructor() {
        super(User);
    }

    async findByEmail(email: string): Promise<IUser | null> {
        return await this.model.findOne({ email: email.trim().toLowerCase() }).select('+password').exec();
    }

    async findByUsername(username: string): Promise<IUser | null> {
        return await this.model.findOne({ username: username.trim() }).select('+password').exec();
    }

    /** Login: match normalized digits on either field (username is canonical; phone covers legacy rows). */
    async findByUsernameOrPhone(digits: string): Promise<IUser | null> {
        const d = digits.trim();
        return await this.model
            .findOne({
                $or: [{ username: d }, { phone: d }],
            })
            .select('+password')
            .exec();
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

    async updateLastLogin(userId: string): Promise<void> {
        await this.model.findByIdAndUpdate(userId, { lastLogin: new Date() }).exec();
    }

    async clearRefreshToken(userId: string): Promise<void> {
        await this.model.findByIdAndUpdate(userId, { refreshToken: null }).exec();
    }
}

export default new UserRepository();
