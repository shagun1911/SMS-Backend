import { Schema, model, Model } from 'mongoose';
import { ISchool, SubscriptionPlan, Board } from '../types';

interface ISchoolModel extends Model<ISchool> { }

const schoolSchema = new Schema<ISchool, ISchoolModel>(
    {
        schoolName: {
            type: String,
            required: [true, 'Please add a school name'],
            trim: true,
            unique: true,
        },
        schoolCode: {
            type: String,
            required: [true, 'Please add a school code'],
            unique: true,
            maxlength: 10,
        },
        email: {
            type: String,
            match: [
                /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
                'Please add a valid email',
            ],
            required: true,
        },
        phone: {
            type: String,
            maxlength: 20,
            required: true,
        },
        logo: {
            type: String,
            default: 'no-photo.jpg',
        },
        stamp: { type: String },
        principalSignature: { type: String },
        address: {
            street: { type: String, required: true },
            city: { type: String, required: true },
            state: { type: String, required: true },
            pincode: { type: String, required: true },
            country: { type: String, required: true },
        },
        principalName: {
            type: String,
            required: true,
        },
        board: {
            type: String,
            enum: Object.values(Board),
            required: true,
        },
        classRange: {
            from: { type: String, required: true },
            to: { type: String, required: true },
        },
        sessionStartMonth: {
            type: String,
            default: 'April',
        },
        subscriptionPlan: {
            type: String,
            enum: Object.values(SubscriptionPlan),
            default: SubscriptionPlan.FREE,
        },
        subscriptionExpiry: {
            type: Date,
        },
        studentLimit: {
            type: Number,
            default: 500,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        settings: {
            currency: { type: String, default: 'INR' },
            dateFormat: { type: String, default: 'DD/MM/YYYY' },
            timezone: { type: String, default: 'Asia/Kolkata' },
        },
        adminUserId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    }
);



const School = model<ISchool, ISchoolModel>('School', schoolSchema);

export default School;
