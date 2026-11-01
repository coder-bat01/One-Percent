type Listener = () => void;
type EventBus = Map<string, Set<Listener>>;
const processState = globalThis as typeof globalThis & {
  onePercentEvents?: EventBus;
};
const listeners = (processState.onePercentEvents ??= new Map());

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
