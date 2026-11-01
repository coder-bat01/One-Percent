type Listener = () => void;
type EventBus = Map<string, Set<Listener>>;
const processState = globalThis as typeof globalThis & {
  onePercentEvents?: EventBus;
  onePercentConnections?: Map<string, number>;
};
const listeners = (processState.onePercentEvents ??= new Map());
const connections = (processState.onePercentConnections ??= new Map());

export const MAX_CONNECTIONS_PER_USER = 10;

export function acquireConnection(userId: string): boolean {
  const count = connections.get(userId) ?? 0;
  if (count >= MAX_CONNECTIONS_PER_USER) return false;
  connections.set(userId, count + 1);
  return true;
}

export function releaseConnection(userId: string): void {
  const count = connections.get(userId) ?? 0;
  if (count <= 1) connections.delete(userId);
  else connections.set(userId, count - 1);
}

export function subscribe(userId: string, listener: Listener): () => void {
  let userListeners = listeners.get(userId);
  if (!userListeners) listeners.set(userId, (userListeners = new Set()));
  userListeners.add(listener);
  return () => {
    userListeners.delete(listener);
    if (!userListeners.size) listeners.delete(userId);
  };
}

export function notify(userIds: Iterable<string>) {
  for (const id of new Set(userIds)) {
    for (const listener of listeners.get(id) ?? []) {
      try {
        listener();
      } catch {
        /* A disconnected stream cannot block a saved mutation. */
      }
    }
  }
}
