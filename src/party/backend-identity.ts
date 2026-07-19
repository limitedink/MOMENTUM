const IDENTITY_STORAGE_KEY = 'momentum-backend-dev-session-v1';
const DEFAULT_DISPLAY_NAME = 'Player';
const DISPLAY_NAME_MAX_LENGTH = 24;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface BackendPlayerSession {
  playerId: string;
  displayName: string;
  token: string;
  sessionId: string | null;
}

export interface BackendIdentityClient {
  acquire(): Promise<BackendPlayerSession>;
  getLastRequestedDisplayName?: () => string | null;
}

export interface BackendIdentityClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  storage?: StorageLike;
  displayName?: string;
  displayNameProvider?: () => string | Promise<string>;
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
    return {
      playerId: value.playerId,
      displayName: normalizeDisplayName(value.displayName) ?? DEFAULT_DISPLAY_NAME,
      token: value.token,
      sessionId: value.sessionId
    };
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

function displayNameFromResponse(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value.player) || typeof value.player.displayName !== 'string') return null;
  return normalizeDisplayName(value.player.displayName);
}

function sessionFromCreateResponse(value: unknown): BackendPlayerSession | null {
  const playerId = playerIdFromResponse(value);
  const displayName = displayNameFromResponse(value);
  if (!playerId || !isRecord(value) || typeof value.token !== 'string' || value.token.length === 0 ||
    typeof value.sessionId !== 'string' || value.sessionId.length === 0 || !displayName) return null;
  return { playerId, displayName, token: value.token, sessionId: value.sessionId };
}

function normalizeDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  const characters = [...normalized];
  if (characters.length < 1 || characters.length > DISPLAY_NAME_MAX_LENGTH) return null;
  if (characters.some(character => /\p{Cc}/u.test(character))) return null;
  return normalized;
}

async function requestedDisplayName(options: BackendIdentityClientOptions): Promise<string> {
  const explicit = normalizeDisplayName(options.displayName);
  if (explicit) return explicit;
  if (options.displayNameProvider) {
    const provided = normalizeDisplayName(await options.displayNameProvider());
    if (provided) return provided;
  }
  if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
    try {
      const provided = normalizeDisplayName(window.prompt('Choose a development display name (1–24 characters):', DEFAULT_DISPLAY_NAME));
      if (provided) return provided;
    } catch {
      // Embedded browsers may not implement prompt(); use the safe development default.
    }
  }
  return DEFAULT_DISPLAY_NAME;
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
  let lastRequestedDisplayName: string | null = null;

  async function acquire(): Promise<BackendPlayerSession> {
    const stored = readStoredSession(storage);
    if (stored) {
      lastRequestedDisplayName = stored.displayName;
      try {
        const response = await fetchImpl(`${baseUrl}/v1/me`, { headers: { authorization: `Bearer ${stored.token}` } });
        const value = await responseJson(response);
        const displayName = displayNameFromResponse(value);
        if (response.ok && playerIdFromResponse(value) === stored.playerId) {
          const refreshed = { ...stored, displayName: displayName ?? stored.displayName };
          storeSession(storage, refreshed);
          return refreshed;
        }
      } catch {
        // Fall through to a fresh development identity.
      }
      clearStoredSession(storage);
    }

    const displayName = await requestedDisplayName(options);
    lastRequestedDisplayName = displayName;
    const response = await fetchImpl(`${baseUrl}/v1/dev/players`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName })
    });
    const value = await responseJson(response);
    if (!response.ok) throw new Error(`Backend identity acquisition failed with HTTP ${response.status}.`);
    const session = sessionFromCreateResponse(value);
    if (!session) throw new Error('Backend identity response was invalid.');
    storeSession(storage, session);
    return session;
  }

  return Object.freeze({ acquire, getLastRequestedDisplayName: () => lastRequestedDisplayName });
}

export function getConfiguredBackendBaseUrl(): string {
  return normalizeBaseUrl(import.meta.env.VITE_MOMENTUM_BACKEND_URL);
}

export { IDENTITY_STORAGE_KEY };
