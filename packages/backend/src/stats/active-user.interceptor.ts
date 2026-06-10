import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { DailyStatsService } from './daily-stats.service';

@Injectable()
export class ActiveUserInterceptor implements NestInterceptor {
  constructor(private readonly dailyStatsService: DailyStatsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      tap(() => {
        const request = context.switchToHttp().getRequest();
        const userId = request?.user?.sub;
        if (typeof userId === 'number') {
          this.dailyStatsService.trackActiveUser(userId);
        }
      }),
    );
  }
}
