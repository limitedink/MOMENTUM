export const PARTY_JOIN_CODE_LENGTH = 10;
export const PARTY_JOIN_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{10}$/;

interface PartyApiRecord {
  [key: string]: unknown;
}

export interface BackendPartyMember {
  playerId: string;
  displayName: string;
  joinedAt: string;
  isLeader: boolean;
}

export interface BackendParty {
  id: string;
  leaderId: string;
  joinCode: string;
  maxMembers: number;
  createdAt: string;
  updatedAt: string;
  members: BackendPartyMember[];
}

export class BackendPartyApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'BackendPartyApiError';
  }
}

export interface BackendPartyApi {
  createParty(): Promise<BackendParty>;
  getCurrentParty(): Promise<BackendParty | null>;
  joinParty(joinCode: string): Promise<BackendParty>;
  leaveParty(): Promise<void>;
}

export interface BackendPartyApiOptions {
  baseUrl?: string;
  token: string;
  fetchImpl?: typeof fetch;
}

function normalizeBaseUrl(value: string | undefined): string {
  return (value ?? '').trim().replace(/\/$/, '');
}

export function normalizePartyJoinCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[\s-]/g, '').toUpperCase();
  return PARTY_JOIN_CODE_PATTERN.test(normalized) ? normalized : null;
}

export function isValidPartyJoinCode(value: unknown): value is string {
  return normalizePartyJoinCode(value) !== null;
}

function isRecord(value: unknown): value is PartyApiRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPartyMember(value: unknown): value is BackendPartyMember {
  return isRecord(value) && typeof value.playerId === 'string' && value.playerId.length > 0 &&
    typeof value.displayName === 'string' && value.displayName.length >= 1 && value.displayName.length <= 24 &&
    typeof value.joinedAt === 'string' && typeof value.isLeader === 'boolean';
}

function parseParty(value: unknown): BackendParty | null {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id.length === 0 ||
    typeof value.leaderId !== 'string' || value.leaderId.length === 0 ||
    typeof value.joinCode !== 'string' || !PARTY_JOIN_CODE_PATTERN.test(value.joinCode) ||
    typeof value.maxMembers !== 'number' || !Number.isInteger(value.maxMembers) ||
    typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string' ||
    !Array.isArray(value.members) || !value.members.every(isPartyMember)) return null;

  return {
    id: value.id,
    leaderId: value.leaderId,
    joinCode: value.joinCode,
    maxMembers: value.maxMembers,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    members: value.members.map(member => ({ ...member }))
  };
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    return null;
  }
}

function errorFromResponse(response: Response, value: unknown): BackendPartyApiError {
  const record = isRecord(value) ? value : {};
  const code = typeof record.error === 'string' ? record.error : 'party_request_failed';
  const message = typeof record.message === 'string' ? record.message : `Party request failed with HTTP ${response.status}.`;
  return new BackendPartyApiError(code, response.status, message);
}

export function createBackendPartyApi(options: BackendPartyApiOptions): BackendPartyApi {
  if (typeof options.token !== 'string' || options.token.length === 0) throw new Error('A backend party API token is required.');
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${options.token}`,
        ...(init.headers ?? {})
      }
    });
    const value = await responseJson(response);
    if (!response.ok) throw errorFromResponse(response, value);
    return value;
  }

  async function createParty(): Promise<BackendParty> {
    const value = await request('/v1/parties', { method: 'POST' });
    const party = isRecord(value) ? parseParty(value.party) : null;
    if (!party) throw new BackendPartyApiError('invalid_party_response', 502, 'The backend returned an invalid party response.');
    return party;
  }

  async function getCurrentParty(): Promise<BackendParty | null> {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}/v1/parties/current`, {
        headers: { authorization: `Bearer ${options.token}` }
      });
    } catch (error) {
      throw error;
    }
    const value = await responseJson(response);
    if (response.status === 404) return null;
    if (!response.ok) throw errorFromResponse(response, value);
    const party = isRecord(value) ? parseParty(value.party) : null;
    if (!party) throw new BackendPartyApiError('invalid_party_response', 502, 'The backend returned an invalid party response.');
    return party;
  }

  async function joinParty(rawJoinCode: string): Promise<BackendParty> {
    const joinCode = normalizePartyJoinCode(rawJoinCode);
    if (!joinCode) throw new BackendPartyApiError('invalid_join_code', 400, 'Enter a valid 10-character party join code.');
    const value = await request('/v1/parties/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ joinCode })
    });
    const party = isRecord(value) ? parseParty(value.party) : null;
    if (!party) throw new BackendPartyApiError('invalid_party_response', 502, 'The backend returned an invalid party response.');
    return party;
  }

  async function leaveParty(): Promise<void> {
    await request('/v1/parties/current', { method: 'DELETE' });
  }

  return Object.freeze({ createParty, getCurrentParty, joinParty, leaveParty });
}
