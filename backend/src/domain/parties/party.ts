export const DEFAULT_PARTY_MAX_MEMBERS = 4;

export interface Party {
  id: string;
  leaderId: string;
  joinCode: string;
  maxMembers: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PartyMembership {
  partyId: string;
  playerId: string;
  joinedAt: Date;
}

export interface PartyWithMembers {
  party: Party;
  members: PartyMembership[];
}

export interface CreatePartyInput {
  leaderId: string;
  joinCode: string;
  maxMembers: number;
}

export interface PartyRepository {
  lockPlayer(playerId: string): Promise<boolean>;
  create(input: CreatePartyInput): Promise<Party>;
  findById(id: string): Promise<Party | null>;
  findByJoinCode(joinCode: string, forUpdate?: boolean): Promise<Party | null>;
  findByMemberId(playerId: string, forUpdate?: boolean): Promise<Party | null>;
  getWithMembers(partyId: string): Promise<PartyWithMembers | null>;
  listMembers(partyId: string): Promise<PartyMembership[]>;
  countMembers(partyId: string): Promise<number>;
  addMember(partyId: string, playerId: string): Promise<PartyMembership>;
  removeMember(partyId: string, playerId: string): Promise<void>;
  setLeader(partyId: string, playerId: string): Promise<void>;
  delete(partyId: string): Promise<void>;
}

export interface TransactionalPartyRepository extends PartyRepository {
  withTransaction<T>(work: (repository: PartyRepository) => Promise<T>): Promise<T>;
}
