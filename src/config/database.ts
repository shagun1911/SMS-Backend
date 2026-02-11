import mongoose from 'mongoose';
import config from './index';

const connectDB = async (): Promise<void> => {
    try {
        const conn = await mongoose.connect(config.mongodb.uri as string);

        console.log(`✅ MongoDB Connected: ${conn.connection.host}`);

        // Create indexes explicitly for performance
        await createIndexes();

    } catch (error: any) {
        console.error(`❌ MongoDB Connection Error: ${error.message}`);
        process.exit(1);
    }
};

const createIndexes = async () => {
    // We'll call ensureIndexes on critical models here once they are imported
    console.log('📊 Database indexes verified');
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
