import { Controller, Get, Post, NotFoundException } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { McpService } from '../mcp/mcp.service';
import { NotificationService } from '../comments/notification.service';

// Test-only introspection surface used by the Phase 4 leak-token e2e harness.
// Loaded into AppModule iff EXPOSE_TEST_ENDPOINTS=1 — production builds never
// register the controller. Each handler also re-checks the env var so a
// misconfigured deploy still fails closed.
@Controller('api/__test')
export class TestDebugController {
  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly mcpService: McpService,
    private readonly notificationService: NotificationService,
  ) {}

  private gate(): void {
    if (process.env.EXPOSE_TEST_ENDPOINTS !== '1') {
      throw new NotFoundException();
    }
  }

  // Walk Express's router stack to enumerate every registered HTTP route.
  // The leak-token suite uses this to fail-fast if discovery misses a
  // controller — a new endpoint added without a visibility gate is caught
  // structurally rather than by hand-maintained allowlists.
  @Get('routes')
  routes() {
    this.gate();
    const httpAdapter = this.httpAdapterHost.httpAdapter;
    const expressApp: any = httpAdapter.getInstance();
    const routes: { method: string; path: string }[] = [];
    const visit = (layer: any, prefix = '') => {
      if (layer.route) {
        const p = prefix + (layer.route.path || '');
        for (const m of Object.keys(layer.route.methods)) {
          if (layer.route.methods[m]) {
            routes.push({ method: m.toUpperCase(), path: p });
          }
        }
      } else if (layer.name === 'router' && layer.handle?.stack) {
        const subPrefix = prefix; // Express mount prefix lives on the parent layer
        for (const l of layer.handle.stack) visit(l, subPrefix);
      }
    };
    const stack = expressApp._router?.stack ?? expressApp.router?.stack ?? [];
    for (const l of stack) visit(l);
    return {
      routes,
      mcpTools: [...this.mcpService.getRegisteredTools()],
    };
  }

  @Get('notifications')
  notifications() {
    this.gate();
    return this.notificationService.__getTestCounters();
  }

  @Post('notifications/reset')
  resetNotifications() {
    this.gate();
    this.notificationService.__resetTestCounters();
    return { ok: true };
  }
}
