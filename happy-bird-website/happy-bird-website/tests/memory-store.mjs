// Tiny in-memory stand-in for @netlify/blobs, used by tests only.
export function memoryStoreFactory() {
  const stores = new Map();
  return (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    return {
      async get(k) { return m.has(k) ? JSON.parse(m.get(k)) : null; },
      async setJSON(k, v) { m.set(k, JSON.stringify(v)); },
    };
  };
}
