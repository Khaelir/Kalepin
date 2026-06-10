import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentGrant } from '../entities/document-grant.entity';
import { GrantsService } from './grants.service';
import { GrantsController } from './grants.controller';
import { AuthModule } from '../auth';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([DocumentGrant]), AuthModule],
  controllers: [GrantsController],
  providers: [GrantsService],
  exports: [GrantsService],
})
export class GrantsModule {}
