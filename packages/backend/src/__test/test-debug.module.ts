import { Module } from '@nestjs/common';
import { McpModule } from '../mcp/mcp.module';
import { CommentsModule } from '../comments/comments.module';
import { TestDebugController } from './test-debug.controller';

// Wire the test-only debug surface. AppModule includes this module conditionally
// (EXPOSE_TEST_ENDPOINTS=1) so production never sees these controllers.
@Module({
  imports: [McpModule, CommentsModule],
  controllers: [TestDebugController],
})
export class TestDebugModule {}
