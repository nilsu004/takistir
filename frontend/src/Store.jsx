import { createContext, useContext, useEffect, useState } from 'react';
import {
  initialOrders,
  previewDate,
  products as catalog,
  returnEligible,
} from './data.js';

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
  const [cart, setCart] = useState(() =>
    readSaved(
      'cart',
      defaultCart,
      (v) =>
        Array.isArray(v) &&
        v.every(
          (item) =>
            catalog.some((p) => p.id === item.id) &&
            Number.isInteger(item.qty) &&
            item.qty > 0,
        ),
    ),
  );
  const [wishlist, setWishlist] = useState(() =>
    readSaved(
      'wishlist',
      [],
      (v) =>
        Array.isArray(v) && v.every((id) => catalog.some((p) => p.id === id)),
    ),
  );
  const [products, setProducts] = useState(catalog);
  const [orders, setOrders] = useState(initialOrders);
  const [user, setUser] = useState(null);
  const [address, setAddress] = useState(null);
  const [toast, setToast] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const [reviews, setReviews] = useState([]);

  useEffect(() => {
    try {
      localStorage.setItem('takistir-preview:cart', JSON.stringify(cart));
      localStorage.setItem(
        'takistir-preview:wishlist',
        JSON.stringify(wishlist),
      );
    } catch {
      /* The preview also works when browser storage is unavailable. */
    }
  }, [cart, wishlist]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  function addToCart(id, qty = 1) {
    const product = products.find((p) => p.id === id);
    const existing = cart.find((item) => item.id === id)?.qty || 0;
    if (!product || qty < 1 || existing + qty > product.stock) {
      setToast('The requested quantity is not available.');
      return;
    }
    setCart((items) =>
      items.some((item) => item.id === id)
        ? items.map((item) =>
            item.id === id ? { ...item, qty: item.qty + qty } : item,
          )
        : [...items, { id, qty }],
    );
    setToast(`${product.name} added to your cart.`);
  }
  function updateQuantity(id, qty) {
    const product = products.find((p) => p.id === id);
    if (qty < 1) {
      setCart((items) => items.filter((item) => item.id !== id));
      return;
    }
    if (qty > product.stock) {
      setToast('No more stock is available.');
      return;
    }
    setCart((items) =>
      items.map((item) => (item.id === id ? { ...item, qty } : item)),
    );
  }
  function toggleWishlist(id) {
    setWishlist((items) =>
      items.includes(id) ? items.filter((item) => item !== id) : [...items, id],
    );
  }
  function placeOrder() {
    if (!user || !address || !cart.length) return null;
    if (
      cart.some(
        (item) => item.qty > products.find((p) => p.id === item.id).stock,
      )
    ) {
      setToast('Stock changed. Please review your cart.');
      return null;
    }
    const order = {
      id: `TK-${1025 + orders.length - initialOrders.length}`,
      date: previewDate.toISOString().slice(0, 10),
      status: 'Processing',
      items: cart.map((item) => ({
        ...item,
        price: products.find((p) => p.id === item.id).price,
      })),
      address: `${address.name} · ${address.street}, ${address.city} ${address.postcode}`,
    };
    setOrders((items) => [order, ...items]);
    setProducts((items) =>
      items.map((p) => ({
        ...p,
        stock: p.stock - (cart.find((item) => item.id === p.id)?.qty || 0),
      })),
    );
    setCart([]);
    return order;
  }
  function cancelOrder(id) {
    const order = orders.find((item) => item.id === id);
    if (!order || order.status !== 'Processing') return;
    setOrders((items) =>
      items.map((item) =>
        item.id === id ? { ...item, status: 'Cancelled' } : item,
      ),
    );
    // Seed orders did not reserve this preview's inventory.
    if (!initialOrders.some((item) => item.id === id))
      setProducts((items) =>
        items.map((p) => ({
          ...p,
          stock:
            p.stock + (order.items.find((item) => item.id === p.id)?.qty || 0),
        })),
      );
    setToast('Order cancelled.');
  }
  function requestReturn(id, selected) {
    const order = orders.find((item) => item.id === id);
    const items =
      order?.items
        .filter(
          (item) =>
            Number.isInteger(selected[item.id]) &&
            selected[item.id] > 0 &&
            selected[item.id] <= item.qty,
        )
        .map((item) => ({ ...item, qty: selected[item.id] })) || [];
    if (
      !order ||
      !returnEligible(order) ||
      order.returnRequest ||
      !items.length
    ) {
      setToast('Select at least one eligible item and a valid quantity.');
      return false;
    }
    setOrders((rows) =>
      rows.map((row) =>
        row.id === id
          ? {
              ...row,
              returnRequest: {
                id: `R-${102 + rows.filter((r) => r.returnRequest).length}`,
                status: 'Awaiting item',
                items,
                amount: items.reduce(
                  (sum, item) => sum + item.price * item.qty,
                  0,
                ),
              },
            }
          : row,
      ),
    );
    setToast('Return requested. Send the selected items back for review.');
    return true;
  }
  const cartItems = cart.map((item) => ({
    ...products.find((p) => p.id === item.id),
    qty: item.qty,
  }));
  const total = cartItems.reduce((sum, item) => sum + item.price * item.qty, 0);
  return (
    <StoreContext.Provider
      value={{
        products,
        cart,
        cartItems,
        total,
        wishlist,
        user,
        setUser,
        address,
        setAddress,
        orders,
        reviews,
        setReviews,
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
      }}
    >
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  return useContext(StoreContext);
}
