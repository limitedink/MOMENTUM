export interface Player {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePlayerInput {
  // empty for now; identity is temporary/dev
}

export interface PlayerRepository {
  create(): Promise<Player>;
  findById(id: string): Promise<Player | null>;
}
