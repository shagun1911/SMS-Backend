import mongoose from 'mongoose';
import config from './index';
import User from '../models/user.model';

const connectDB = async (): Promise<void> => {
    try {
        const conn = await mongoose.connect(config.mongodb.uri as string, {
            maxPoolSize: 100,
        });

        console.log(`✅ MongoDB Connected: ${conn.connection.host}`);

        // Create indexes explicitly for performance
        await createIndexes();

    } catch (error: any) {
        console.error(`❌ MongoDB Connection Error: ${error.message}`);
        process.exit(1);
    }
};

const createIndexes = async () => {
    try {
        const indexes = await User.collection.indexes();
        const emailIndexes = indexes.filter((idx) => idx.key?.email === 1);

        for (const idx of emailIndexes) {
            const isExpected =
                idx.unique === true &&
                (idx.sparse === true ||
                    (idx.partialFilterExpression &&
                        Object.prototype.hasOwnProperty.call(idx.partialFilterExpression, 'email')));

            if (!isExpected && idx.name && idx.name !== '_id_') {
                await User.collection.dropIndex(idx.name);
                console.log(`🧹 Dropped legacy email index: ${idx.name}`);
            }
        }

        // Recreate expected unique sparse index for optional staff emails.
        await User.collection.createIndex(
            { email: 1 },
            { unique: true, sparse: true, name: 'email_1' }
        );
        await User.syncIndexes();
        console.log('📊 Database indexes verified (User indexes synced)');
    } catch (error: any) {
        console.error(`⚠️ Index verification warning: ${error?.message || error}`);
    }
};

// Handle connection events
mongoose.connection.on('connected', () => {
    console.log('🟢 Mongoose connected to DB');
});

mongoose.connection.on('error', (err) => {
    console.error('🔴 Mongoose connection error:', err);
});

mongoose.connection.on('disconnected', () => {
    console.log('🟠 Mongoose disconnected');
});

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
    try {
        await mongoose.connection.close();
        console.log(`🛑 Mongoose connection closed through ${signal} termination`);
        process.exit(0);
    } catch (err) {
        console.error('Error during graceful shutdown:', err);
        process.exit(1);
    }
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

export default connectDB;
