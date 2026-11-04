import { createContext, useContext, useEffect, useState } from 'react';
import {
  initialOrders,
  previewDate,
  products as catalog,
  returnEligible,
} from './data.js';

import {
  canTransition,
  initialCategories,
  validateProduct,
} from './manager/model.js';

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
  const [products, setProducts] = useState(() =>
    catalog.map((p) => ({
      ...p,
      warranty: '2 years',
      distributor: 'Takıştır',
      ratingCount: p.popularity,
    })),
  );
  const [orders, setOrders] = useState(() =>
    initialOrders.map((o) => ({
      ...o,
      customerId: 'CU-001',
      address:
        'Deniz Yılmaz · Örnek Mah. Demo Sok. No: 12, Kadıköy, İstanbul 34710',
      deliveryId: `DL-${o.id}`,
      items: o.items.map((item) => ({
        ...item,
        name: catalog.find((p) => p.id === item.id).name,
        image: catalog.find((p) => p.id === item.id).image,
      })),
    })),
  );
  const [user, setUser] = useState(null);
  const [address, setAddress] = useState(null);
  const [toast, setToast] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const [categories, setCategories] = useState(initialCategories);
  const [reviews, setReviews] = useState([
    {
      id: 'RV-PUBLISHED',
      productId: 'TK-001',
      customerId: 'CU-SEED',
      author: 'A',
      rating: 5,
      comment: 'Elegant and suitable for everyday wear.',
      status: 'Approved',
    },
    {
      id: 'RV-DEMO',
      productId: 'TK-002',
      customerId: 'CU-001',
      author: 'Deniz Yılmaz',
      rating: 5,
      comment: 'Lovely pearl detail and comfortable to wear.',
      status: 'Pending',
    },
  ]);

  function saveProduct(draft, editingId) {
    draft = Object.fromEntries(
      Object.entries(draft).map(([key, value]) => [
        key,
        typeof value === 'string' ? value.trim() : value,
      ]),
    );
    const error = validateProduct(draft, products, categories, editingId);
    if (error) return error;
    const original = products.find((p) => p.id === editingId);
    if (editingId && (!original || original.archived))
      return 'Product is no longer available.';
    // Prices and campaigns are never accepted from the manager form.
    const {
      id,
      name,
      category,
      model,
      serial,
      description,
      warranty,
      distributor,
      material,
      stock,
      image,
    } = draft;
    const fields = {
      id,
      name,
      category,
      model,
      serial,
      description,
      warranty,
      distributor,
      material,
      stock,
      image,
    };
    setProducts((rows) =>
      editingId
        ? rows.map((p) =>
            p.id === editingId
              ? {
                  ...p,
                  ...fields,
                  detailImage:
                    p.image === fields.image ? p.detailImage : undefined,
                }
              : p,
          )
        : [
            ...rows,
            {
              ...fields,
              price: null,
              rating: 0,
              ratingCount: 0,
              popularity: 0,
              collection: 'New arrivals',
            },
          ],
    );
    setToast(
      editingId
        ? 'Product updated.'
        : 'Product added. Sales Manager pricing is pending.',
    );
    return '';
  }
  function removeProduct(id) {
    setProducts((rows) =>
      rows.map((p) => (p.id === id ? { ...p, archived: true } : p)),
    );
    setCart((rows) => rows.filter((item) => item.id !== id));
    setWishlist((rows) => rows.filter((item) => item !== id));
    setToast(
      'Product removed from the storefront. Order records are retained.',
    );
  }
  function updateStock(id, stock) {
    if (!Number.isSafeInteger(stock) || stock < 0 || stock > 1000000)
      return 'Enter a whole number between 0 and 1,000,000.';
    if (!products.some((p) => p.id === id && !p.archived))
      return 'Product not found.';
    setProducts((rows) => rows.map((p) => (p.id === id ? { ...p, stock } : p)));
    setToast('Stock updated. Existing carts are checked again at checkout.');
    return '';
  }
  function addCategory(name) {
    const value = name.trim();
    if (!value || value.length > 60)
      return 'Enter a category name of 1–60 characters.';
    if (
      ['All accessories', 'New arrivals', ...categories].some(
        (c) => c.toLowerCase() === value.toLowerCase(),
      )
    )
      return 'This category name is already used or reserved.';
    setCategories((rows) => [...rows, value]);
    setToast('Category added.');
    return '';
  }
  function removeCategory(name) {
    if (products.some((p) => !p.archived && p.category === name))
      return 'Move or remove products in this category first.';
    setCategories((rows) => rows.filter((c) => c !== name));
    setToast('Category removed.');
    return '';
  }
  function updateOrderStatus(id, status) {
    const order = orders.find((o) => o.id === id);
    if (!order || !canTransition(order.status, status))
      return 'Orders must move from Processing to In transit, then Delivered.';
    setOrders((rows) => rows.map((o) => (o.id === id ? { ...o, status } : o)));
    setToast(`Order ${id}: ${status}.`);
    return '';
  }
  function submitReview(productId, rating, comment) {
    if (
      !user ||
      !orders.some(
        (o) =>
          o.status === 'Delivered' && o.items.some((i) => i.id === productId),
      )
    )
      return 'Only delivered purchases can be reviewed.';
    if (
      !products.some((p) => p.id === productId && !p.archived) ||
      !Number.isInteger(rating) ||
      rating < 1 ||
      rating > 5 ||
      !comment.trim() ||
      comment.trim().length > 500
    )
      return 'Enter a rating and a comment of 1–500 characters.';
    setReviews((rows) => [
      ...rows,
      {
        id: crypto.randomUUID(),
        productId,
        customerId: 'CU-001',
        author: user.name,
        rating,
        comment: comment.trim(),
        status: 'Pending',
      },
    ]);
    setToast('Your rating and comment are awaiting Product Manager approval.');
    return '';
  }
  function moderateReview(id, status) {
    if (!['Approved', 'Rejected'].includes(status)) return;
    setReviews((rows) =>
      rows.map((r) =>
        r.id === id && r.status === 'Pending' ? { ...r, status } : r,
      ),
    );
    setToast(`Review ${status.toLowerCase()}.`);
  }

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
    if (
      !product ||
      product.archived ||
      product.price === null ||
      !Number.isInteger(qty) ||
      qty < 1 ||
      existing + qty > product.stock
    ) {
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
    if (
      !product ||
      product.archived ||
      !Number.isInteger(qty) ||
      qty > product.stock
    ) {
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
        (item) =>
          !products.some(
            (p) =>
              p.id === item.id &&
              !p.archived &&
              p.price !== null &&
              item.qty <= p.stock,
          ),
      )
    ) {
      setToast('Stock changed. Please review your cart.');
      return null;
    }
    const order = {
      id: `TK-${1025 + orders.length - initialOrders.length}`,
      date: previewDate.toISOString().slice(0, 10),
      status: 'Processing',
      customerId: 'CU-001',
      deliveryId: `DL-TK-${1025 + orders.length - initialOrders.length}`,
      items: cart.map((item) => ({
        ...item,
        name: products.find((p) => p.id === item.id).name,
        image: products.find((p) => p.id === item.id).image,
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
        products: products.filter((p) => !p.archived),
        allProducts: products,
        categories,
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
        user,
        setUser,
        address,
        setAddress,
        orders,
        reviews,
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
