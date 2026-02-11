import jwt from 'jsonwebtoken';
import { IAuthTokens, IUser } from '../types';
import UserRepository from '../repositories/user.repository';
import ErrorResponse from '../utils/errorResponse';
import config from '../config';

class AuthService {
    /**
     * Register a new user
     */
    async register(userData: Partial<IUser>): Promise<{ user: IUser; tokens: IAuthTokens }> {
        const existingUser = await UserRepository.findByEmail(userData.email!);
        if (existingUser) {
            throw new ErrorResponse('Email already registered', 400);
        }

        const user = await UserRepository.create(userData);
        const tokens = this.generateAuthTokens(user);

        // Store refresh token
        await UserRepository.updateRefreshToken(user._id.toString(), tokens.refreshToken);

        return { user, tokens };
    }

    /**
     * Login with email and password
     */
    async login(email: string, password: string): Promise<{ user: IUser; tokens: IAuthTokens }> {
        const user = await UserRepository.findByEmail(email);
        if (!user) {
            throw new ErrorResponse('Invalid credentials', 401);
        }

        // Since we select('+password') in findByEmail, user has password field
        const isMatch = await (user as any).matchPassword(password);
        if (!isMatch) {
            throw new ErrorResponse('Invalid credentials', 401);
        }

        const tokens = this.generateAuthTokens(user);

        // Rotate refresh token
        await UserRepository.updateRefreshToken(user._id.toString(), tokens.refreshToken);

        // Update last login
        user.lastLogin = new Date();
        await user.save();

        return { user, tokens };
    }

    /**
     * Refresh access token
     */
    async refreshAuth(refreshToken: string): Promise<{ user: IUser; tokens: IAuthTokens }> {
        try {
            const decoded: any = jwt.verify(refreshToken, config.jwt.refreshSecret);
            const user = await UserRepository.findById(decoded.id);

            if (!user) {
                throw new ErrorResponse('User not found', 401);
            }

            if (config.env === 'production' && user.refreshToken !== refreshToken) { // Optional: enforce strict token matching
                // In strict mode, if refresh token doesn't match DB, it might be stolen/reused.
                // We could invalidate all tokens here for security.
                throw new ErrorResponse('Invalid refresh token', 401);
            }

            const tokens = this.generateAuthTokens(user);

            // Rotate refresh token
            await UserRepository.updateRefreshToken(user._id.toString(), tokens.refreshToken);

            return { user, tokens };
        } catch (error) {
            throw new ErrorResponse('Invalid refresh token', 401);
        }
    }

    /**
     * Logout user
     */
    async logout(userId: string): Promise<void> {
        await UserRepository.clearRefreshToken(userId);
    }

    /**
     * Generate Access and Refresh Tokens
     */
    private generateAuthTokens(user: IUser): IAuthTokens {
        const accessToken = (user as any).getSignedJwtToken();
        const refreshToken = (user as any).getRefreshToken();

        return { accessToken, refreshToken };
    }
}

export default new AuthService();
