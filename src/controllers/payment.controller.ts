import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import Razorpay from 'razorpay';
import config from '../config';
import Plan from '../models/plan.model';
import School from '../models/school.model';
import SchoolSubscription from '../models/schoolSubscription.model';
import ErrorResponse from '../utils/errorResponse';
import { sendResponse } from '../utils/response';
import { AuthRequest } from '../types';
import { createPhonePePayment, isPhonePeConfigured } from '../services/phonepe.service';

/** Webhook request body is raw (Buffer) - set by express.raw middleware */
interface WebhookRequest extends Request {
    body: Buffer;
}

const razorpay = config.razorpay.keyId && config.razorpay.keySecret
    ? new Razorpay({ key_id: config.razorpay.keyId, key_secret: config.razorpay.keySecret })
    : null;

/**
 * POST /payments/create-order
 * Body: { planId, interval: 'monthly' | 'yearly' }
 * School admin only. Uses PhonePe if configured (returns redirectUrl); else Razorpay (orderId + keyId).
 */
export async function createOrder(req: AuthRequest, res: Response, next: NextFunction) {
    try {
        const schoolId = req.schoolId;
        if (!schoolId) return next(new ErrorResponse('School context required', 403));
        const { planId, interval } = req.body as { planId: string; interval: 'monthly' | 'yearly' };
        if (!planId || !interval || !['monthly', 'yearly'].includes(interval)) {
            return next(new ErrorResponse('planId and interval (monthly|yearly) required', 400));
        }

        const [school, plan] = await Promise.all([
            School.findById(schoolId).lean(),
            Plan.findById(planId).lean(),
        ]);
        if (!school) return next(new ErrorResponse('School not found', 404));
        if (!plan || !(plan as any).isActive) return next(new ErrorResponse('Plan not found or inactive', 404));

        const amount = interval === 'monthly' ? (plan as any).priceMonthly : (plan as any).priceYearly;
        const isFreePlan = Number((plan as any).priceMonthly) === 0 && Number((plan as any).priceYearly) === 0;

        const frontendUrl = config.frontend.url.replace(/\/$/, '');
        const successPath = isPhonePeConfigured() ? config.phonepe.successPath : config.razorpay.successPath;
        const successUrl = `${frontendUrl}${successPath.startsWith('/') ? successPath : '/' + successPath}?success=1`;

        if (isFreePlan) {
            const start = new Date();
            const end = new Date();
            end.setFullYear(end.getFullYear() + 1);
            await SchoolSubscription.findOneAndUpdate(
                { schoolId },
                { planId, subscriptionStart: start, subscriptionEnd: end, status: 'active' },
                { upsert: true, new: true }
            );
            return sendResponse(res, { url: successUrl, isFree: true }, 'OK', 200);
        }

        if (isPhonePeConfigured()) {
            const amountPaise = Math.round(amount * 100);
            const merchantOrderId = `plan_${schoolId}_${planId}_${interval}_${Date.now()}`.replace(/[^a-zA-Z0-9_-]/g, '_');
            const result = await createPhonePePayment({
                merchantOrderId,
                amountPaisa: amountPaise,
                redirectUrl: successUrl,
                metaInfo: { udf1: String(schoolId), udf2: String(planId), udf3: interval },
            });
            return sendResponse(res, {
                redirectUrl: result.redirectUrl,
                merchantOrderId,
                planName: (plan as any).name,
            }, 'OK', 200);
        }

        if (!razorpay) return next(new ErrorResponse('Payment gateway not configured. Set PHONEPE_CLIENT_ID and PHONEPE_CLIENT_SECRET, or RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.', 503));

        const amountPaise = Math.round(amount * 100);
        const order = await razorpay.orders.create({
            amount: amountPaise,
            currency: 'INR',
            receipt: `plan_${schoolId}_${planId}_${interval}_${Date.now()}`,
            notes: {
                schoolId: String(schoolId),
                planId: String(planId),
                interval,
            },
        });

        return sendResponse(res, {
            orderId: order.id,
            amount: amountPaise,
            currency: 'INR',
            keyId: config.razorpay.keyId,
            planName: (plan as any).name,
        }, 'OK', 200);
    } catch (err: any) {
        next(err);
    }
}

/**
 * POST /payments/verify
 * Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature, planId, interval }
 * Verifies signature and activates subscription.
 */
export async function verifyPayment(req: AuthRequest, res: Response, next: NextFunction) {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature, planId, interval } = req.body;
        const schoolId = req.schoolId;
        if (!schoolId) return next(new ErrorResponse('School context required', 403));
        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !planId) {
            return next(new ErrorResponse('razorpay_order_id, razorpay_payment_id, razorpay_signature and planId required', 400));
        }

        const expectedSignature = crypto
            .createHmac('sha256', config.razorpay.keySecret)
            .update(`${razorpay_order_id}|${razorpay_payment_id}`)
            .digest('hex');
        if (expectedSignature !== razorpay_signature) {
            return next(new ErrorResponse('Payment signature verification failed', 400));
        }

        const start = new Date();
        const end = new Date();
        if (interval === 'yearly') {
            end.setFullYear(end.getFullYear() + 1);
        } else {
            end.setMonth(end.getMonth() + 1);
        }

        await SchoolSubscription.findOneAndUpdate(
            { schoolId },
            { planId, subscriptionStart: start, subscriptionEnd: end, status: 'active' },
            { upsert: true, new: true }
        );

        return sendResponse(res, { success: true }, 'Payment verified and plan activated', 200);
    } catch (err: any) {
        next(err);
    }
}

