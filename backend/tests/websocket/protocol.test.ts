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
    expect(parseClientMessage(envelope('party.command'), false)).toEqual({ ok: false, failure: 'unknown_message_type' });
    expect(parseClientMessage(JSON.stringify({ protocolVersion: 1, type: 'ping', requestId: 'bad id', payload: {} }), false)).toEqual({
      ok: false,
      failure: 'invalid_message'
    });
  });

  it('measures and decodes text frames without accepting binary frames', () => {
    const text = Buffer.from(envelope('ping'));
    expect(rawMessageByteLength(text)).toBe(text.byteLength);
    expect(rawMessageToText(text, false)).toBe(text.toString('utf8'));
    expect(rawMessageToText(text, true)).toBeNull();
  });
});
