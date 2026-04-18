import { ITransportDestination } from '../models/transportDestination.model';
import TransportDestination from '../models/transportDestination.model';
import { BaseRepository } from './base.repository';

class TransportDestinationRepository extends BaseRepository<ITransportDestination> {
    constructor() {
        super(TransportDestination);
    }

    async findBySchool(schoolId: string): Promise<ITransportDestination[]> {
        return await this.find({ schoolId, isActive: true }, { sort: { destinationName: 1 } });
    }

    async findBySchoolAndName(schoolId: string, destinationName: string): Promise<ITransportDestination | null> {
        return await this.findOne({ schoolId, destinationName });
    }
}

export default new TransportDestinationRepository();
