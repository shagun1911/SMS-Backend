import { ITransportDestination } from '../models/transportDestination.model';
import TransportDestinationRepository from '../repositories/transportDestination.repository';
import SchoolRepository from '../repositories/school.repository';
import ErrorResponse from '../utils/errorResponse';

class TransportDestinationService {
    /**
     * Create a new transport destination
     */
    async createDestination(schoolId: string, data: Partial<ITransportDestination>): Promise<ITransportDestination> {
        const school = await SchoolRepository.findById(schoolId);
        if (!school) {
            throw new ErrorResponse('School not found', 404);
        }

        // Check if destination name already exists for this school
        const existing = await TransportDestinationRepository.findBySchoolAndName(
            schoolId,
            data.destinationName!
        );
        if (existing) {
            throw new ErrorResponse('Destination with this name already exists', 400);
        }

        const destination = await TransportDestinationRepository.create({
            ...data,
            schoolId: school._id,
        } as any);

        return destination;
    }

    /**
     * Get all transport destinations for a school
     */
    async getDestinationsBySchool(schoolId: string): Promise<ITransportDestination[]> {
        const destinations = await TransportDestinationRepository.findBySchool(schoolId);
        return destinations;
    }

    /**
     * Get transport destination by ID
     */
    async getDestinationById(schoolId: string, id: string): Promise<ITransportDestination> {
        const destination = await TransportDestinationRepository.findById(id);
        if (!destination) {
            throw new ErrorResponse('Transport destination not found', 404);
        }

        if (destination.schoolId.toString() !== schoolId) {
            throw new ErrorResponse('Unauthorized access to this destination', 403);
        }

        return destination;
    }

    /**
     * Update transport destination
     */
    async updateDestination(schoolId: string, id: string, data: Partial<ITransportDestination>): Promise<ITransportDestination> {
        const destination = await this.getDestinationById(schoolId, id);

        // If updating name, check for duplicates
        if (data.destinationName && data.destinationName !== destination.destinationName) {
            const existing = await TransportDestinationRepository.findBySchoolAndName(
                schoolId,
                data.destinationName
            );
            if (existing) {
                throw new ErrorResponse('Destination with this name already exists', 400);
            }
        }

        const updated = await TransportDestinationRepository.update(id, data);
        return updated!;
    }

    /**
     * Delete transport destination
     */
    async deleteDestination(schoolId: string, id: string): Promise<void> {
        await this.getDestinationById(schoolId, id);
        await TransportDestinationRepository.delete(id);
    }
}

export default new TransportDestinationService();
