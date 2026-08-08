export function lookup<K, V>(held: Map<K, V>, key: K): readonly V[] {
  if (held.has(key) === false) {
    return [];
  }
  const found = held.get(key);
  if (found === undefined) {
    return [];
  }
  return [found];
}
