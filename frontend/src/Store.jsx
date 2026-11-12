import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api } from './api.js';
import { createCartClient } from './cart/cart-client.js';
import { submitCredentials } from './auth/model.js';
import { createCheckoutClient } from './checkout/checkout-client.js';
import { StoreContext } from './store-context.js';

export { useStore } from './store-context.js';
function readSaved(key, fallback, validate) {
  try {
    const value = JSON.parse(localStorage.getItem(`takistir-preview:${key}`));
    return validate(value) ? value : fallback;
  } catch {
    return fallback;
  }
}
export function StoreProvider({ children }) {
  const [snapshot, setSnapshot] = useState(null);
  const [connectionError, setConnectionError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const epoch = useRef(0);
  const sequence = useRef(0);
  const sessionUser = useRef(null);
  const [cartClient] = useState(() => createCartClient(api));
  const [checkoutClient] = useState(() =>
    createCheckoutClient({
      request: api,
      cart: cartClient,
      getUser: () => sessionUser.current,
      applyState: apply,
    }),
  );
  const checkout = useSyncExternalStore(
    checkoutClient.subscribe,
    checkoutClient.getSnapshot,
  );
  const cartState = useSyncExternalStore(
    cartClient.subscribe,
    cartClient.getSnapshot,
  );
  const cartItems = cartState.items;
  const cart = cartItems.map(({ id, qty }) => ({ id, qty }));
  const total = cartState.total;
  const [wishlist, setWishlist] = useState(() =>
    readSaved(
      'wishlist',
      [],
      (v) => Array.isArray(v) && v.every((id) => typeof id === 'string'),
    ),
  );
  const [address, setAddress] = useState(null);
  const [toast, setToast] = useState('');
  const [authNotice, setAuthNotice] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);
  const allProducts = snapshot?.products || [];
  const products = allProducts.filter((p) => !p.archived);
  const user = snapshot?.user || null;

  function apply(state) {
    if (sessionUser.current?.id !== state.user?.id) checkoutClient.reset();
    sessionUser.current = state.user;
    cartClient.setOwner(state.user);
    setAuthNotice((current) =>
      current?.userId === state.user?.id ? current : null,
    );
    setSnapshot((current) =>
      current &&
      current.user?.id === state.user?.id &&
      current.revision > state.revision
        ? current
        : state,
    );
  }
  async function refresh() {
    if (pending.current || checkoutClient.getSnapshot().pending) return;
    const version = epoch.current;
    const request = ++sequence.current;
    try {
      const response = await api('/state');
      if (version !== epoch.current || request !== sequence.current) return;
      apply(response.state);
      setConnectionError('');
    } catch (error) {
      if (version === epoch.current) setConnectionError(error.message);
    } finally {
      if (version === epoch.current && request === sequence.current)
        cartClient.refresh();
    }
  }
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 3000);
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      epoch.current += 1;
      cartClient.dispose();
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, []);
  useEffect(() => {
    if (!snapshot) return;
    const visible = new Set(
      snapshot.products.filter((p) => !p.archived).map((p) => p.id),
    );
    setWishlist((items) => items.filter((id) => visible.has(id)));
  }, [snapshot]);
  useEffect(() => {
    setAddress(null);
  }, [user?.id]);
  useEffect(() => {
    try {
      localStorage.setItem(
        'takistir-preview:wishlist',
        JSON.stringify(wishlist),
      );
    } catch {
      /* Storage is optional. */
    }
  }, [wishlist]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function mutate(path, method, body, message) {
    if (
      pending.current ||
      cartClient.getSnapshot().pending ||
      checkoutClient.getSnapshot().pending
    )
      return { error: 'Please wait for the current request to finish.' };
    pending.current = true;
    epoch.current += 1;
    setBusy(true);
    try {
      const response = await api(path, { method, body });
      apply(response.state);
      await cartClient.refresh();
      setConnectionError('');
      if (message) setToast(message);
      return { data: response.data, state: response.state, error: '' };
    } catch (error) {
      setToast(error.message);
      return { error: error.message };
    } finally {
      pending.current = false;
      setBusy(false);
      refresh();
    }
  }
  const managerPath = '/manager';
  async function saveProduct(draft, editingId) {
    // Only Product Manager fields cross the API boundary.
    const fields = [
      'id',
      'name',
      'category',
      'model',
      'serial',
      'description',
      'warranty',
      'distributor',
      'material',
      'stock',
      'image',
    ];
    const body = Object.fromEntries(fields.map((key) => [key, draft[key]]));
    return (
      await mutate(
        `${managerPath}/products${editingId ? `/${encodeURIComponent(editingId)}` : ''}`,
        editingId ? 'PUT' : 'POST',
        body,
        'Product saved.',
      )
    ).error;
  }
  async function removeProduct(id) {
    return (
      await mutate(
        `${managerPath}/products/${encodeURIComponent(id)}`,
        'DELETE',
        undefined,
        'Product removed. Historical orders are retained.',
      )
    ).error;
  }
  async function updateStock(id, stock) {
    return (
      await mutate(
        `${managerPath}/products/${encodeURIComponent(id)}/stock`,
        'PATCH',
        { stock },
        'Stock updated.',
      )
    ).error;
  }
  async function addCategory(name) {
    return (
      await mutate(
        `${managerPath}/categories`,
        'POST',
        { name },
        'Category added.',
      )
    ).error;
  }
  async function removeCategory(name) {
    return (
      await mutate(
        `${managerPath}/categories/${encodeURIComponent(name)}`,
        'DELETE',
        undefined,
        'Category removed.',
      )
    ).error;
  }
  async function updateOrderStatus(id, status) {
    return (
      await mutate(
        `${managerPath}/orders/${encodeURIComponent(id)}/status`,
        'PATCH',
        { status },
        'Order status updated.',
      )
    ).error;
  }
  async function submitReview(productId, rating, comment) {
    return (
      await mutate(
        '/reviews',
        'POST',
        { productId, rating, comment },
        'Your rating and comment are awaiting approval.',
      )
    ).error;
  }
  async function moderateReview(id, status) {
    return (
      await mutate(
        `${managerPath}/reviews/${encodeURIComponent(id)}`,
        'PATCH',
        { status },
        `Review ${status.toLowerCase()}.`,
      )
    ).error;
  }
  async function login(email, password, registerName, confirmation, home) {
    const result = await submitCredentials(
      { email, password, name: registerName, confirmation, home },
      mutate,
    );
    if (result.error) return result;
    const cartError =
      result.state.user.role === 'customer'
        ? cartClient.getSnapshot().syncError
        : '';
    const message = [
      result.notice,
      result.profileError,
      cartError
        ? 'You are signed in, but your cart could not be loaded. Open your cart and retry.'
        : '',
    ]
      .filter(Boolean)
      .join(' ');
    setAuthNotice(message ? { userId: result.state.user.id, message } : null);
    return { ...result, cartError };
  }
  async function logout() {
    return (await mutate('/auth/logout', 'POST', {}, 'Signed out.')).error;
  }
  async function updateProfile(fields) {
    return (await mutate('/profile', 'PATCH', fields, 'Profile saved.')).error;
  }
  async function cartAction(action, message) {
    if (pending.current) {
      setToast('Please wait for the current request to finish.');
      return false;
    }
    if (
      checkoutClient.getSnapshot().pending ||
      checkoutClient.getSnapshot().uncertain ||
      checkoutClient.getSnapshot().cleanupError
    ) {
      setToast('Resolve your previous checkout before changing your cart.');
      return false;
    }
    const result = await action();
    setToast(result.error || message);
    return !result.error;
  }
  function addToCart(id, qty = 1) {
    return cartAction(
      () => cartClient.add(id, qty),
      'Product added to your cart.',
    );
  }
  function updateQuantity(id, qty) {
    return cartAction(
      () => cartClient.setQuantity(id, qty),
      qty === 0 ? 'Product removed from your cart.' : 'Cart updated.',
    );
  }
  function clearCart() {
    return cartAction(() => cartClient.clear(), 'Cart cleared.');
  }
  function toggleWishlist(id) {
    setWishlist((items) =>
      items.includes(id) ? items.filter((item) => item !== id) : [...items, id],
    );
  }
  async function placeOrder(reviewedQuote) {
    if (
      pending.current ||
      cartClient.getSnapshot().pending ||
      checkoutClient.getSnapshot().pending
    )
      return { error: 'Please wait for the current request to finish.' };
    pending.current = true;
    epoch.current += 1;
    try {
      const result = await checkoutClient.submit(address, reviewedQuote);
      if (result.order) setToast(`Order ${result.order.id} confirmed.`);
      else if (result.error) setToast(result.error);
      return result;
    } finally {
      pending.current = false;
      refresh();
    }
  }
  async function cancelOrder(id) {
    return (
      await mutate(
        `/orders/${encodeURIComponent(id)}/cancel`,
        'POST',
        {},
        'Order cancelled.',
      )
    ).error;
  }
  async function requestReturn(id, selected) {
    return !(
      await mutate(
        `/orders/${encodeURIComponent(id)}/returns`,
        'POST',
        { selected },
        'Return requested.',
      )
    ).error;
  }
  return (
    <StoreContext.Provider
      value={{
        products,
        allProducts,
        categories: snapshot?.categories || [],
        orders: snapshot?.orders || [],
        reviews: snapshot?.reviews || [],
        user,
        login,
        logout,
        updateProfile,
        saveProduct,
        removeProduct,
        updateStock,
        addCategory,
        removeCategory,
        updateOrderStatus,
        submitReview,
        moderateReview,
        cart,
        cartItems,
        total,
        cartReady: cartState.ready,
        cartEnabled: cartState.enabled,
        cartLoading: cartState.loading,
        cartBusy: cartState.pending,
        cartError: cartState.error || cartState.syncError || connectionError,
        cartSyncError: cartState.syncError || connectionError,
        refreshCart: () => cartClient.refresh({ clearError: true }),
        clearCart,
        wishlist,
        address,
        setAddress,
        addToCart,
        updateQuantity,
        toggleWishlist,
        placeOrder,
        checkout,
        retryCheckoutCleanup: checkoutClient.retryCleanup,
        acknowledgeCheckout: checkoutClient.acknowledgeReview,
        cancelOrder,
        requestReturn,
        toast,
        setToast,
        chatOpen,
        setChatOpen,
        busy: busy || cartState.pending || checkout.pending,
        connectionError,
      }}
    >
      {snapshot ? (
        <>
          {connectionError && (
            <div className="notice" role="alert">
              {connectionError} Displayed data may be stale.
            </div>
          )}
          {authNotice && (
            <div className="notice auth-notice" role="status">
              <p>{authNotice.message}</p>
              <button
                className="text-button"
                aria-label="Dismiss account notification"
                onClick={() => setAuthNotice(null)}
              >
                Dismiss
              </button>
            </div>
          )}
          {children}
        </>
      ) : (
        <main className="container page">
          <h1>Takıştır</h1>
          <p role="status">{connectionError || 'Connecting to the store…'}</p>
          {connectionError && (
            <button className="button" onClick={refresh}>
              Retry connection
            </button>
          )}
        </main>
      )}
    </StoreContext.Provider>
  );
}
