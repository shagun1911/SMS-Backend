import { Response, NextFunction } from 'express';
import StudentService from '../services/student.service';
import { AuthRequest } from '../types';

class StudentController {
    /**
     * Create Student
     */
    async createStudent(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const student = await StudentService.createStudent(req.schoolId!, req.body);

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
                    const student = await StudentService.createStudent(req.schoolId!, {
                        firstName: row.firstName || row.first_name,
                        lastName: row.lastName || row.last_name,
                        fatherName: row.fatherName || row.father_name || '',
                        motherName: row.motherName || row.mother_name || '',
                        dateOfBirth: row.dateOfBirth ? new Date(row.dateOfBirth) : new Date(),
                        gender: row.gender || 'Male',
                        class: row.class || row.className || 'I',
                        section: (row.section || 'A').toString().toUpperCase(),
                        rollNumber: row.rollNumber ?? row.roll_number,
                        phone: row.phone || row.fatherPhone || '',
                        address: {
                            street: row.street || row.address || '',
                            city: row.city || '',
                            state: row.state || '',
                            pincode: row.pincode || '',
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
}

export default new StudentController();
