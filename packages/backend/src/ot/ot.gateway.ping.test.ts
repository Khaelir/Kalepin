import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { OTGateway } from './ot.gateway';

// The frontend pings every 30s and reconnects when nothing comes back, so a
// socket left dead by sleep/wake or a network change doesn't swallow edits.
// The gateway must route `ping` and answer it.

describe('OTGateway — heartbeat', () => {
  it('routes `ping` frames and answers them with a pong', () => {
    const handler = OTGateway.prototype.handlePing;
    assert.equal(Reflect.getMetadata('message', handler), 'ping');
    // The WsAdapter sends the handler's return value back as JSON.
    assert.deepEqual(handler.call({}), { type: 'pong' });
  });
});
