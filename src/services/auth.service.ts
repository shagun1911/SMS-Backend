import jwt from 'jsonwebtoken';
import { IAuthTokens, IUser, UserRole } from '../types';
import UserRepository from '../repositories/user.repository';
import ErrorResponse from '../utils/errorResponse';
import config from '../config';
import {
    isValidStaffPhoneDigits,
    isMongoDuplicateUsernameError,
    normalizeStaffPhone,
    parseAndValidateStaffPhone,
} from '../utils/staffPhone';

class AuthService {
    /**
     * Register a new user
     */
    async register(userData: Partial<IUser>): Promise<{ user: IUser; tokens: IAuthTokens }> {
        const existingUser = await UserRepository.findByEmail(userData.email!);
        if (existingUser) {
            throw new ErrorResponse('Email already registered', 400);
        }

        if (userData.role === UserRole.SUPER_ADMIN) {
            const raw = userData.phone;
            if (raw != null && String(raw).trim() !== '') {
                userData.phone = parseAndValidateStaffPhone(String(raw));
            } else {
                delete (userData as Partial<IUser>).phone;
            }
        } else if (userData.schoolId) {
            const p = parseAndValidateStaffPhone(userData.phone || '');
            userData.phone = p;
            userData.username = p;
            const taken = await UserRepository.findByUsername(p);
            if (taken) {
                throw new ErrorResponse('This phone number is already registered', 400);
            }
        }

        let user: IUser;
        try {
            user = await UserRepository.create(userData);
        } catch (err) {
            if (isMongoDuplicateUsernameError(err)) {
                throw new ErrorResponse('This phone number is already registered', 409);
            }
            throw err;
        }
        const tokens = this.generateAuthTokens(user);

        // Store refresh token
        await UserRepository.updateRefreshToken(user._id.toString(), tokens.refreshToken);

        return { user, tokens };
    }

    /**
     * Login: Master + school web portals use email only.
     * Mobile staff (`portal` teacher | transport): phone (username) or email, same as admin “Login (mobile)” credentials.
     */
    async login(
        identifier: string,
        password: string,
        portal?: string
    ): Promise<{ user: IUser; tokens: IAuthTokens }> {
        const trimmed = (identifier || '').trim();
        if (!trimmed) {
            throw new ErrorResponse('Invalid credentials', 401);
        }

        const emailOnlyPortal = portal === 'master' || portal === 'school';
        let user: IUser | null = null;

        if (emailOnlyPortal) {
            if (!trimmed.includes('@')) {
                throw new ErrorResponse(
                    'Sign in with your registered email address and password',
                    400
                );
            }
            user = await UserRepository.findByEmail(trimmed);
        } else if (trimmed.includes('@')) {
            user = await UserRepository.findByEmail(trimmed);
        } else {
            const phoneDigits = normalizeStaffPhone(trimmed);
            if (isValidStaffPhoneDigits(phoneDigits)) {
                user = await UserRepository.findByUsernameOrPhone(phoneDigits);
            }
            if (!user) {
                user = await UserRepository.findByEmail(trimmed.toLowerCase());
            }
        }

        if (!user) {
            throw new ErrorResponse('Invalid credentials', 401);
        }

        const pwdTry = typeof password === 'string' ? password : String(password ?? '');
        const pwdTrimmed = pwdTry.trim();

        let isMatch = false;
        try {
            isMatch = await (user as any).matchPassword(pwdTry);
            if (!isMatch && pwdTrimmed !== pwdTry && pwdTrimmed.length >= 6) {
                isMatch = await (user as any).matchPassword(pwdTrimmed);
            }
        } catch {
            // matchPassword can throw if stored value is not a valid bcrypt hash
        }
        // One-time fix: if DB has plain-text password (e.g. from manual insert), accept and re-hash
        if (!isMatch && (user as any).password === pwdTry) {
            (user as any).password = password;
            await (user as any).save(); // pre-save hook will hash it
            isMatch = true;
        }
        if (!isMatch && pwdTrimmed !== pwdTry && (user as any).password === pwdTrimmed) {
            (user as any).password = pwdTrimmed;
            await (user as any).save();
            isMatch = true;
        }
        if (!isMatch) {
            throw new ErrorResponse('Invalid credentials', 401);
        }

        const tokens = this.generateAuthTokens(user);

        // Rotate refresh token
        await UserRepository.updateRefreshToken(user._id.toString(), tokens.refreshToken);

        // Avoid full document save() here — legacy super-admin rows may have empty/invalid phone;
        // lastLogin update does not need to re-run validators on the whole user.
        await UserRepository.updateLastLogin(user._id.toString());
        (user as IUser).lastLogin = new Date();

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
