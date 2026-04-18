import { Types } from 'mongoose';
import User from '../models/user.model';
import School from '../models/school.model';
import Student from '../models/student.model';
import Session from '../models/session.model';
import Plan from '../models/plan.model';
import { UserRole, SubscriptionPlan, Board, Gender, StudentStatus } from '../types';
import { updateUsageForSchool } from '../services/usage.service';
import { normalizeStaffPhone } from './staffPhone';

/**
 * Seed initial administrative accounts and demo data if they don't exist
 */
export const seedSystem = async () => {
    try {
        // 1. Seed Super Admin
        const superAdminEmail = process.env.SUPER_ADMIN_EMAIL || 'superadmin@ssms.com';
        const existingSuperAdmin = await User.findOne({ role: UserRole.SUPER_ADMIN });

        if (!existingSuperAdmin) {
            console.log('🚀 Seeding initial Super Admin...');
            await User.create({
                name: 'SSMS Master Admin',
                email: superAdminEmail,
                password: process.env.SUPER_ADMIN_PASSWORD || 'SuperAdmin@2026',
                phone: normalizeStaffPhone(process.env.SUPER_ADMIN_PHONE || '+91 00000 00000'),
                role: UserRole.SUPER_ADMIN,
                isActive: true
            });
            console.log('✅ Super Admin created successfully');
        }

        // 2. Seed default plans (SaaS) – Free plan is default for every new school
        const planCount = await Plan.countDocuments();
        if (planCount === 0) {
            console.log('📋 Seeding default plans...');
            await Plan.insertMany([
                { name: 'Free', description: 'Default for new schools', maxStudents: 100, maxTeachers: 10, priceMonthly: 0, priceYearly: 0, features: ['Basic access'], isActive: true, isDefault: true },
                { name: 'Basic', maxStudents: 500, maxTeachers: 50, priceMonthly: 999, priceYearly: 9990, features: ['Basic support'], isActive: true, isDefault: false },
                { name: 'Standard', maxStudents: 1000, maxTeachers: 100, priceMonthly: 1999, priceYearly: 19990, features: ['Email support', 'Reports'], isActive: true, isDefault: false },
                { name: 'Premium', maxStudents: 1500, maxTeachers: 200, priceMonthly: 3999, priceYearly: 39990, features: ['Priority support', 'API access'], isActive: true, isDefault: false },
                { name: 'Enterprise', maxStudents: 2000, maxTeachers: 300, priceMonthly: 7999, priceYearly: 79990, features: ['Dedicated support', 'Custom limits'], isActive: true, isDefault: false },
            ]);
            console.log('✅ Default plans created (Free plan is default for new schools)');
        }
        // Ensure at least one plan is default (for existing DBs that may have no default)
        const defaultPlanExists = await Plan.findOne({ isDefault: true });
        if (!defaultPlanExists) {
            const freePlan = await Plan.findOne({ name: 'Free' }) || await Plan.findOne().sort({ priceMonthly: 1 });
            if (freePlan) {
                await Plan.updateMany({}, { isDefault: false });
                await Plan.findByIdAndUpdate(freePlan._id, { isDefault: true });
                console.log('✅ Default plan set for new school registration');
            }
        }

        // 3. Backfill usage for all schools
        const schools = await School.find().select('_id').lean();
        for (const s of schools) {
            await updateUsageForSchool((s as any)._id.toString());
        }

        // 4. Seed Demo School
        const demoSchoolEmail = 'demo@shagun.com';
        const existingSchool = await School.findOne({ email: demoSchoolEmail });

        if (!existingSchool) {
            console.log('🏢 Seeding demo school...');

            // Create Admin User First (to get ID)
            // But we need schoolId... chicken and egg.
            // In registerSchool service I used 'new' then saved.

            const schoolId = new Types.ObjectId();
            const adminId = new Types.ObjectId();

            const school = await School.create({
                _id: schoolId,
                schoolName: 'Shagun Public School',
                schoolCode: 'SPS01',
                email: demoSchoolEmail,
                phone: '+91 98765 43210',
                principalName: 'Dr. Ramesh Kumar',
                board: Board.CBSE,
                address: {
                    street: '123, Education Hub',
                    city: 'Bikaner',
                    state: 'Rajasthan',
                    pincode: '334402',
                    country: 'India'
                },
                classRange: { from: 'Nursery', to: '12th' },
                subscriptionPlan: SubscriptionPlan.PRO,
                isActive: true,
                settings: {
                    currency: 'INR',
                    dateFormat: 'DD/MM/YYYY',
                    timezone: 'Asia/Kolkata'
                },
                adminUserId: adminId
            });

            // 5. Seed active session for the school
            const session = await Session.create({
                schoolId: school._id,
                sessionYear: '2024-25',
                startDate: new Date('2024-04-01'),
                endDate: new Date('2025-03-31'),
                isActive: true
            });

            // 6. Seed School Admin
            const adminPhone = normalizeStaffPhone('+91 99999 88888');
            await User.create({
                _id: adminId,
                schoolId: school._id,
                name: 'SPS Admin',
                email: 'admin@sps.com',
                password: 'Admin@123',
                phone: adminPhone,
                username: adminPhone,
                role: UserRole.SCHOOL_ADMIN,
                isActive: true
            });

            // 7. Seed Staff
            const teacherPhone = normalizeStaffPhone('+91 77777 66666');
            await User.create({
                schoolId: school._id,
                name: 'Maya Sharma',
                email: 'maya@sps.com',
                password: 'Teacher@123',
                phone: teacherPhone,
                username: teacherPhone,
                role: UserRole.TEACHER,
                subject: 'Mathematics',
                isActive: true
            });

            // 8. Seed Students
            await Student.create([
                {
                    schoolId: school._id,
                    sessionId: session._id,
                    admissionNumber: 'SPS240001',
                    firstName: 'Aarav',
                    lastName: 'Singh',
                    fatherName: 'Vikram Singh',
                    motherName: 'Anjali Singh',
                    dateOfBirth: new Date('2015-05-12'),
                    gender: Gender.MALE,
                    phone: '+91 98989 89898',
                    address: { street: '45, Adarsh Nagar', city: 'Jaipur', state: 'Rajasthan', pincode: '302004' },
                    class: 'IV',
                    section: 'A',
                    status: StudentStatus.ACTIVE,
                    isActive: true
                },
                {
                    schoolId: school._id,
                    sessionId: session._id,
                    admissionNumber: 'SPS240002',
                    firstName: 'Ishita',
                    lastName: 'Sharma',
                    fatherName: 'Rahul Sharma',
                    motherName: 'Sunita Sharma',
                    dateOfBirth: new Date('2014-08-20'),
                    gender: Gender.FEMALE,
                    phone: '+91 87878 78787',
                    address: { street: '12, Malviya Nagar', city: 'Jaipur', state: 'Rajasthan', pincode: '302017' },
                    class: 'V',
                    section: 'B',
                    status: StudentStatus.ACTIVE,
                    isActive: true
                }
            ]);

            console.log('✅ Demo data seeded successfully');
        }
    } catch (error) {
        console.error('❌ Seeding failed:', error);
    }
};
