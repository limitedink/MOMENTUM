export interface Player {
  id: string;
  displayName: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePlayerInput {
  displayName: string;
}

export interface PlayerRepository {
  create(input: CreatePlayerInput): Promise<Player>;
  findById(id: string): Promise<Player | null>;
}

export const PLAYER_DISPLAY_NAME_MAX_LENGTH = 24;

export function normalizeDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  const characters = [...normalized];
  if (characters.length < 1 || characters.length > PLAYER_DISPLAY_NAME_MAX_LENGTH) return null;
  if (characters.some(character => /\p{Cc}/u.test(character))) return null;
  return normalized;
}
