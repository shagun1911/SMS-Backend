import { Schema, model, Model } from 'mongoose';
import { IAdmissionEnquiry, EnquiryStatus, Gender } from '../types';

interface IAdmissionEnquiryModel extends Model<IAdmissionEnquiry> {}

const admissionEnquirySchema = new Schema<IAdmissionEnquiry, IAdmissionEnquiryModel>(
    {
        schoolId: {
            type: Schema.Types.ObjectId,
            ref: 'School',
            required: true,
        },
        studentName: {
            type: String,
            required: [true, 'Student name is required'],
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
        },
        gender: {
            type: String,
            enum: Object.values(Gender),
        },
        class: {
            type: String,
            required: [true, 'Class is required'],
        },
        section: {
            type: String,
            uppercase: true,
            trim: true,
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
        address: {
            street: { type: String, required: true },
            city: { type: String, required: true },
            state: { type: String, required: true },
            pincode: { type: String, required: true },
        },
        enquiryDate: {
            type: Date,
            default: Date.now,
        },
        status: {
            type: String,
            enum: Object.values(EnquiryStatus),
            default: EnquiryStatus.PENDING,
        },
        followUpDate: {
            type: Date,
        },
        notes: {
            type: String,
            trim: true,
        },
        referredBy: {
            type: String,
            trim: true,
        },
        previousSchool: {
            type: String,
            trim: true,
        },
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    }
);

// Indexes
admissionEnquirySchema.index({ schoolId: 1, enquiryDate: -1 });
admissionEnquirySchema.index({ schoolId: 1, status: 1 });
admissionEnquirySchema.index({ schoolId: 1, class: 1 });

const AdmissionEnquiry = model<IAdmissionEnquiry, IAdmissionEnquiryModel>('AdmissionEnquiry', admissionEnquirySchema);

export default AdmissionEnquiry;
