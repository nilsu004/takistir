import { useState } from 'react';
import {
  Button,
  EmptyState,
  Field,
  Notice,
  ProductArt,
} from './components.jsx';
import { displayDate, money, navigate, returnEligible } from './data.js';
import { useStore } from './Store.jsx';

export function Login({ register = false, next = '/account' }) {
  const { login, busy } = useStore();
  const [error, setError] = useState('');
  const destination =
    next.startsWith('/') && !next.startsWith('//') ? next : '/account';
  async function signIn(email, password, name) {
    const result = await login(email, password, name);
    setError(result.error);
    if (!result.error)
      navigate(
        result.state.user.role === 'product-manager'
          ? '/product-manager'
          : destination === '/product-manager'
            ? '/account'
            : destination,
      );
  }
  return (
    <main className="container page auth-page">
      <div className="panel auth-panel">
        <p className="eyebrow">Takıştır account</p>
        <h1>{register ? 'Create an account' : 'Welcome back'}</h1>
        <p className="muted">
          Sign in to continue to your account or workspace.
        </p>
        {error && <Notice error>{error}</Notice>}
        <form
          className="form-stack"
          onSubmit={async (event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            await signIn(
              data.get('email'),
              data.get('password'),
              register ? data.get('name') : undefined,
            );
          }}
        >
          {register && (
            <Field
              label="Full name"
              name="name"
              autoComplete="name"
              required
              maxLength={160}
            />
          )}
          <Field
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="deniz@example.com"
            required
            maxLength={254}
          />
          <Field
            label="Password"
            name="password"
            type="password"
            autoComplete={register ? 'new-password' : 'current-password'}
            minLength={8}
            maxLength={128}
            required
          />
          <Button type="submit" disabled={busy}>
            {busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'}
          </Button>
        </form>
        <details className="preview-tools">
          <summary>Local test accounts</summary>
          <p>
            Use separate browser profiles or an incognito window to test both
            roles at once.
          </p>
          <div className="form-stack">
            <Button
              secondary
              disabled={busy}
              onClick={() => signIn('deniz@example.com', 'CustomerDemo!24')}
            >
              Use customer demo
            </Button>
            <Button
              secondary
              disabled={busy}
              onClick={() => signIn('manager@takistir.local', 'ManagerDemo!24')}
            >
              Use Product Manager demo
            </Button>
          </div>
        </details>
        <p className="auth-switch">
          {register ? 'Already have an account?' : 'New to Takıştır?'}{' '}
          <a
            href={`#/${register ? 'login' : 'register'}?next=${encodeURIComponent(destination)}`}
          >
            {register ? 'Sign in' : 'Create an account'}
          </a>
        </p>
      </div>
    </main>
  );
}

export function AccountShell({ children, active }) {
  const { user, logout } = useStore();
  if (!user)
    return (
      <main className="container page">
        <EmptyState
          title="Sign in to view your account"
          action="Sign in"
          href={`#/login?next=${encodeURIComponent(active === 'Orders' ? '/orders' : '/account')}`}
        >
          Use the demo account to explore profile and order screens.
        </EmptyState>
      </main>
    );
  return (
    <main className="container page">
      <p className="breadcrumb">
        <a href="#/">Home</a> / My account
      </p>
      <div className="account-layout">
        <aside className="account-sidebar">
          <h2>My account</h2>
          <p className="muted">{user.name}</p>
          <nav aria-label="Account pages">
            {[
              ['Profile', '/account'],
              ['Orders', '/orders'],
              ['Wishlist', '/wishlist'],
              ...(user.role === 'product-manager'
                ? [['Management panel', '/product-manager']]
                : []),
            ].map(([label, url]) => (
              <a
                key={url}
                href={`#${url}`}
                aria-current={active === label ? 'page' : undefined}
              >
                {label}
              </a>
            ))}
            <button
              onClick={async () => {
                if (!(await logout())) navigate('/');
              }}
            >
              Log out
            </button>
          </nav>
        </aside>
        <section className="account-content">{children}</section>
      </div>
    </main>
  );
}

export function Profile() {
  const { user, updateProfile, busy } = useStore();
  return (
    <AccountShell active="Profile">
      <h1>Profile</h1>
      {user && (
        <form
          className="panel form-stack"
          onSubmit={async (event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            await updateProfile({
              name: data.get('name'),
              email: data.get('email'),
              home: data.get('home'),
            });
          }}
        >
          <p className="muted">Account ID: {user.id}</p>
          <Field
            label="Full name"
            name="name"
            defaultValue={user.name}
            autoComplete="name"
            required
          />
          <Field
            label="Email"
            name="email"
            type="email"
            defaultValue={user.email}
            autoComplete="email"
            required
          />
          <Field
            label="Home address"
            name="home"
            defaultValue={user.home}
            autoComplete="street-address"
          />
          <Button type="submit" disabled={busy}>
            Save changes
          </Button>
        </form>
      )}
    </AccountShell>
  );
}

export function Orders() {
  const { orders } = useStore();
  return (
    <AccountShell active="Orders">
      <h1>Order history</h1>
      <p className="muted">
        Example orders are included so you can explore each status.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Order</th>
              <th>Date</th>
              <th>Total</th>
              <th>Status</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id}>
                <td>#{order.id}</td>
                <td>{displayDate(order.date)}</td>
                <td>
                  {money(
                    order.items.reduce(
                      (sum, item) => sum + item.price * item.qty,
                      0,
                    ),
                  )}
                </td>
                <td>
                  <span
                    className={`badge ${order.status.toLowerCase().replaceAll(' ', '-')}`}
                  >
                    {order.status}
                  </span>
                </td>
                <td>
                  <a className="text-button" href={`#/orders/${order.id}`}>
                    View order →
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AccountShell>
  );
}

