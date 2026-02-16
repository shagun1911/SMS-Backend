import { Schema, model, Model } from 'mongoose';
import { Types } from 'mongoose';

export type SubscriptionStatus = 'active' | 'expired' | 'suspended';

export interface ISchoolSubscription {
    schoolId: Types.ObjectId;
    planId: Types.ObjectId;
    subscriptionStart: Date;
    subscriptionEnd: Date;
    status: SubscriptionStatus;
    createdAt: Date;
    updatedAt: Date;
}

interface ISchoolSubscriptionModel extends Model<ISchoolSubscription> {}

const schoolSubscriptionSchema = new Schema<ISchoolSubscription, ISchoolSubscriptionModel>(
    {
        schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, unique: true },
        planId: { type: Schema.Types.ObjectId, ref: 'Plan', required: true },
        subscriptionStart: { type: Date, required: true },
        subscriptionEnd: { type: Date, required: true },
        status: {
            type: String,
            enum: ['active', 'expired', 'suspended'],
            default: 'active',
        },
    },
    { timestamps: true }
);

schoolSubscriptionSchema.index({ schoolId: 1 });
schoolSubscriptionSchema.index({ status: 1 });

export default model<ISchoolSubscription, ISchoolSubscriptionModel>(
    'SchoolSubscription',
    schoolSubscriptionSchema
);
