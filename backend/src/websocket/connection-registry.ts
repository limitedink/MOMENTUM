export interface RegistrySocket {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type ConnectionStatus = 'authenticating' | 'connected' | 'closing' | 'closed';

export interface WebSocketConnectionSession {
  connectionId: string;
  playerId: string | null;
  partyId: string | null;
  sessionId: string | null;
  connectedAt: number;
  lastActivityAt: number;
  status: ConnectionStatus;
}

export interface RegisteredConnection {
  session: WebSocketConnectionSession;
  socket: RegistrySocket;
}

export interface PartyScopeChange {
  connection: RegisteredConnection;
  oldPartyId: string | null;
  newPartyId: string | null;
}

export interface ConnectionRegistry {
  register(connection: RegisteredConnection): void;
  remove(connectionId: string): RegisteredConnection | null;
  getByConnectionId(connectionId: string): RegisteredConnection | null;
  getByPlayer(playerId: string): RegisteredConnection[];
  getByParty(partyId: string): RegisteredConnection[];
  countPlayerConnections(playerId: string, partyId?: string | null): number;
  updatePlayerParty(playerId: string, partyId: string | null): PartyScopeChange[];
  broadcastParty(partyId: string, data: string, excludeConnectionId?: string): number;
  closeAll(code: number, reason: string): void;
  size(): number;
}

const OPEN_READY_STATE = 1;

function addToSet(map: Map<string, Set<string>>, key: string, connectionId: string): void {
  const connections = map.get(key) ?? new Set<string>();
  connections.add(connectionId);
  map.set(key, connections);
}

function removeFromSet(map: Map<string, Set<string>>, key: string, connectionId: string): void {
  const connections = map.get(key);
  if (!connections) return;
  connections.delete(connectionId);
  if (connections.size === 0) map.delete(key);
}

export function createConnectionRegistry(): ConnectionRegistry {
  const connections = new Map<string, RegisteredConnection>();
  const connectionsByPlayer = new Map<string, Set<string>>();
  const connectionsByParty = new Map<string, Set<string>>();

  function addIndexes(connection: RegisteredConnection): void {
    const { session } = connection;
    if (session.playerId) addToSet(connectionsByPlayer, session.playerId, session.connectionId);
    if (session.partyId) addToSet(connectionsByParty, session.partyId, session.connectionId);
  }

  function removeIndexes(connection: RegisteredConnection): void {
    const { session } = connection;
    if (session.playerId) removeFromSet(connectionsByPlayer, session.playerId, session.connectionId);
    if (session.partyId) removeFromSet(connectionsByParty, session.partyId, session.connectionId);
  }

  function entriesForIds(ids: Set<string> | undefined): RegisteredConnection[] {
    if (!ids) return [];
    return [...ids].map(connectionId => connections.get(connectionId)).filter(
      (connection): connection is RegisteredConnection => connection !== undefined
    );
  }

  return {
    register(connection): void {
      if (connections.has(connection.session.connectionId)) {
        throw new Error('Connection ID is already registered.');
      }
      connection.session.status = 'connected';
      connections.set(connection.session.connectionId, connection);
      addIndexes(connection);
    },

    remove(connectionId): RegisteredConnection | null {
      const connection = connections.get(connectionId);
      if (!connection) return null;
      removeIndexes(connection);
      connections.delete(connectionId);
      connection.session.status = 'closed';
      return connection;
    },

    getByConnectionId(connectionId): RegisteredConnection | null {
      return connections.get(connectionId) ?? null;
    },

    getByPlayer(playerId): RegisteredConnection[] {
      return entriesForIds(connectionsByPlayer.get(playerId));
    },

    getByParty(partyId): RegisteredConnection[] {
      return entriesForIds(connectionsByParty.get(partyId));
    },

    countPlayerConnections(playerId, partyId = undefined): number {
      return this.getByPlayer(playerId).filter(connection => partyId === undefined || connection.session.partyId === partyId).length;
    },

    updatePlayerParty(playerId, partyId): PartyScopeChange[] {
      const playerConnections = this.getByPlayer(playerId);
      const changes = playerConnections
        .filter(connection => connection.session.partyId !== partyId)
        .map(connection => ({
          connection,
          oldPartyId: connection.session.partyId,
          newPartyId: partyId
        }));

      // Remove every old scope before adding the new scope so a refresh cannot
      // publish a connection in both party indexes, even within this tick.
      for (const change of changes) {
        if (change.oldPartyId) removeFromSet(connectionsByParty, change.oldPartyId, change.connection.session.connectionId);
      }
      for (const change of changes) {
        change.connection.session.partyId = partyId;
        if (partyId) addToSet(connectionsByParty, partyId, change.connection.session.connectionId);
      }
      return changes;
    },

    broadcastParty(partyId, data, excludeConnectionId): number {
      let sent = 0;
      for (const connection of this.getByParty(partyId)) {
        if (connection.session.connectionId === excludeConnectionId || connection.socket.readyState !== OPEN_READY_STATE) continue;
        try {
          connection.socket.send(data);
          sent += 1;
        } catch {
          try {
            connection.socket.close(1011, 'server.internal_error');
          } catch {
            // The socket close event remains responsible for registry cleanup.
          }
        }
      }
      return sent;
    },

    closeAll(code, reason): void {
      const allConnections = [...connections.values()];
      connections.clear();
      connectionsByPlayer.clear();
      connectionsByParty.clear();
      for (const connection of allConnections) {
        connection.session.status = 'closed';
        try {
          connection.socket.close(code, reason);
        } catch {
          // Shutdown should continue even when a socket is already gone.
        }
      }
    },

    size(): number {
      return connections.size;
    }
  };
}
