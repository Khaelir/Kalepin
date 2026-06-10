import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NoteMeta } from '../entities/note-meta.entity';
import { PinService } from './pin.service';
import { PinController } from './pin.controller';
import { AuthModule } from '../auth';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([NoteMeta]), AuthModule],
  controllers: [PinController],
  providers: [PinService],
  exports: [PinService],
})
export class PinModule {}
