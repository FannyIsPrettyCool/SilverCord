/** Async work belongs to the login that started it, even if a later login uses the same user. */
let generation = 0;
const requests = new Set<AbortController>();

export const captureAccountGeneration = () => generation;
export const isCurrentAccountGeneration = (startedIn: number) => startedIn === generation;

export function requireAccountGeneration(startedIn: number): void {
  if (!isCurrentAccountGeneration(startedIn))
    throw new DOMException('Account changed', 'AbortError');
}

export function trackAccountRequest(controller: AbortController): () => void {
  requests.add(controller);
  return () => requests.delete(controller);
}

export function advanceAccountGeneration(): void {
  generation += 1;
  for (const request of requests) request.abort();
  requests.clear();
}
