import { describe, expect, it } from 'vitest';
import {
  parseClientMessage,
  rawMessageByteLength,
  rawMessageToText
} from '../../src/websocket/protocol.js';

function envelope(type: string, payload: unknown = {}) {
  return JSON.stringify({ protocolVersion: 1, type, requestId: 'request-1', payload });
}

describe('websocket protocol', () => {
  it('accepts versioned ping and refresh messages with strict empty payloads', () => {
    expect(parseClientMessage(envelope('ping'), false)).toEqual({
      ok: true,
      message: { protocolVersion: 1, type: 'ping', requestId: 'request-1', payload: {} }
    });
    expect(parseClientMessage(envelope('party.refresh'), false)).toEqual({
      ok: true,
      message: { protocolVersion: 1, type: 'party.refresh', requestId: 'request-1', payload: {} }
    });
    expect(parseClientMessage(envelope('party.refresh', { partyId: 'spoofed-party' }), false)).toEqual({
      ok: false,
      failure: 'invalid_message'
    });
  });

  it('requires explicit first-message auth and never accepts auth after authentication', () => {
    const auth = envelope('auth', { token: 'dev_test-token' });
    expect(parseClientMessage(auth, true)).toEqual({
      ok: true,
      message: { protocolVersion: 1, type: 'auth', requestId: 'request-1', payload: { token: 'dev_test-token' } }
    });
    expect(parseClientMessage(auth, false)).toEqual({ ok: false, failure: 'unknown_message_type' });
  });

  it('rejects invalid JSON, unsupported versions, unknown types, and malformed request IDs', () => {
    expect(parseClientMessage('{', false)).toEqual({ ok: false, failure: 'invalid_json' });
    expect(parseClientMessage(JSON.stringify({ protocolVersion: 2, type: 'ping', requestId: 'a', payload: {} }), false)).toEqual({
      ok: false,
      failure: 'unsupported_version'
    });
    expect(parseClientMessage(envelope('party.command'), false)).toEqual({ ok: false, failure: 'invalid_message' });
    expect(parseClientMessage(JSON.stringify({ protocolVersion: 1, type: 'ping', requestId: 'bad id', payload: {} }), false)).toEqual({
      ok: false,
      failure: 'invalid_message'
    });
  });

  it('accepts authoritative state reads and strict command envelopes without a party ID', () => {
    expect(parseClientMessage(envelope('party.state.get'), false)).toEqual({
      ok: true,
      message: { protocolVersion: 1, type: 'party.state.get', requestId: 'request-1', payload: {} }
    });
    expect(parseClientMessage(envelope('party.command', {
      commandId: 'command-1',
      expectedRevision: 4,
      command: { type: 'expedition.start', destination: 'forest' }
    }), false).ok).toBe(true);
    expect(parseClientMessage(envelope('party.command', {
      partyId: 'spoofed-party',
      commandId: 'command-1',
      expectedRevision: 4,
      command: { type: 'expedition.start', destination: 'forest' }
    }), false).ok).toBe(false);
    expect(parseClientMessage(envelope('party.command', {
      commandId: 'command-2',
      expectedRevision: 4,
      command: { type: 'expedition.start', destination: 'mars' }
    }), false).ok).toBe(true);
  });

  it('accepts four-slot mission starts and mid-run assignment changes without accepting client forecasts', () => {
    const emptyStart = parseClientMessage(envelope('party.command', {
      commandId: 'mission-empty',
      expectedRevision: 0,
      command: { type: 'expedition.start', expeditionId: 'combat:forest-hunt', assignments: [] }
    }), false);
    expect(emptyStart.ok).toBe(true);
    const modernStart = parseClientMessage(envelope('party.command', {
      commandId: 'mission-1',
      expectedRevision: 0,
      command: {
        type: 'expedition.start',
        expeditionId: 'combat:forest-hunt',
        assignments: [
          { slotId: 'slot-1', playerId: 'player-1', roleId: 'dps', targetId: 'mire-stalker' },
          { slotId: 'slot-2', playerId: 'player-2', roleId: 'tank', targetId: 'mire-stalker' }
        ]
      }
    }), false);
    expect(modernStart.ok).toBe(true);
    expect(parseClientMessage(envelope('party.command', {
      commandId: 'assignment-1',
      expectedRevision: 1,
      command: { type: 'expedition.assignment.set', slotId: 'slot-2', roleId: 'healer', targetId: 'mire-stalker' }
    }), false).ok).toBe(true);
    expect(parseClientMessage(envelope('party.command', {
      commandId: 'assignment-clear-1',
      expectedRevision: 2,
      command: { type: 'expedition.assignment.clear', slotId: 'slot-2' }
    }), false).ok).toBe(true);
    expect(parseClientMessage(envelope('party.command', {
      commandId: 'abandon-1',
      expectedRevision: 3,
      command: { type: 'expedition.abandon' }
    }), false).ok).toBe(true);
    expect(parseClientMessage(envelope('party.command', {
      commandId: 'spoofed-forecast',
      expectedRevision: 0,
      command: { type: 'expedition.start', expeditionId: 'combat:forest-hunt', assignments: [], successPercent: 100 }
    }), false).ok).toBe(false);
  });

  it('measures and decodes text frames without accepting binary frames', () => {
    const text = Buffer.from(envelope('ping'));
    expect(rawMessageByteLength(text)).toBe(text.byteLength);
    expect(rawMessageToText(text, false)).toBe(text.toString('utf8'));
    expect(rawMessageToText(text, true)).toBeNull();
  });
});
