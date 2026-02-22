import School from '../models/school.model';
import User from '../models/user.model';
import Plan from '../models/plan.model';
import SchoolSubscription from '../models/schoolSubscription.model';
import { ISchool, IUser, UserRole, SubscriptionPlan } from '../types';
import ErrorResponse from '../utils/errorResponse';


class SchoolService {
    /**
     * Register a new school and its admin
     */
    async registerSchool(schoolData: Partial<ISchool>, adminData: Partial<IUser>): Promise<{ school: ISchool; admin: IUser }> {
        const session = await School.startSession();
        session.startTransaction();

        try {
            // 1. Check if school code or email already exists
            const existingSchool = await School.findOne({
                $or: [{ schoolCode: schoolData.schoolCode }, { email: schoolData.email }, { schoolName: schoolData.schoolName }]
            }).session(session);

            if (existingSchool) {
                throw new ErrorResponse('School with this name, code or email already exists', 400);
            }

            // 2. Check if admin email exists
            const existingUser = await User.findOne({ email: adminData.email }).session(session);
            if (existingUser) {
                throw new ErrorResponse('Admin email already registered', 400);
            }

            // 3. Create School Placeholder (to get ID)
            const school = new School({
                ...schoolData,
                isActive: true,
                subscriptionPlan: SubscriptionPlan.FREE,
                studentLimit: 50,
            });

            // 4. Create School Admin User
            const admin = new User({
                ...adminData,
                schoolId: school._id,
                role: UserRole.SCHOOL_ADMIN,
                isActive: true,
            });

            // 5. Link admin to school
            school.adminUserId = admin._id;

            // 6. Save both
            await school.save({ session });
            await admin.save({ session });

            await session.commitTransaction();

            // 7. Assign default plan if one is set (outside transaction)
            const defaultPlan = await Plan.findOne({ isDefault: true });
            if (defaultPlan && school._id) {
                const start = new Date();
                const end = new Date();
                end.setFullYear(end.getFullYear() + 1);
                await SchoolSubscription.create({
                    schoolId: school._id,
                    planId: defaultPlan._id,
                    subscriptionStart: start,
                    subscriptionEnd: end,
                    status: 'active',
                });
            }

            return { school, admin };
        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    }

    /**
     * Get school details
     */
    async getSchoolById(id: string): Promise<ISchool> {
        const school = await School.findById(id);
        if (!school) {
            throw new ErrorResponse('School not found', 404);
        }
        return school;
    }

    /**
     * Update school details
     */
    async updateSchool(id: string, updateData: Partial<ISchool>): Promise<ISchool> {
        const school = await School.findByIdAndUpdate(id, updateData, {
            new: true,
            runValidators: true,
        });

        if (!school) {
            throw new ErrorResponse('School not found', 404);
        }

        return school;
    }
}

export default new SchoolService();