export function Order({ id }) {
  const {
    orders,
    allProducts: products,
    cancelOrder,
    requestReturn,
  } = useStore();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const order = orders.find((item) => item.id === id);
  if (!order)
    return (
      <AccountShell active="Orders">
        <EmptyState
          title="Order not found"
          action="View orders"
          href="#/orders"
        />
      </AccountShell>
    );
  const eligible = returnEligible(order);
  return (
    <AccountShell active="Orders">
      <a className="text-button" href="#/orders">
        ← Order history
      </a>
      <div className="page-heading">
        <h1>Order #{id}</h1>
        <span className="badge">{order.status}</span>
      </div>
      <p className="muted">Purchased {displayDate(order.date)}</p>
      <div className="order-progress" aria-label="Order progress">
        {['Processing', 'In transit', 'Delivered'].map((status, index) => (
          <div
            className={
              index <=
              ['Processing', 'In transit', 'Delivered'].indexOf(order.status)
                ? 'completed'
                : ''
            }
            key={status}
          >
            <span>{index + 1}</span>
            {status}
          </div>
        ))}
      </div>
      <div className="panel">
        <h2>Items</h2>
        {order.items.map((item) => {
          const product = {
            ...products.find((p) => p.id === item.id),
            ...item,
          };
          return (
            <div className="order-item" key={item.id}>
              <ProductArt product={product} />
              <div>
                <a href={`#/product/${item.id}`}>{product.name}</a>
                <p className="muted">Quantity: {item.qty}</p>
                {order.status === 'Delivered' && (
                  <a className="text-button" href={`#/product/${item.id}`}>
                    Rate and review
                  </a>
                )}
              </div>
              <strong>{money(item.qty * item.price)}</strong>
            </div>
          );
        })}
        <div className="summary-line summary-total">
          <strong>Total paid</strong>
          <strong>
            {money(
              order.items.reduce((sum, item) => sum + item.qty * item.price, 0),
            )}
          </strong>
        </div>
      </div>
      <div className="panel">
        <h2>Delivery</h2>
        <p>{order.address}</p>
        {order.tracking && (
          <p className="muted">Tracking ID: {order.tracking}</p>
        )}
      </div>
      <div className="button-row">
        <a className="button button-secondary" href={`#/invoice/${id}`}>
          View invoice
        </a>
        {order.status === 'Processing' && (
          <Button secondary onClick={() => setCancelOpen(true)}>
            Cancel order
          </Button>
        )}
        {eligible && !order.returnRequest && (
          <Button secondary onClick={() => setReturnOpen(!returnOpen)}>
            Request a return
          </Button>
        )}
      </div>
      {cancelOpen && order.status === 'Processing' && (
        <div className="panel">
          <h2>Cancel this order?</h2>
          <p>The order has not shipped yet.</p>
          <div className="button-row">
            <Button
              onClick={() => {
                cancelOrder(id);
                setCancelOpen(false);
              }}
            >
              Confirm cancellation
            </Button>
            <Button secondary onClick={() => setCancelOpen(false)}>
              Keep order
            </Button>
          </div>
        </div>
      )}
      {returnOpen && eligible && !order.returnRequest && (
        <form
          className="panel form-stack"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            const selected = Object.fromEntries(
              order.items
                .filter((item) => data.has(item.id))
                .map((item) => [item.id, Number(data.get(`${item.id}-qty`))]),
            );
            if (await requestReturn(id, selected)) setReturnOpen(false);
            else form.querySelector('input[type="checkbox"]')?.focus();
          }}
        >
          <h2>Select items to return</h2>
          <p className="muted">
            Delivered items can be returned within 30 days of purchase.
          </p>
          {order.items.map((item) => (
            <div className="return-choice" key={item.id}>
              <label>
                <input type="checkbox" name={item.id} defaultChecked />{' '}
                {item.name ||
                  products.find((p) => p.id === item.id)?.name ||
                  item.id}
              </label>
              <label>
                Quantity{' '}
                <select name={`${item.id}-qty`}>
                  {Array.from({ length: item.qty }, (_, index) => (
                    <option key={index} value={index + 1}>
                      {index + 1}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ))}
          <Button type="submit">Submit return request</Button>
        </form>
      )}
      {order.returnRequest && (
        <div className="panel return-status">
          <p className="eyebrow">Return {order.returnRequest.id}</p>
          <h2>{order.returnRequest.status}</h2>
          <p>
            Send the selected items back to the store. Your request will be
            reviewed after receipt.
          </p>
          <ul>
            {order.returnRequest.items.map((item) => (
              <li key={item.id}>
                {item.name ||
                  products.find((p) => p.id === item.id)?.name ||
                  item.id}{' '}
                × {item.qty}
              </li>
            ))}
          </ul>
          <strong>Refund amount: {money(order.returnRequest.amount)}</strong>
          <p className="muted">
            Original amount paid, including any discount. This preview does not
            issue a refund or send email.
          </p>
        </div>
      )}
    </AccountShell>
  );
}

export function Invoice({ id }) {
  const { orders, allProducts: products, user } = useStore();
  const order = orders.find((row) => row.id === id);
  if (!user) return <AccountShell active="Orders" />;
  if (!order)
    return (
      <main className="container page">
        <EmptyState
          title="Invoice not found"
          href="#/orders"
          action="View orders"
        />
      </main>
    );
  return (
    <main className="container page invoice-page">
      <div className="button-row no-print">
        <a className="text-button" href={`#/orders/${id}`}>
          ← Order details
        </a>
        <Button secondary onClick={() => window.print()}>
          Print / Save PDF
        </Button>
      </div>
      <article className="panel invoice">
        <div className="invoice-heading">
          <span className="brand">Takıştır</span>
          <div>
            <h1>Invoice</h1>
            <p>TK-F-{id.replace('TK-', '')}</p>
          </div>
        </div>
        <p>{displayDate(order.date)}</p>
        <h2>Bill to</h2>
        <p>
          {user.name}
          <br />
          {user.email}
          <br />
          {order.address}
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Quantity</th>
                <th>Unit price</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    {item.name ||
                      products.find((p) => p.id === item.id)?.name ||
                      item.id}
                  </td>
                  <td>{item.qty}</td>
                  <td>{money(item.price)}</td>
                  <td>{money(item.price * item.qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="summary-line summary-total">
          <strong>Total</strong>
          <strong>
            {money(
              order.items.reduce((sum, item) => sum + item.qty * item.price, 0),
            )}
          </strong>
        </div>
        <Notice>
          Sample invoice for the frontend preview. Not a tax invoice.
        </Notice>
      </article>
    </main>
  );
}
