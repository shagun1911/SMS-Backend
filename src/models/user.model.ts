import { Schema, model, Model } from 'mongoose';
import { IUser, UserRole } from '../types';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import config from '../config';

interface IUserModel extends Model<IUser> {
    findByEmail(email: string): Promise<IUser | null>;
    findByUsername(username: string): Promise<IUser | null>;
}

const userSchema = new Schema<IUser, IUserModel>(
    {
        schoolId: {
            type: Schema.Types.ObjectId,
            ref: 'School',
            required: function (this: IUser) {
                return this.role !== UserRole.SUPER_ADMIN;
            },
        },
        name: {
            type: String,
            required: [true, 'Please add a name'],
            trim: true,
        },
        /** Required for super admin and school admin; optional for other school staff (login may use phone). */
        email: {
            type: String,
            required: function (this: IUser) {
                return (
                    this.role === UserRole.SUPER_ADMIN || this.role === UserRole.SCHOOL_ADMIN
                );
            },
            unique: true,
            sparse: true,
            lowercase: true,
            trim: true,
            validate: {
                validator: function (this: IUser, v: string) {
                    if (
                        this.role === UserRole.SUPER_ADMIN ||
                        this.role === UserRole.SCHOOL_ADMIN
                    ) {
                        return /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(v || '');
                    }
                    if (v == null || v === '') return true;
                    return /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(v);
                },
                message: 'Please add a valid email',
            },
        },
        /** School staff: normalized digits only; unique globally; login identifier. Super admin: omit. */
        username: {
            type: String,
            trim: true,
            sparse: true,
            unique: true,
            match: [/^\d{10,15}$/, 'Username must be 10–15 digits'],
        },
        password: {
            type: String,
            required: [true, 'Please add a password'],
            minlength: 6,
            select: false, // Don't return password by default
        },
        plainPassword: {
            type: String, // Store for admin visibility
        },
        phone: {
            type: String,
            trim: true,
            /** Master console: optional. School staff (including school admin): required as 10–15 digits. */
            required: function (this: IUser) {
                return this.role !== UserRole.SUPER_ADMIN;
            },
            validate: {
                validator: function (this: IUser, v: unknown) {
                    const s = v == null ? '' : String(v).trim();
                    if (this.role === UserRole.SUPER_ADMIN) {
                        if (!s) return true;
                        return /^\d{10,15}$/.test(s);
                    }
                    if (!s) return false;
                    return /^\d{10,15}$/.test(s);
                },
                message: 'Phone must be stored as 10–15 digits (normalized)',
            },
        },
        role: {
            type: String,
            enum: Object.values(UserRole),
            default: UserRole.TEACHER,
        },
        staffRoleTitle: {
            type: String,
            trim: true,
            maxlength: 120,
        },
        photo: {
            type: String, // Cloudinary URL
            default: 'no-photo.jpg',
        },
        // Teacher specific
        subject: {
            type: String,
            trim: true,
        },
        qualification: {
            type: String,
            trim: true,
        },
        joiningDate: {
            type: Date,
            default: null,
        },
        baseSalary: {
            type: Number,
            default: 0,
        },
        totalAbsentCount: {
            type: Number,
            default: 0,
        },
        // Metadata
        isActive: {
            type: Boolean,
            default: true,
        },
        lastLogin: {
            type: Date,
            default: null,
        },
        mustChangePassword: {
            type: Boolean,
            default: false,
        },
        /** Teacher-only: granted by school admin. e.g. edit_timetable, manage_announcements, view_transport */
        permissions: {
            type: [String],
            default: [],
        },
        refreshToken: {
            type: String,
            select: false,
        },
        fcmTokens: {
            type: [String],
            default: [],
        },
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    }
);

// Indexes
userSchema.index({ schoolId: 1, role: 1 }); // Essential for finding staff by role within a school
userSchema.index({ schoolId: 1, isActive: 1, role: 1, joiningDate: 1 }); // Payroll eligibility scan

// Encrypt password using bcrypt
// eslint-disable-next-line @typescript-eslint/no-explicit-any
userSchema.pre('save', async function (this: any, next: any) {
    if (!this.isModified('password')) {
        return next();
    }

    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
});


// Match user entered password tohashed password in database
userSchema.methods.matchPassword = async function (enteredPassword: string): Promise<boolean> {
    return await bcrypt.compare(enteredPassword, this.password);
};

// Generate and hash password token
userSchema.methods.getSignedJwtToken = function (): string {
    // Access Token
    return jwt.sign(
        { id: this._id.toString(), role: this.role, schoolId: this.schoolId?.toString() },
        config.jwt.accessSecret as jwt.Secret,
        {
            expiresIn: config.jwt.accessExpire as jwt.SignOptions['expiresIn'],
        }
    );
};

// Generate Refresh Token
userSchema.methods.getRefreshToken = function (): string {
    // Refresh Token
    return jwt.sign({ id: this._id.toString() }, config.jwt.refreshSecret as jwt.Secret, {
        expiresIn: config.jwt.refreshExpire as jwt.SignOptions['expiresIn'],
    });
};

userSchema.statics.findByEmail = function (email: string) {
    return this.findOne({ email: (email || '').trim().toLowerCase() }).select('+password').exec();
};

userSchema.statics.findByUsername = function (username: string) {
    return this.findOne({ username: (username || '').trim() }).select('+password').exec();
};

const User = model<IUser, IUserModel>('User', userSchema);

export default User;
