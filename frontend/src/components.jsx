import { useEffect, useRef, useState } from 'react';
import { money, navigate } from './data.js';
import { useStore } from './Store.jsx';

export function Button({
  children,
  secondary = false,
  className = '',
  ...props
}) {
  return (
    <button
      className={`button ${secondary ? 'button-secondary' : ''} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Header() {
  const { cart, user, categories } = useStore();
  const [search, setSearch] = useState('');
  const count = cart.reduce((sum, item) => sum + item.qty, 0);
  return (
    <header className="site-header">
      <div className="brand-strip" aria-hidden="true" />
      <div className="header-main container">
        <a className="brand" href="#/" aria-label="Takıştır home">
          Takıştır
        </a>
        <form
          className="search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            navigate(`/catalog?q=${encodeURIComponent(search)}`);
          }}
        >
          <input
            aria-label="Search products"
            placeholder="Search products"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button aria-label="Submit search" title="Search">
            ⌕
          </button>
        </form>
        <nav className="account-nav" aria-label="Account navigation">
          <a href={user ? '#/account' : '#/login'}>
            {user ? 'My account' : 'My account'}
          </a>
          <a href="#/wishlist">♡ Wishlist</a>
          <a href="#/cart">Cart ({count})</a>
        </nav>
      </div>
      <nav className="category-nav container" aria-label="Product categories">
        {['New arrivals', ...categories, 'All accessories'].map((name) => (
          <a
            key={name}
            href={`#/catalog${['New arrivals', 'All accessories'].includes(name) ? '' : `?category=${name}`}`}
          >
            {name}
          </a>
        ))}
      </nav>
    </header>
  );
}

export function Footer() {
  const { setChatOpen } = useStore();
  return (
    <footer className="site-footer">
      <div className="container footer-main">
        <a className="brand" href="#/">
          Takıştır
        </a>
        <nav aria-label="Footer navigation">
          <a href="#/info/contact">Contact</a>
          <span>·</span>
          <a href="#/info/returns">Delivery and returns</a>
          <span>·</span>
          <a href="#/info/privacy">Privacy</a>
          <span>·</span>
          <a href="#/product-manager">Product Manager demo</a>
        </nav>
        <button onClick={() => setChatOpen(true)}>Live chat ↗</button>
      </div>
    </footer>
  );
}

export function ProductArt({ product, detail = false }) {
  return (
    <div className={`product-art ${detail ? 'product-art-detail' : ''}`}>
      <img
        src={`/assets/${detail && product.detailImage ? product.detailImage : product.image}`}
        alt={product.name}
      />
    </div>
  );
}

export function ProductCard({ product }) {
  const { wishlist, toggleWishlist } = useStore();
  const saved = wishlist.includes(product.id);
  return (
    <article className="product-card">
      <a className="product-picture-link" href={`#/product/${product.id}`}>
        <ProductArt product={product} />
      </a>
      <p className="eyebrow">
        {product.stock ? 'New arrivals' : 'Out of stock'}
      </p>
      <h3>
        <a href={`#/product/${product.id}`}>{product.name}</a>
      </h3>
      <div className="card-price">
        {money(product.price)}{' '}
        <button
          className="heart"
          aria-label={`${saved ? 'Remove' : 'Save'} ${product.name} ${saved ? 'from' : 'to'} wishlist`}
          aria-pressed={saved}
          onClick={() => toggleWishlist(product.id)}
        >
          {saved ? '♥' : '♡'}
        </button>
      </div>
      <a className="button button-secondary" href={`#/product/${product.id}`}>
        View product
      </a>
    </article>
  );
}

export function ProductGrid({ products }) {
  return (
    <div className="product-grid">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  );
}

