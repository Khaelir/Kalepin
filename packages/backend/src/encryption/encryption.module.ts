import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EncryptionZone } from '../entities/encryption-zone.entity';
import { EncryptionZonesService } from './encryption-zones.service';
import { MigrationSweepService } from './migration-sweep.service';
import { EncryptionController, EncryptionStatusController } from './encryption.controller';
import {
  DefaultEncryptionPredicates,
  ENCRYPTION_PREDICATES,
} from '../crypto/encryption-predicates';
import { AuthModule } from '../auth';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([EncryptionZone]), AuthModule],
  controllers: [EncryptionController, EncryptionStatusController],
  providers: [
    EncryptionZonesService,
    MigrationSweepService,
    DefaultEncryptionPredicates,
    {
      provide: ENCRYPTION_PREDICATES,
      useExisting: DefaultEncryptionPredicates,
    },
  ],
  exports: [
    EncryptionZonesService,
    MigrationSweepService,
    DefaultEncryptionPredicates,
    ENCRYPTION_PREDICATES,
  ],
})
export class EncryptionModule {}
