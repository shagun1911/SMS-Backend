import { Schema, model, Model } from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import config from '../config';
import { IStudent, Gender, BloodGroup, StudentStatus } from '../types';

interface IStudentModel extends Model<IStudent> { }

const studentSchema = new Schema<IStudent, IStudentModel>(
    {
        schoolId: {
            type: Schema.Types.ObjectId,
            ref: 'School',
            required: true,
        },
        admissionNumber: {
            type: String,
            required: true,
            trim: true,
            uppercase: true,
        },
        username: {
            type: String,
            trim: true,
            lowercase: true,
        },
        sessionId: {
            type: Schema.Types.ObjectId,
            ref: 'Session',
            required: true,
        },
        // Personal Information
        firstName: {
            type: String,
            required: [true, 'First name is required'],
            trim: true,
        },
        lastName: {
            type: String,
            required: [true, 'Last name is required'],
            trim: true,
        },
        fatherName: {
            type: String,
            required: [true, 'Father name is required'],
            trim: true,
        },
        motherName: {
            type: String,
            required: [true, 'Mother name is required'],
            trim: true,
        },
        dateOfBirth: {
            type: Date,
            required: [true, 'Date of birth is required'],
        },
        gender: {
            type: String,
            enum: Object.values(Gender),
            required: true,
        },
        bloodGroup: {
            type: String,
            enum: Object.values(BloodGroup),
        },
        photo: {
            type: String,
            default: 'default-student.png',
        },
        // Contact Information
        address: {
            street: { type: String, required: true },
            city: { type: String, required: true },
            state: { type: String, required: true },
            pincode: { type: String, required: true },
        },
        phone: {
            type: String,
            required: [true, 'Phone number is required'],
            trim: true,
        },
        alternatePhone: {
            type: String,
            trim: true,
        },
        email: {
            type: String,
            trim: true,
            lowercase: true,
        },
        // Academic Information
        class: {
            type: String,
            required: true,
        },
        section: {
            type: String,
            required: true,
            uppercase: true,
            trim: true,
        },
        rollNumber: {
            type: Number,
        },
        admissionDate: {
            type: Date,
            default: Date.now,
        },
        previousSchool: {
            type: String,
            trim: true,
        },
        // Documents
        tcSubmitted: {
            type: Boolean,
            default: false,
        },
        tcDocument: {
            type: String,
        },
        migrationSubmitted: {
            type: Boolean,
            default: false,
        },
        migrationDocument: {
            type: String,
        },
        birthCertificate: {
            type: String,
        },
        // Status & Metadata
        status: {
            type: String,
            enum: Object.values(StudentStatus),
            default: StudentStatus.ACTIVE,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        // Transport (Optional)
        usesTransport: {
            type: Boolean,
            default: false,
        },
        busId: {
            type: Schema.Types.ObjectId,
            ref: 'Bus',
        },
        totalYearlyFee: { type: Number, default: 0 },
        paidAmount: { type: Number, default: 0 },
        dueAmount: { type: Number, default: 0 },
        concessionAmount: { type: Number, default: 0 },
        initialDepositAmount: { type: Number, default: 0 },
        depositPaymentMode: { type: String, trim: true },
        depositDate: { type: Date },
        depositTransactionId: { type: String, trim: true },
        // Auth fields
        password: { type: String, select: false },
        plainPassword: { type: String },
        mustChangePassword: { type: Boolean, default: true },
        lastLogin: { type: Date, default: null },
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    }
);

// Indexes
// Ensure unique admission number per school
studentSchema.index({ schoolId: 1, admissionNumber: 1 }, { unique: true });
// Ensure unique username per school
studentSchema.index({ schoolId: 1, username: 1 }, { unique: true, sparse: true });
// Optimize class/section queries
studentSchema.index({ schoolId: 1, class: 1, section: 1 });
// Optimize active student queries
studentSchema.index({ schoolId: 1, status: 1 });

// Virtual for full name
studentSchema.virtual('fullName').get(function () {
    return `${this.firstName} ${this.lastName}`;
});

// Hash password before save
studentSchema.pre('save', async function (next) {
    if (!this.isModified('password') || !this.password) return next();
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
});

// Compare entered password with hashed password
studentSchema.methods.matchPassword = async function (enteredPassword: string): Promise<boolean> {
    if (!this.password) return false;
    return await bcrypt.compare(enteredPassword, this.password);
};

// Generate JWT for student — userType='student' distinguishes from staff tokens
studentSchema.methods.getSignedJwtToken = function (): string {
    return jwt.sign(
        { id: this._id.toString(), role: 'student', schoolId: this.schoolId?.toString(), userType: 'student' },
        config.jwt.accessSecret as any,
        { expiresIn: config.jwt.accessExpire as any }
    );
};

const Student = model<IStudent, IStudentModel>('Student', studentSchema);

export default Student;