export function Quantity({ value, onChange, max, label = 'Quantity' }) {
  return (
    <div className="quantity" role="group" aria-label={label}>
      <button
        aria-label={`Decrease ${label.toLowerCase()}`}
        disabled={value <= 1}
        onClick={() => onChange(value - 1)}
      >
        −
      </button>
      <output aria-label={label}>{value}</output>
      <button
        aria-label={`Increase ${label.toLowerCase()}`}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action = 'Browse products',
  href = '#/catalog',
  onAction,
}) {
  return (
    <div className="empty-state">
      <span className="empty-symbol" aria-hidden="true">
        ◇
      </span>
      <h1>{title}</h1>
      <p>{children}</p>
      <a className="button" href={href} onClick={onAction}>
        {action}
      </a>
    </div>
  );
}

export function Notice({ children, error = false }) {
  return (
    <div
      className={`notice ${error ? 'notice-error' : ''}`}
      role={error ? 'alert' : undefined}
    >
      {children}
    </div>
  );
}

export function Summary({ children }) {
  const { cartItems, total } = useStore();
  return (
    <aside className="panel order-summary">
      <h2>Order summary</h2>
      {cartItems.map((item) => (
        <div className="summary-line" key={item.id}>
          <span>
            {item.name} × {item.qty}
          </span>
          <span>{money(item.price * item.qty)}</span>
        </div>
      ))}
      <hr />
      <div className="summary-line">
        <span>Subtotal</span>
        <span>{money(total)}</span>
      </div>
      <div className="summary-line">
        <span>Delivery</span>
        <span>Free</span>
      </div>
      <div className="summary-line summary-total">
        <strong>Total</strong>
        <strong>{money(total)}</strong>
      </div>
      {children}
    </aside>
  );
}

export function Field({ label, name, ...props }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input name={name} {...props} />
    </label>
  );
}

export function Chat() {
  const { chatOpen, setChatOpen, user } = useStore();
  const ref = useRef(null);
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState([
    { from: 'agent', text: 'Hello! How can we help you?' },
  ]);
  useEffect(() => {
    if (chatOpen && !ref.current.open) ref.current.showModal();
  }, [chatOpen]);
  function close() {
    ref.current.close();
    setChatOpen(false);
  }
  function send(event) {
    event.preventDefault();
    if (!draft.trim()) return;
    setMessages((rows) => [
      ...rows,
      { from: 'customer', text: draft.trim() },
      {
        from: 'agent',
        text: 'Thanks for your message. This is a demo conversation; a real support agent is not connected.',
      },
    ]);
    setDraft('');
  }
  return (
    <dialog
      ref={ref}
      className="chat-dialog"
      aria-labelledby="chat-title"
      onCancel={() => setChatOpen(false)}
      onClose={() => setChatOpen(false)}
    >
      <div className="chat-heading">
        <div>
          <h2 id="chat-title">Live chat</h2>
          <p>{user ? user.name : 'Guest'} · Demo conversation</p>
        </div>
        <button
          className="icon-button"
          aria-label="Close live chat"
          onClick={close}
        >
          ×
        </button>
      </div>
      <div className="chat-messages" aria-live="polite">
        {messages.map((message, index) => (
          <p className={`message ${message.from}`} key={index}>
            {message.text}
          </p>
        ))}
      </div>
      <form className="chat-form" onSubmit={send}>
        <label className="sr-only" htmlFor="chat-message">
          Message
        </label>
        <textarea
          id="chat-message"
          placeholder="Write a message…"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          required
        />
        <div className="chat-actions">
          <label className="text-button attachment-label">
            Attach file
            <input
              type="file"
              accept="image/*,video/*,application/pdf"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file)
                  setMessages((rows) => [
                    ...rows,
                    {
                      from: 'customer',
                      text: `Attachment preview: ${file.name} (not uploaded)`,
                    },
                  ]);
                event.target.value = '';
              }}
            />
          </label>
          <Button type="submit">Send</Button>
        </div>
      </form>
    </dialog>
  );
}

export function Overlays() {
  const { toast, chatOpen, setChatOpen } = useStore();
  return (
    <>
      {!chatOpen && (
        <button
          className="chat-launcher"
          onClick={() => setChatOpen(true)}
          aria-label="Open live chat"
        >
          Live chat ↗
        </button>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      <Chat />
    </>
  );
}
