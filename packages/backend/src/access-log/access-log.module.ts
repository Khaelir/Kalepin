import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NoteAccessLog } from '../entities';
import { AuthModule } from '../auth';
import { AccessLogService } from './access-log.service';
import { AccessLogRetentionService } from './access-log-retention.service';
import { AccessLogController } from './access-log.controller';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([NoteAccessLog]), AuthModule],
  controllers: [AccessLogController],
  providers: [AccessLogService, AccessLogRetentionService],
  exports: [AccessLogService],
})
export class AccessLogModule {}
