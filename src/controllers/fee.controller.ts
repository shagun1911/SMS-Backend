import { NextFunction, Response } from 'express';
import { AuthRequest } from '../types';
import FeeService from '../services/fee.service';
import { sendResponse } from '../utils/response';

class FeeController {
    // CREATE Fee Structure
    async createFeeStructure(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const data = await FeeService.createFeeStructure(req.schoolId!, req.body);
            sendResponse(res, data, 'Fee structure created', 201);
        } catch (error) {
            next(error);
        }
    }

    // GENERATE Monthly Fees
    async generateFees(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { className, month, dueDate } = req.body;
            const result = await FeeService.generateMonthlyFees(
                req.schoolId!,
                className,
                month,
                new Date(dueDate)
            );
            sendResponse(res, result, `Generated fees for ${month}`, 201);
        } catch (error) {
            next(error);
        }
    }

    // RECORD Payment
    async recordPayment(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { feeId } = req.params;
            const { amount, mode, transactionId, remarks } = req.body;

            const result = await FeeService.recordPayment(req.schoolId!, feeId, {
                amount: Number(amount),
                mode,
                transactionId,
                remarks,
                staffId: req.user!._id.toString(),
            });

            sendResponse(res, result, 'Payment recorded', 200);
        } catch (error) {
            next(error);
        }
    }

    // GET Ledger
    async getStudentLedger(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const ledger = await FeeService.getStudentLedger(req.schoolId!, req.params.studentId);
            sendResponse(res, ledger, 'Student Ledger Retrieved', 200);
        } catch (error) {
            next(error);
        }
    }

    // GET Collection Report
    async getCollectionReport(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const report = await FeeService.getCollectionReport(req.schoolId!, req.query.month as string);
            sendResponse(res, report, 'Collection Report', 200);
        } catch (error) {
            next(error);
        }
    }

    // LIST All Fees
    async listFees(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const fees = await FeeService.listAllFees(req.schoolId!, req.query);
            sendResponse(res, fees, 'Fees retrieved', 200);
        } catch (error) {
            next(error);
        }
    }

    // POST Collect fee (quick collect: find/create fee record and record payment)
    async collectFee(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { studentId, amount, month, feeTitle, mode, transactionId, remarks } = req.body;
            const result = await FeeService.collectFee(req.schoolId!, {
                studentId,
                amount: Number(amount),
                month,
                feeTitle,
                mode: mode || 'cash',
                transactionId,
                remarks,
                staffId: req.user!._id.toString(),
            });
            sendResponse(res, result, 'Fee collected successfully', 200);
        } catch (error) {
            next(error);
        }
    }

    // GET Student self-serve fee info (student JWT)
    async getStudentFeesForStudent(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const student = req.student!;
            // Get fee ledger (payment history)
            let payments: any[] = [];
            try {
                const ledger = await FeeService.getStudentLedger(student.schoolId.toString(), student._id.toString());
                payments = ledger ?? [];
            } catch (_) {
                // Session may not be active — silently return empty
            }
            const data = {
                totalYearlyFee: (student as any).totalYearlyFee ?? 0,
                paidAmount: (student as any).paidAmount ?? 0,
                dueAmount: (student as any).dueAmount ?? 0,
                payments,
            };
            sendResponse(res, data, 'Student fee summary', 200);
        } catch (error) {
            next(error);
        }
    }

    // GET Student fee receipts (student JWT) with optional month filter
    async getStudentPaymentsForStudent(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const student = req.student!;
            const year = req.query.year ? parseInt(req.query.year as string, 10) : undefined;
            const month = req.query.month ? parseInt(req.query.month as string, 10) : undefined;
            const payments = await FeeService.getStudentFeePayments(
                student.schoolId.toString(),
                student._id.toString(),
                year,
                month
            );
            sendResponse(res, payments, 'Student fee payments', 200);
        } catch (error) {
            next(error);
        }
    }

    // GET Fee stats (summary for dashboard)
    async getFeeStats(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const stats = await FeeService.getFeeStats(req.schoolId!);
            sendResponse(res, stats, 'Fee stats retrieved', 200);
        } catch (error) {
            next(error);
        }
    }

    // GET Monthly fee data (stats + payments for a specific month)
    async getMonthlyFeeData(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const year = parseInt(req.query.year as string, 10);
            const month = parseInt(req.query.month as string, 10);
            if (!year || !month || month < 1 || month > 12) {
                return void res.status(400).json({ success: false, message: 'Valid year and month (1-12) required' });
            }
            const data = await FeeService.getMonthlyFeeData(req.schoolId!, year, month);
            sendResponse(res, data, 'Monthly fee data retrieved', 200);
        } catch (error) {
            next(error);
        }
    }

    // GET Fee structures (list for session)
    async listStructures(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const structures = await FeeService.getStructuresBySession(req.schoolId!);
            sendResponse(res, structures, 'Fee structures retrieved', 200);
        } catch (error) {
            next(error);
        }
    }

    // GET Fee structure by class or id
    async getStructure(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { classId } = req.params;
            const structure = await FeeService.getStructureByClass(req.schoolId!, classId);
            if (!structure) {
                return void res.status(404).json({ success: false, message: 'Fee structure not found' });
            }
            return void sendResponse(res, structure, 'Fee structure retrieved', 200);
        } catch (error) {
            next(error);
            return;
        }
    }

    // GET Fee structure by id (for edit/print)
    async getStructureById(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const FeeStructureRepository = (await import('../repositories/feeStructure.repository')).default;
            const structure = await FeeStructureRepository.findById(req.params.id as string);
            if (!structure || (structure as any).schoolId?.toString() !== req.schoolId) {
                return void res.status(404).json({ success: false, message: 'Fee structure not found' });
            }
            return void sendResponse(res, structure, 'Fee structure retrieved', 200);
        } catch (error) {
            next(error);
            return;
        }
    }

    // PUT Fee structure
    async updateFeeStructure(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const updated = await FeeService.updateFeeStructure(req.schoolId!, req.params.id, req.body);
            if (!updated) return void res.status(404).json({ success: false, message: 'Fee structure not found' });
            return void sendResponse(res, updated, 'Fee structure updated', 200);
        } catch (error) {
            next(error);
            return;
        }
    }

    // DELETE Fee structure
    async deleteFeeStructure(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const deleted = await FeeService.deleteFeeStructure(req.schoolId!, req.params.id);
            if (!deleted) return void res.status(404).json({ success: false, message: 'Fee structure not found' });
            return void sendResponse(res, { deleted: true }, 'Fee structure deleted', 200);
        } catch (error) {
            next(error);
            return;
        }
    }

    // GET Fee structure PDF (query: preview=1 for inline display, else download)
    async printStructure(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const rawDestination = req.query.transportDestinationId;
            const transportDestinationId =
                typeof rawDestination === 'string' ? rawDestination.trim() : undefined;
            const buffer = await FeeService.getStructurePrintPdf(
                req.schoolId!,
                req.params.id,
                transportDestinationId || undefined
            );
            res.setHeader('Content-Type', 'application/pdf');
            const isPreview = req.query.preview === '1' || req.query.preview === 'true';
            res.setHeader(
                'Content-Disposition',
                isPreview ? 'inline' : `attachment; filename=fee-structure-${req.params.id}.pdf`
            );
            res.send(buffer);
        } catch (error) {
            next(error);
        }
    }

    // POST Pay fee (yearly model: receipt + student update)
    async payFee(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { studentId, amountPaid, paymentMode, paymentDate } = req.body;
            const result = await FeeService.payFee(req.schoolId!, {
                studentId,
                amountPaid: Number(amountPaid),
                paymentMode: paymentMode || 'cash',
                paymentDate,
                staffId: req.user!._id.toString(),
            });
            res.setHeader('Content-Type', 'application/json');
            sendResponse(res, { payment: result.payment, receiptNumber: result.payment.receiptNumber }, 'Payment recorded', 200);
        } catch (error) {
            next(error);
        }
    }

    // GET Student fee summary + payments
    async getStudentFees(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const summary = await FeeService.getStudentFeeSummary(req.schoolId!, req.params.studentId);
            if (!summary) return void res.status(404).json({ success: false, message: 'Student not found' });
            return void sendResponse(res, summary, 'Student fee summary', 200);
        } catch (error) {
            next(error);
            return;
        }
    }

    // GET Receipt PDF (query: preview=1 for inline display, else download)
    async getReceipt(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const buffer = await FeeService.getReceiptPdf(req.schoolId!, req.params.receiptId);
            res.setHeader('Content-Type', 'application/pdf');
            const isPreview = req.query.preview === '1' || req.query.preview === 'true';
            res.setHeader(
                'Content-Disposition',
                isPreview ? 'inline' : `attachment; filename=receipt-${req.params.receiptId}.pdf`
            );
            res.send(buffer);
        } catch (error) {
            next(error);
        }
    }

    // GET List fee payments (receipts)
    async listPayments(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const studentId = typeof req.query.studentId === 'string' ? req.query.studentId : undefined;
            const payments = await FeeService.listFeePayments(req.schoolId!, 200, studentId);
            sendResponse(res, payments, 'Payments retrieved', 200);
        } catch (error) {
            next(error);
        }
    }

    // GET Defaulters
    async getDefaulters(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const defaulters = await FeeService.getDefaulters(req.schoolId!);
            sendResponse(res, defaulters, 'Defaulters list', 200);
        } catch (error) {
            next(error);
        }
    }

    // GET Pending students for current month
    async getPendingCurrentMonth(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const pending = await FeeService.getPendingCurrentMonthStudents(req.schoolId!);
            sendResponse(res, pending, 'Pending students for current month', 200);
        } catch (error) {
            next(error);
        }
    }
}

export default new FeeController();
