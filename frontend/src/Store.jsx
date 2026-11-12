import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

const StoreContext = createContext(null);
const defaultCart = [
  { id: 'TK-001', qty: 1 },
  { id: 'TK-002', qty: 1 },
];
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
  const checkoutKey = useRef(null);
  const [cart, setCart] = useState(() =>
    readSaved(
      'cart',
      defaultCart,
      (v) =>
        Array.isArray(v) &&
        v.every(
          (i) =>
            typeof i.id === 'string' &&
            Number.isSafeInteger(i.qty) &&
            i.qty > 0,
        ),
    ),
  );
  const [wishlist, setWishlist] = useState(() =>
    readSaved(
      'wishlist',
      [],
      (v) => Array.isArray(v) && v.every((id) => typeof id === 'string'),
    ),
  );
  const [address, setAddress] = useState(null);
  const [toast, setToast] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const allProducts = snapshot?.products || [];
  const products = allProducts.filter((p) => !p.archived);
  const user = snapshot?.user || null;

  function apply(state) {
    setSnapshot((current) =>
      current &&
      current.user?.id === state.user?.id &&
      current.revision > state.revision
        ? current
        : state,
    );
  }
  async function refresh() {
    if (pending.current) return;
    const version = epoch.current;
    const request = ++sequence.current;
    try {
      const response = await api('/state');
      if (version !== epoch.current || request !== sequence.current) return;
      apply(response.state);
      setConnectionError('');
    } catch (error) {
      if (version === epoch.current) setConnectionError(error.message);
    }
  }
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 3000);
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      epoch.current += 1;
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, []);
  useEffect(() => {
    if (!snapshot) return;
    const ids = new Set(
      snapshot.products
        .filter((p) => !p.archived && p.price !== null)
        .map((p) => p.id),
    );
    setCart((items) => items.filter((i) => ids.has(i.id)));
    const visible = new Set(
      snapshot.products.filter((p) => !p.archived).map((p) => p.id),
    );
    setWishlist((items) => items.filter((id) => visible.has(id)));
  }, [snapshot]);
  useEffect(() => {
    setAddress(null);
    checkoutKey.current = null;
  }, [user?.id]);
  useEffect(() => {
    try {
      localStorage.setItem('takistir-preview:cart', JSON.stringify(cart));
      localStorage.setItem(
        'takistir-preview:wishlist',
        JSON.stringify(wishlist),
      );
    } catch {
      /* Storage is optional. */
    }
  }, [cart, wishlist]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function mutate(path, method, body, message) {
    if (pending.current)
      return { error: 'Please wait for the current request to finish.' };
    pending.current = true;
    epoch.current += 1;
    setBusy(true);
    try {
      const response = await api(path, { method, body });
      apply(response.state);
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
        'Your rating is published. Your comment is awaiting approval.',
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
  async function login(email, password, registerName) {
    return mutate(
      registerName !== undefined ? '/auth/register' : '/auth/login',
      'POST',
      {
        email,
        password,
        ...(registerName !== undefined ? { name: registerName } : {}),
      },
      'Signed in.',
    );
  }
  async function logout() {
    return (await mutate('/auth/logout', 'POST', {}, 'Signed out.')).error;
  }
  async function updateProfile(fields) {
    return (await mutate('/profile', 'PATCH', fields, 'Profile saved.')).error;
  }
  function addToCart(id, qty = 1) {
    const product = products.find((p) => p.id === id);
    if (
      !product ||
      product.price === null ||
      !Number.isSafeInteger(qty) ||
      qty < 1
    ) {
      setToast('This product is not available to purchase.');
      return;
    }
    setCart((items) => {
      const current = items.find((i) => i.id === id)?.qty || 0;
      if (current + qty > product.stock) return items;
      return items.some((i) => i.id === id)
        ? items.map((i) => (i.id === id ? { ...i, qty: i.qty + qty } : i))
        : [...items, { id, qty }];
    });
    const existing = cart.find((i) => i.id === id)?.qty || 0;
    setToast(
      existing + qty > product.stock
        ? 'The requested quantity is not available.'
        : `${product.name} added to your cart.`,
    );
  }
  function updateQuantity(id, qty) {
    const product = products.find((p) => p.id === id);
    if (!Number.isSafeInteger(qty) || qty < 0) return;
    if (qty === 0) {
      setCart((items) => items.filter((i) => i.id !== id));
      return;
    }
    if (!product || qty > product.stock) {
      setToast('No more stock is available.');
      return;
    }
    setCart((items) => items.map((i) => (i.id === id ? { ...i, qty } : i)));
  }
  function toggleWishlist(id) {
    setWishlist((items) =>
      items.includes(id) ? items.filter((item) => item !== id) : [...items, id],
    );
  }
  async function placeOrder() {
    if (!cart.length || !address || user?.role !== 'customer') {
      setToast('Sign in with a customer account and enter a delivery address.');
      return null;
    }
    const payload = JSON.stringify({ items: cart, address });
    if (!checkoutKey.current || checkoutKey.current.payload !== payload)
      checkoutKey.current = { payload, key: crypto.randomUUID() };
    const result = await mutate(
      '/orders',
      'POST',
      { items: cart, address, key: checkoutKey.current.key },
      'Order placed.',
    );
    if (result.error) return null;
    setCart([]);
    checkoutKey.current = null;
    return result.state.orders.find((o) => o.id === result.data);
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
  const cartItems = cart.flatMap((item) => {
    const p = products.find((p) => p.id === item.id);
    return p && p.price !== null ? [{ ...p, qty: item.qty }] : [];
  });
  const total = cartItems.reduce((sum, i) => sum + i.price * i.qty, 0);
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
        wishlist,
        address,
        setAddress,
        addToCart,
        updateQuantity,
        toggleWishlist,
        placeOrder,
        cancelOrder,
        requestReturn,
        toast,
        setToast,
        chatOpen,
        setChatOpen,
        busy,
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
export function useStore() {
  return useContext(StoreContext);
}
