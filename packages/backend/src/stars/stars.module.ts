import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StarredItem } from '../entities';
import { AuthModule } from '../auth';
import { StarsController } from './stars.controller';
import { StarsService } from './stars.service';

@Module({
  imports: [TypeOrmModule.forFeature([StarredItem]), AuthModule],
  controllers: [StarsController],
  providers: [StarsService],
  exports: [StarsService],
})
export class StarsModule {}
