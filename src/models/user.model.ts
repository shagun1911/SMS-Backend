import { Schema, model, Model } from 'mongoose';
import { IUser, UserRole } from '../types';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import config from '../config';

interface IUserModel extends Model<IUser> {
    // Add static methods here if needed
    findByEmail(email: string): Promise<IUser | null>;
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
        email: {
            type: String,
            required: [true, 'Please add an email'],
            unique: true,
            lowercase: true,
            trim: true,
            match: [
                /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
                'Please add a valid email',
            ],
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
            required: [true, 'Please add a phone number'],
            trim: true,
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
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    }
);

// Indexes
userSchema.index({ schoolId: 1, role: 1 }); // Essential for finding staff by role within a school

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

const User = model<IUser, IUserModel>('User', userSchema);

export default User;
