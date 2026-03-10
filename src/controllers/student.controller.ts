import { Response, NextFunction } from 'express';
import StudentService from '../services/student.service';
import FeeService from '../services/fee.service';
import PromotionService from '../services/promotion.service';
import { checkStudentLimit } from '../services/planLimit.service';
import { AuthRequest } from '../types';
import Student from '../models/student.model';
import School from '../models/school.model';
import Session from '../models/session.model';
import { sendResponse } from '../utils/response';
import ErrorResponse from '../utils/errorResponse';
import { generateIdCardPDF } from '../services/pdfIdCard.service';

class StudentController {
    /**
     * Create Student (with optional initial deposit: creates first receipt and updates paidAmount/dueAmount)
     */
    async createStudent(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            await checkStudentLimit(req.schoolId!);
            const student = await StudentService.createStudent(req.schoolId!, req.body);
            const initialDeposit = Number(req.body.initialDepositAmount) || 0;
            if (initialDeposit > 0) {
                await FeeService.processInitialDeposit(req.schoolId!, student, {
                    initialDepositAmount: initialDeposit,
                    paymentMode: req.body.paymentMode || req.body.depositPaymentMode || 'cash',
                    depositDate: req.body.depositDate ? new Date(req.body.depositDate) : undefined,
                    transactionId: req.body.depositTransactionId,
                    staffId: req.user!._id.toString(),
                    concessionAmount: Number(req.body.concessionAmount) || 0,
                });
                const updated = await StudentService.getStudent(req.schoolId!, student._id.toString());
                res.status(201).json({ success: true, data: updated });
                return;
            }
            res.status(201).json({
                success: true,
                data: student,
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Get all students with filters
     */
    async getStudents(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { page, limit, search, class: className, section, status } = req.query;

            const result = await StudentService.listStudents(req.schoolId!, {
                page: parseInt(page as string) || 1,
                limit: parseInt(limit as string) || 50,
                search: search as string,
                class: className as string,
                section: section as string,
                status: status as string,
            });

            res.status(200).json({
                success: true,
                data: result.students,
                pagination: {
                    total: result.total,
                    pages: result.pages,
                    page: parseInt(page as string) || 1,
                    limit: parseInt(limit as string) || 50,
                },
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Get single student
     */
    async getStudent(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const student = await StudentService.getStudent(req.schoolId!, req.params.id);

            res.status(200).json({
                success: true,
                data: student,
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Update student
     */
    async updateStudent(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const student = await StudentService.updateStudent(req.schoolId!, req.params.id, req.body);

            res.status(200).json({
                success: true,
                data: student,
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Bulk import students (JSON array from CSV parse)
     */
    async importStudents(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const rows = Array.isArray(req.body) ? req.body : req.body?.rows || [];
            const created: any[] = [];
            const errors: { row: number; message: string }[] = [];
            for (let i = 0; i < rows.length; i++) {
                try {
                    const row = rows[i];

                    // Handle address mapping: Frontend sends nested object, backend reconstruction was wiping it
                    const addressData = typeof row.address === 'object' ? row.address : {};
                    const street = row.street || addressData.street || row.address || '';
                    const city = row.city || addressData.city || '';
                    const state = row.state || addressData.state || '';
                    const pincode = row.pincode || addressData.pincode || '';

                    const student = await StudentService.createStudent(req.schoolId!, {
                        firstName: row.firstName || row.first_name,
                        lastName: row.lastName || row.last_name,
                        fatherName: row.fatherName || row.father_name || '',
                        motherName: row.motherName || row.mother_name || '',
                        dateOfBirth: row.dateOfBirth ? new Date(row.dateOfBirth) : new Date(),
                        gender: row.gender ? (row.gender.charAt(0).toUpperCase() + row.gender.slice(1).toLowerCase()) : 'Male',
                        class: row.class || row.className || 'I',
                        section: (row.section || 'A').toString().toUpperCase(),
                        rollNumber: row.rollNumber ?? row.roll_number,
                        phone: row.phone || row.fatherPhone || '',
                        address: {
                            street: typeof street === 'string' ? street : (street.street || ''),
                            city,
                            state,
                            pincode,
                        },
                    });
                    created.push(student);
                } catch (err: any) {
                    errors.push({ row: i + 1, message: err.message || 'Invalid row' });
                }
            }
            res.status(201).json({
                success: true,
                data: { created: created.length, total: rows.length, errors },
                message: `Imported ${created.length} of ${rows.length} students`,
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Delete student (Soft Delete)
     */
    async deleteStudent(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            await StudentService.deleteStudent(req.schoolId!, req.params.id);

            res.status(200).json({
                success: true,
                data: {},
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Preview students eligible for promotion
     */
    async promotionPreview(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { fromClass } = req.query;
            if (!fromClass) return next(new ErrorResponse('fromClass query param is required', 400));
            const students = await Student.find({
                schoolId: req.schoolId,
                class: fromClass as string,
                isActive: true,
                status: 'active',
            }).select('firstName lastName admissionNumber class section rollNumber').lean();
            sendResponse(res, students, `${students.length} students eligible`, 200);
        } catch (error) {
            next(error);
        }
    }

    /**
     * Batch promote students from one class to another
     */
    async promoteStudents(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { fromClass, toClass, newSessionId } = req.body;
            if (!fromClass || !toClass || !newSessionId) {
                return next(new ErrorResponse('fromClass, toClass, and newSessionId are required', 400));
            }
            const result = await PromotionService.promoteStudents(
                req.schoolId!,
                fromClass,
                toClass,
                newSessionId
            );
            sendResponse(res, result, `${result.promoted} students promoted successfully`, 200);
        } catch (error) {
            next(error);
        }
    }

    /**
     * Admin: set/reset student password
     * POST /students/:id/set-password
     */
    async setStudentPassword(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { password } = req.body;
            if (!password || password.length < 6) {
                return next(new ErrorResponse('Password must be at least 6 characters', 400));
            }
            const student = await Student.findOne({ _id: req.params.id, schoolId: req.schoolId });
            if (!student) return next(new ErrorResponse('Student not found', 404));

            (student as any).password = password;
            (student as any).plainPassword = password;
            (student as any).mustChangePassword = true;

            // Ensure username is set if missing (using firstName + phone suffix only on name/DOB collision)
            if (!(student as any).username) {
                const firstName = (student as any).firstName.trim().toLowerCase();
                const dateOfBirth = (student as any).dateOfBirth;

                // Check if another student has SAME name and SAME DOB
                const hasSibling = await Student.findOne({
                    _id: { $ne: student._id },
                    schoolId: student.schoolId,
                    firstName: { $regex: new RegExp(`^${(student as any).firstName.trim()}$`, 'i') },
                    dateOfBirth: dateOfBirth
                });

                (student as any).username = (hasSibling && (student as any).phone)
                    ? firstName + (student as any).phone.slice(-4)
                    : firstName;
            }

            await (student as any).save({ validateBeforeSave: false });

            sendResponse(res, {
                admissionNumber: student.admissionNumber,
                username: student.username,
                plainPassword: student.plainPassword,
                mustChangePassword: true,
            }, 'Password updated. Student must change it on next login.', 200);
        } catch (error) {
            next(error);
        }
    }

    /**
     * Generate Student ID Card PDF
     */
    async getIdCardPdf(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { id } = req.params;
            const student = await Student.findOne({ _id: id, schoolId: req.schoolId, isActive: true });
            if (!student) return next(new ErrorResponse('Student not found', 404));
            const school = await School.findById(req.schoolId);
            if (!school) return next(new ErrorResponse('School not found', 404));
            const activeSession = await Session.findOne({ schoolId: req.schoolId, isActive: true }).lean();

            const buffer = await generateIdCardPDF({
                school,
                sessionYear: (activeSession as any)?.sessionYear,
                student: {
                    firstName: student.firstName,
                    lastName: student.lastName,
                    admissionNumber: student.admissionNumber,
                    class: student.class,
                    section: student.section,
                    rollNumber: student.rollNumber,
                    fatherName: student.fatherName,
                    motherName: (student as any).motherName,
                    dateOfBirth: (student as any).dateOfBirth,
                    bloodGroup: (student as any).bloodGroup,
                    phone: (student as any).phone,
                    photo: (student as any).photo,
                    address: (student as any).address,
                },
            });

            res.setHeader('Content-Type', 'application/pdf');
            const isPreview = req.query.preview === '1' || req.query.preview === 'true';
            res.setHeader(
                'Content-Disposition',
                isPreview ? 'inline' : `attachment; filename=id-card-${id}.pdf`
            );
            res.send(buffer);
        } catch (error) {
            next(error);
        }
    }
}

export default new StudentController();
