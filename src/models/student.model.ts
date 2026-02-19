import { Schema, model, Model } from 'mongoose';
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
        initialDepositAmount: { type: Number, default: 0 },
        depositPaymentMode: { type: String, trim: true },
        depositDate: { type: Date },
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
// Optimize class/section queries
studentSchema.index({ schoolId: 1, class: 1, section: 1 });
// Optimize active student queries
studentSchema.index({ schoolId: 1, status: 1 });

// Virtual for full name
studentSchema.virtual('fullName').get(function () {
    return `${this.firstName} ${this.lastName}`;
});

const Student = model<IStudent, IStudentModel>('Student', studentSchema);

export default Student;
