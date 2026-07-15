import { describe, expect, it } from 'vitest';
import { createConnectionRegistry, type RegisteredConnection, type RegistrySocket } from '../../src/websocket/connection-registry.js';

class FakeSocket implements RegistrySocket {
  readyState = 1;
  readonly sent: string[] = [];
  readonly closed: Array<{ code?: number; reason?: string }> = [];

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closed.push({ code, reason });
    this.readyState = 3;
  }
}

function connection(
  id: string,
  playerId: string,
  partyId: string | null,
  socket = new FakeSocket()
): RegisteredConnection {
  return {
    socket,
    session: {
      connectionId: id,
      playerId,
      partyId,
      sessionId: `session-${id}`,
      connectedAt: 1,
      lastActivityAt: 1,
      status: 'connected'
    }
  };
}

describe('connection registry', () => {
  it('indexes multiple connections by player and party and supports excluded broadcasts', () => {
    const registry = createConnectionRegistry();
    const first = connection('c1', 'p1', 'party-a');
    const second = connection('c2', 'p1', 'party-a');
    const otherParty = connection('c3', 'p2', 'party-b');
    registry.register(first);
    registry.register(second);
    registry.register(otherParty);

    expect(registry.getByPlayer('p1')).toHaveLength(2);
    expect(registry.getByParty('party-a')).toHaveLength(2);
    expect(registry.countPlayerConnections('p1')).toBe(2);
    expect(registry.countPlayerConnections('p1', 'party-a')).toBe(2);
    expect(registry.broadcastParty('party-a', 'presence', 'c1')).toBe(1);
    expect((first.socket as FakeSocket).sent).toEqual([]);
    expect((second.socket as FakeSocket).sent).toEqual(['presence']);
    expect((otherParty.socket as FakeSocket).sent).toEqual([]);
  });

  it('moves every socket for a player between party scopes atomically', () => {
    const registry = createConnectionRegistry();
    const first = connection('c1', 'p1', 'party-a');
    const second = connection('c2', 'p1', 'party-a');
    registry.register(first);
    registry.register(second);

    const changes = registry.updatePlayerParty('p1', 'party-b');

    expect(changes).toHaveLength(2);
    expect(changes.every(change => change.oldPartyId === 'party-a' && change.newPartyId === 'party-b')).toBe(true);
    expect(registry.getByParty('party-a')).toHaveLength(0);
    expect(registry.getByParty('party-b')).toHaveLength(2);
    expect(first.session.partyId).toBe('party-b');
    expect(second.session.partyId).toBe('party-b');
  });

  it('removes entries on disconnect and clears all references on shutdown', () => {
    const registry = createConnectionRegistry();
    const first = connection('c1', 'p1', 'party-a');
    const second = connection('c2', 'p2', null);
    registry.register(first);
    registry.register(second);

    expect(registry.remove('c1')).toBe(first);
    expect(registry.getByPlayer('p1')).toHaveLength(0);
    expect(registry.getByParty('party-a')).toHaveLength(0);
    expect(registry.size()).toBe(1);

    registry.closeAll(1001, 'server.shutdown');
    expect(registry.size()).toBe(0);
    expect((second.socket as FakeSocket).closed).toEqual([{ code: 1001, reason: 'server.shutdown' }]);
    expect(registry.getByPlayer('p2')).toHaveLength(0);
  });
});
