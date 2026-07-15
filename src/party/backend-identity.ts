const IDENTITY_STORAGE_KEY = 'momentum-backend-dev-session-v1';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface BackendPlayerSession {
  playerId: string;
  token: string;
  sessionId: string | null;
}

export interface BackendIdentityClient {
  acquire(): Promise<BackendPlayerSession>;
}

export interface BackendIdentityClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  storage?: StorageLike;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeBaseUrl(value: string | undefined): string {
  return (value ?? '').trim().replace(/\/$/, '');
}

function browserStorage(): StorageLike | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function readStoredSession(storage: StorageLike | undefined): BackendPlayerSession | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(IDENTITY_STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || typeof value.playerId !== 'string' || value.playerId.length === 0 ||
      typeof value.token !== 'string' || value.token.length === 0 ||
      !(value.sessionId === null || typeof value.sessionId === 'string')) return null;
    return { playerId: value.playerId, token: value.token, sessionId: value.sessionId };
  } catch {
    return null;
  }
}

function storeSession(storage: StorageLike | undefined, session: BackendPlayerSession): void {
  try {
    storage?.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // A session can still be used for this page lifetime when storage is unavailable.
  }
}

function clearStoredSession(storage: StorageLike | undefined): void {
  try {
    storage?.removeItem(IDENTITY_STORAGE_KEY);
  } catch {
    // Ignore storage failures; the next acquisition will try a new identity.
  }
}

function playerIdFromResponse(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value.player) || typeof value.player.id !== 'string' || value.player.id.length === 0) return null;
  return value.player.id;
}

function sessionFromCreateResponse(value: unknown): BackendPlayerSession | null {
  const playerId = playerIdFromResponse(value);
  if (!playerId || !isRecord(value) || typeof value.token !== 'string' || value.token.length === 0 ||
    typeof value.sessionId !== 'string' || value.sessionId.length === 0) return null;
  return { playerId, token: value.token, sessionId: value.sessionId };
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    return null;
  }
}

export function createBackendIdentityClient(options: BackendIdentityClientOptions = {}): BackendIdentityClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const storage = options.storage ?? browserStorage();

  async function acquire(): Promise<BackendPlayerSession> {
    const stored = readStoredSession(storage);
    if (stored) {
      try {
        const response = await fetchImpl(`${baseUrl}/v1/me`, { headers: { authorization: `Bearer ${stored.token}` } });
        const value = await responseJson(response);
        if (response.ok && playerIdFromResponse(value) === stored.playerId) return stored;
      } catch {
        // Fall through to a fresh development identity.
      }
      clearStoredSession(storage);
    }

    const response = await fetchImpl(`${baseUrl}/v1/dev/players`, { method: 'POST' });
    const value = await responseJson(response);
    if (!response.ok) throw new Error(`Backend identity acquisition failed with HTTP ${response.status}.`);
    const session = sessionFromCreateResponse(value);
    if (!session) throw new Error('Backend identity response was invalid.');
    storeSession(storage, session);
    return session;
  }

  return Object.freeze({ acquire });
}

export function getConfiguredBackendBaseUrl(): string {
  return normalizeBaseUrl(import.meta.env.VITE_MOMENTUM_BACKEND_URL);
}

export { IDENTITY_STORAGE_KEY };
