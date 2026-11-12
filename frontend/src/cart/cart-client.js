// The API owns cart prices, availability, quantities and totals. Never rebuild
// its response from the catalogue: removed/unpriced items must remain visible.
export function createCartClient(request) {
  let owner;
  let generation = 0;
  let readVersion = 0;
  let readController;
  let state = emptyState(false);
  const listeners = new Set();

  function publish(fields) {
    state = { ...state, ...fields };
    listeners.forEach((listener) => listener());
  }
  function stopRead() {
    readVersion += 1;
    readController?.abort();
  }
  function setOwner(user) {
    const next = user ? `${user.role}:${user.id}` : 'guest';
    if (next === owner) return;
    owner = next;
    generation += 1;
    stopRead();
    state = emptyState(!user || user.role === 'customer');
    listeners.forEach((listener) => listener());
  }
  async function refresh({ force = false, clearError = false } = {}) {
    if (!state.enabled || (!force && (state.pending || state.loading))) return;
    stopRead();
    const version = readVersion;
    const scope = generation;
    readController = new AbortController();
    publish({ loading: true, ...(clearError ? { error: '' } : {}) });
    try {
      const cart = await request('/cart', { signal: readController.signal });
      if (scope !== generation || version !== readVersion) return;
      publish({ ...cart, ready: true, syncError: '' });
      return { error: '', cart };
    } catch (error) {
      if (scope !== generation || version !== readVersion) return;
      if (error.name !== 'AbortError') publish({ syncError: error.message });
      return { error: error.message };
    } finally {
      if (scope === generation && version === readVersion)
        publish({ loading: false });
    }
  }
  async function change(path, method, body) {
    if (!state.enabled)
      return { error: 'Only customers and guests have a shopping cart.' };
    if (state.pending)
      return { error: 'Please wait for the current cart update to finish.' };
    if (!state.ready)
      return { error: 'Your cart is not ready. Please retry loading it.' };
    const scope = generation;
    stopRead();
    publish({ pending: true, loading: false, error: '' });
    try {
      const cart = await request(path, { method, body });
      if (scope !== generation) return { error: 'The account has changed.' };
      publish({ ...cart, ready: true, syncError: '' });
      return { error: '' };
    } catch (error) {
      if (scope !== generation) return { error: 'The account has changed.' };
      publish({ error: error.message });
      // A failed write can mean stock changed, or its response was lost. Read
      // the server's actual cart; never optimistically change or retry the write.
      await refresh({ force: true });
      return { error: error.message };
    } finally {
      if (scope === generation) publish({ pending: false });
    }
  }
  function setQuantity(id, qty) {
    if (!Number.isSafeInteger(qty) || qty < 0)
      return Promise.resolve({
        error: 'Quantity must be a whole number of at least 1.',
      });
    return change(
      `/cart/items/${encodeURIComponent(id)}`,
      qty === 0 ? 'DELETE' : 'PUT',
      qty === 0 ? undefined : { qty },
    );
  }
  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setOwner,
    refresh,
    setQuantity,
    add(id, qty = 1) {
      if (!Number.isSafeInteger(qty) || qty < 1)
        return Promise.resolve({
          error: 'Quantity must be a whole number of at least 1.',
        });
      const existing = state.items.find((item) => item.id === id)?.qty || 0;
      return setQuantity(id, existing + qty);
    },
    clear: () => change('/cart', 'DELETE'),
    dispose() {
      generation += 1;
      stopRead();
      publish({ loading: false, pending: false });
    },
  };
}

function emptyState(enabled) {
  return {
    items: [],
    total: 0,
    enabled,
    ready: false,
    loading: false,
    pending: false,
    error: '',
    syncError: '',
  };
}