/**
 * POST /payments/webhook
 * Razorpay sends events here. Must use raw body for signature verification.
 * Configure this URL in Razorpay Dashboard → Webhooks. Set RAZORPAY_WEBHOOK_SECRET to the secret shown there.
 * @see https://razorpay.com/docs/webhooks/validate-test/
 */
export async function razorpayWebhook(req: WebhookRequest, res: Response, next: NextFunction) {
    try {
        const rawBody = req.body;
        if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
            return next(new ErrorResponse('Webhook body required', 400));
        }
        const signature = req.headers['x-razorpay-signature'] as string;
        if (!signature || !config.razorpay.webhookSecret) {
            return res.status(200).json({ received: true });
        }
        const expectedSignature = crypto
            .createHmac('sha256', config.razorpay.webhookSecret)
            .update(rawBody.toString('utf8'))
            .digest('hex');
        if (expectedSignature !== signature) {
            return next(new ErrorResponse('Webhook signature verification failed', 400));
        }
        let payload: { event: string; payload?: { payment?: { entity?: { order_id: string } }; order?: { entity?: { notes?: Record<string, string> } } } };
        try {
            payload = JSON.parse(rawBody.toString('utf8'));
        } catch {
            return next(new ErrorResponse('Invalid webhook JSON', 400));
        }
        const event = payload?.event;
        if (event === 'payment.captured') {
            const paymentEntity = payload?.payload?.payment?.entity;
            const orderId = paymentEntity?.order_id;
            if (orderId && razorpay) {
                try {
                    const order = await razorpay.orders.fetch(orderId);
                    const notes = (order as any).notes || {};
                    const schoolId = notes.schoolId;
                    const planId = notes.planId;
                    const interval = notes.interval;
                    if (schoolId && planId) {
                        const start = new Date();
                        const end = new Date();
                        if (interval === 'yearly') {
                            end.setFullYear(end.getFullYear() + 1);
                        } else {
                            end.setMonth(end.getMonth() + 1);
                        }
                        await SchoolSubscription.findOneAndUpdate(
                            { schoolId },
                            { planId, subscriptionStart: start, subscriptionEnd: end, status: 'active' },
                            { upsert: true, new: true }
                        );
                    }
                } catch (e) {
                    console.error('[Razorpay Webhook] payment.captured order fetch/update failed:', e);
                }
            }
        }
        return res.status(200).json({ received: true });
    } catch (err: any) {
        return next(err);
    }
}

/**
 * PhonePe webhook: GET for URL validation (dashboard "Create" check), POST for events.
 * Use URL: /api/v1/payments/phonepe-webhook
 * Set PHONEPE_WEBHOOK_USERNAME and PHONEPE_WEBHOOK_PASSWORD to match the credentials you set in PhonePe dashboard.
 * @see https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/webhook
 */
export async function phonepeWebhook(req: Request, res: Response, next: NextFunction) {
    try {
        if (req.method === 'GET') {
            return res.status(200).json({ ok: true, service: 'phonepe-webhook' });
        }
        const authHeader = (req.headers.authorization || '').trim();
        const username = config.phonepe.webhookUsername;
        const password = config.phonepe.webhookPassword;
        if (username && password) {
            const expectedHash = crypto.createHash('sha256').update(`${username}:${password}`).digest('hex');
            const receivedHash = authHeader
                .replace(/^Bearer\s+/i, '')
                .replace(/^SHA256\s+/i, '')
                .trim();
            if (receivedHash !== expectedHash) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
        }
        const body = req.body || {};
        const event = body.event || body.type;
        const state = body.payload?.state;
        if (event) {
            console.log('[PhonePe Webhook]', event, state || '');
        }
        const orderCompleted = event === 'checkout.order.completed' || event === 'pg.order.completed' || state === 'COMPLETED';
        if (orderCompleted && body.payload) {
            const meta = body.payload.metaInfo || {};
            const schoolId = meta.udf1;
            const planId = meta.udf2;
            const interval = meta.udf3 || 'monthly';
            if (schoolId && planId) {
                try {
                    const start = new Date();
                    const end = new Date();
                    if (interval === 'yearly') {
                        end.setFullYear(end.getFullYear() + 1);
                    } else {
                        end.setMonth(end.getMonth() + 1);
                    }
                    await SchoolSubscription.findOneAndUpdate(
                        { schoolId },
                        { planId, subscriptionStart: start, subscriptionEnd: end, status: 'active' },
                        { upsert: true, new: true }
                    );
                    console.log('[PhonePe Webhook] subscription activated for school', schoolId);
                } catch (e) {
                    console.error('[PhonePe Webhook] subscription activate failed:', e);
                }
            }
        }
        return res.status(200).json({ received: true });
    } catch (err: any) {
        return next(err);
    }
}
