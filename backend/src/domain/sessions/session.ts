export interface Session {
  id: string;
  playerId: string;
  tokenHash: string;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  revokedAt?: Date | null;
}

export interface CreateSessionInput {
  playerId: string;
  tokenHash: string;
  expiresAt?: Date;
}

export interface SessionRepository {
  create(input: CreateSessionInput): Promise<Session>;
  findByTokenHash(hash: string): Promise<Session | null>;
  findById(id: string): Promise<Session | null>;
  revoke(id: string): Promise<void>;
  touchLastUsed(id: string): Promise<void>;
}
