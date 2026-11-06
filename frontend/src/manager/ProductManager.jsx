import { useState } from 'react';
import { Button, EmptyState, Field, Notice } from '../components.jsx';
import { useStore } from '../Store.jsx';
import { displayDate, money } from '../data.js';
import { orderStatuses, productImages } from './model.js';
import './manager.css';

const tabs = [
  'Products',
  'Categories',
  'Orders & deliveries',
  'Review moderation',
];
const blankProduct = {
  id: '',
  name: '',
  category: '',
  model: '',
  serial: '',
  description: '',
  stock: 0,
  warranty: '',
  distributor: '',
  material: '',
  image: 'necklace-card.svg',
};

export default function ProductManager() {
  const { products, orders, reviews, user, busy } = useStore();
  const [tab, setTab] = useState(tabs[0]);
  if (!user)
    return (
      <main className="container page">
        <EmptyState
          title="Sign in to access your workspace"
          href="#/login?next=%2Fproduct-manager"
          action="Sign in"
        />
      </main>
    );
  if (user.role !== 'product-manager')
    return (
      <main className="container page">
        <EmptyState
          title="Product Manager access required"
          href="#/account"
          action="Back to my account"
        >
          Your account does not have access to this workspace.
        </EmptyState>
      </main>
    );
  return (
    <main className="container page manager-page">
      <div className="manager-heading">
        <div>
          <p className="eyebrow">Takıştır / Workspace</p>
          <h1>Product Manager</h1>
          <p className="muted">
            Care for the collection, from first detail to final delivery.
          </p>
        </div>
        <a className="button button-secondary" href="#/catalog">
          View storefront ↗
        </a>
      </div>
      <Notice>
        Local integration · Changes are saved by the API and shared with
        customer screens. Other sessions refresh automatically within a few
        seconds.
      </Notice>
      <div className="manager-metrics" aria-label="Workspace summary">
        {[
          [products.length, 'Active products'],
          [products.filter((p) => p.stock === 0).length, 'Out of stock'],
          [
            orders.filter((o) =>
              ['Processing', 'In transit'].includes(o.status),
            ).length,
            'Open deliveries',
          ],
          [
            reviews.filter((r) => r.status === 'Pending').length,
            'Reviews to approve',
          ],
        ].map(([value, label]) => (
          <div key={label}>
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <nav className="manager-tabs" aria-label="Product Manager sections">
        {tabs.map((name) => (
          <button
            key={name}
            aria-current={tab === name ? 'page' : undefined}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </nav>
      <fieldset disabled={busy} className="manager-workspace" key={tab}>
        {tab === tabs[0] && <Products />}
        {tab === tabs[1] && <Categories />}
        {tab === tabs[2] && <Deliveries />}
        {tab === tabs[3] && <Reviews />}
      </fieldset>
    </main>
  );
}

function Products() {
  const { products, removeProduct } = useStore();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const shown = products.filter((p) =>
    `${p.id} ${p.name} ${p.category}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>The collection</h2>
          <p className="muted">
            Product details and inventory. Pricing is managed by Sales Manager.
          </p>
        </div>
        <Button onClick={() => setEditing('new')}>+ Add product</Button>
      </div>
      {editing !== null && (
        <ProductForm
          key={typeof editing === 'string' ? editing : editing.id}
          product={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      <Field
        label="Find a product"
        type="search"
        placeholder="Search by name, ID or category"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {removing && (
        <section
          className="panel manager-confirm"
          aria-label="Confirm product removal"
        >
          <h3>Remove {removing.name}?</h3>
          <p>
            The product will leave the storefront, carts and wishlists. Existing
            orders and invoices will remain available.
          </p>
          <div className="manager-actions">
            <Button
              onClick={async () => {
                if (await removeProduct(removing.id)) return;
                setRemoving(null);
                if (editing?.id === removing.id) setEditing(null);
              }}
            >
              Remove product
            </Button>
            <Button secondary onClick={() => setRemoving(null)}>
              Keep product
            </Button>
          </div>
        </section>
      )}
      {shown.length ? (
        <div className="table-scroll">
          <table>
            <caption className="sr-only">Product inventory</caption>
            <thead>
              <tr>
                <th>Product</th>
                <th>Category</th>
                <th>Stock</th>
                <th>Sale price · read only</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="manager-product">
                      <img src={`/assets/${p.image}`} alt="" />
                      <div>
                        <strong>{p.name}</strong>
                        <small>
                          {p.id} · {p.model}
                        </small>
                      </div>
                    </div>
                  </td>
                  <td>{p.category}</td>
                  <td>
                    <Stock product={p} />
                  </td>
                  <td>{money(p.price)}</td>
                  <td>
                    <div className="manager-actions">
                      <Button
                        secondary
                        onClick={() => {
                          setEditing(p);
                          setRemoving(null);
                        }}
                      >
                        Edit
                      </Button>
                      <button
                        className="text-button"
                        onClick={() => setRemoving(p)}
                      >
                        Remove<span className="sr-only"> {p.name}</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title="No products found">
          Add a product or try a different search.
        </EmptyState>
      )}
    </>
  );
}

function ProductForm({ product, onClose }) {
  const { categories, saveProduct } = useStore();
  const [error, setError] = useState('');
  const draft = product || { ...blankProduct, category: categories[0] || '' };
  return (
    <section className="panel manager-editor">
      <h2>{product ? 'Edit product' : 'A new addition'}</h2>
      <p className="muted">
        All marked fields are required. New products await Sales Manager pricing
        before purchase.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const values = Object.fromEntries(new FormData(e.currentTarget));
          const result = await saveProduct(
            { ...values, stock: Number(values.stock) },
            product?.id,
          );
          setError(result);
          if (!result) onClose();
        }}
      >
        <div className="manager-form-grid">
          {[
            ['id', 'Product ID', 40],
            ['name', 'Product name'],
            ['model', 'Model'],
            ['serial', 'Serial number'],
            ['material', 'Material'],
            ['warranty', 'Warranty status / duration'],
            ['distributor', 'Distributor information'],
          ].map(([name, label, max = 160]) => (
            <Field
              key={name}
              name={name}
              label={`${label} *`}
              defaultValue={draft[name]}
              required
              maxLength={max}
              readOnly={name === 'id' && !!product}
              pattern={name === 'id' ? '[A-Za-z0-9-]+' : undefined}
            />
          ))}
          <label className="field">
            Category *
            <select name="category" defaultValue={draft.category} required>
              <option value="" disabled>
                Select category
              </option>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <Field
            label="Stock quantity *"
            name="stock"
            type="number"
            defaultValue={draft.stock}
            min="0"
            max="1000000"
            step="1"
            required
          />
          <label className="field">
            Preview illustration *
            <select name="image" defaultValue={draft.image}>
              {productImages.map((image) => (
                <option key={image} value={image}>
                  {image.replace('-card.svg', '')}
                </option>
              ))}
            </select>
          </label>
          <label className="field manager-wide">
            Description *
            <textarea
              name="description"
              defaultValue={draft.description}
              required
              maxLength={2000}
              rows={3}
            />
          </label>
        </div>
        {error && (
          <p className="manager-error" role="alert">
            {error}
          </p>
        )}
        {!categories.length && (
          <p role="alert">Add a category before creating a product.</p>
        )}
        <div className="manager-actions">
          <Button type="submit" disabled={!categories.length}>
            Save product
          </Button>
          <Button secondary type="button" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </section>
  );
}

function Stock({ product }) {
  const { updateStock } = useStore();
  const [error, setError] = useState('');
  return (
    <form
      className="manager-stock"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(
          await updateStock(
            product.id,
            Number(new FormData(e.currentTarget).get('stock')),
          ),
        );
      }}
    >
      <input
        key={product.stock}
        aria-label={`Stock for ${product.name}`}
        name="stock"
        type="number"
        min="0"
        max="1000000"
        step="1"
        required
        defaultValue={product.stock}
      />
      <button className="text-button" type="submit">
        Update
      </button>
      {error && (
        <small role="alert" className="manager-error">
          {error}
        </small>
      )}
    </form>
  );
}

function Categories() {
  const { categories, products, addCategory, removeCategory } = useStore();
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState(null);
  return (
    <>
      <h2>Categories</h2>
      <p className="muted">
        Categories appear in storefront navigation and catalog filters. Only
        empty categories can be removed.
      </p>
      <form
        className="panel manager-category-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const result = await addCategory(new FormData(form).get('name'));
          setError(result);
          if (!result) form.reset();
        }}
      >
        <Field
          label="New category"
          name="name"
          required
          maxLength={60}
          placeholder="e.g. Watches"
        />
        <Button type="submit">Add category</Button>
      </form>
      {error && (
        <p className="manager-error" role="alert">
          {error}
        </p>
      )}
      {removing && (
        <div className="panel">
          <p>Remove the category “{removing}”?</p>
          <div className="manager-actions">
            <Button
              onClick={async () => {
                const error = await removeCategory(removing);
                setError(error);
                if (!error) setRemoving(null);
              }}
            >
              Remove category
            </Button>
            <Button secondary onClick={() => setRemoving(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      <div className="manager-category-grid">
        {categories.map((c) => {
          const count = products.filter((p) => p.category === c).length;
          return (
            <article className="panel" key={c}>
              <h3>{c}</h3>
              <p className="muted">{count} products</p>
              <Button
                secondary
                disabled={count > 0}
                onClick={() => setRemoving(c)}
              >
                Remove category
              </Button>
              {count > 0 && <small>Move or remove its products first.</small>}
            </article>
          );
        })}
      </div>
      {!categories.length && (
        <EmptyState title="No categories yet">
          Add your first category above.
        </EmptyState>
      )}
    </>
  );
}

function Deliveries() {
  const { orders, allProducts, updateOrderStatus } = useStore();
  const [filter, setFilter] = useState('All');
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const order = orders.find((o) => o.id === selected);
  const shown = orders.filter((o) => filter === 'All' || o.status === filter);
  return (
    <>
      <h2>Orders & deliveries</h2>
      <p className="muted">
        Purchase-time prices are retained. Delivery completion follows the order
        status.
      </p>
      <label className="field">
        Filter by status
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          {['All', ...orderStatuses, 'Cancelled'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <div className="table-scroll">
        <table>
          <caption className="sr-only">Order list</caption>
          <thead>
            <tr>
              <th>Order / customer</th>
              <th>Date</th>
              <th>Total paid</th>
              <th>Status</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((o) => (
              <tr key={o.id}>
                <td>
                  <strong>{o.id}</strong>
                  <small>{o.customerId}</small>
                </td>
                <td>{displayDate(o.date)}</td>
                <td>
                  {money(o.items.reduce((sum, i) => sum + i.price * i.qty, 0))}
                </td>
                <td>
                  <span className={`badge ${o.status.toLowerCase()}`}>
                    {o.status}
                  </span>
                </td>
                <td>
                  <Button
                    secondary
                    onClick={() => {
                      setSelected(o.id);
                      setError('');
                    }}
                  >
                    View delivery<span className="sr-only"> {o.id}</span>
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!shown.length && <EmptyState title="No orders in this status" />}
      {order && (
        <section
          className="panel manager-delivery"
          aria-label={`Delivery ${order.deliveryId}`}
        >
          <div className="section-heading">
            <h2>{order.deliveryId}</h2>
            <Button secondary onClick={() => setSelected(null)}>
              Close details
            </Button>
          </div>
          <dl className="manager-facts">
            <div>
              <dt>Order / customer ID</dt>
              <dd>
                {order.id} / {order.customerId}
              </dd>
            </div>
            <div>
              <dt>Delivery address</dt>
              <dd>{order.address}</dd>
            </div>
            <div>
              <dt>Tracking reference</dt>
              <dd>{order.tracking || 'Not assigned in this demo'}</dd>
            </div>
            <div>
              <dt>Completion status</dt>
              <dd>
                {order.status === 'Delivered'
                  ? 'Complete'
                  : order.status === 'Cancelled'
                    ? 'Cancelled · no delivery'
                    : 'Incomplete'}{' '}
                · {order.status}
              </dd>
            </div>
          </dl>
          <div className="table-scroll">
            <table>
              <caption className="sr-only">Delivery items</caption>
              <thead>
                <tr>
                  <th>Product / ID</th>
                  <th>Quantity</th>
                  <th>Unit price paid</th>
                  <th>Total price</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      {item.name ||
                        allProducts.find((p) => p.id === item.id)?.name}
                      <small>{item.id}</small>
                    </td>
                    <td>{item.qty}</td>
                    <td>{money(item.price)}</td>
                    <td>{money(item.price * item.qty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form
            className="manager-category-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setError(
                await updateOrderStatus(
                  order.id,
                  new FormData(e.currentTarget).get('status'),
                ),
              );
            }}
            key={`${order.id}-${order.status}`}
          >
            <label className="field">
              Next order status
              <select
                name="status"
                disabled={['Delivered', 'Cancelled'].includes(order.status)}
                defaultValue={
                  orderStatuses[orderStatuses.indexOf(order.status) + 1] ||
                  order.status
                }
              >
                {['Delivered', 'Cancelled'].includes(order.status) ? (
                  <option>{order.status}</option>
                ) : (
                  <option>
                    {orderStatuses[orderStatuses.indexOf(order.status) + 1]}
                  </option>
                )}
              </select>
            </label>
            <Button
              type="submit"
              disabled={['Delivered', 'Cancelled'].includes(order.status)}
            >
              Update status
            </Button>
          </form>
          {error && (
            <p role="alert" className="manager-error">
              {error}
            </p>
          )}
          <ManagerInvoice order={order} />
        </section>
      )}
    </>
  );
}

function Reviews() {
  const { reviews, allProducts, moderateReview } = useStore();
  const [filter, setFilter] = useState('Pending');
  const shown = reviews.filter((r) => filter === 'All' || r.status === filter);
  return (
    <>
      <h2>A considered collection</h2>
      <p className="muted">
        Approve or reject each review. Both the comment and its star rating are
        published only after approval.
      </p>
      <label className="field">
        Review status
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          {['Pending', 'Approved', 'Rejected', 'All'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      {shown.length ? (
        <div className="manager-review-list">
          {shown.map((r) => (
            <article key={r.id} className="panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">
                    {allProducts.find((p) => p.id === r.productId)?.name} ·{' '}
                    {r.productId}
                  </p>
                  <h3>{r.author}</h3>
                  <small>{r.customerId} · Verified delivered purchase</small>
                </div>
                <span className="badge">{r.status}</span>
              </div>
              <p
                className="manager-stars"
                aria-label={`${r.rating} out of 5 stars`}
              >
                {'★'.repeat(r.rating)}
                {'☆'.repeat(5 - r.rating)}
              </p>
              <p className="manager-comment">{r.comment}</p>
              {r.status === 'Pending' && (
                <div className="manager-actions">
                  <Button onClick={() => moderateReview(r.id, 'Approved')}>
                    Approve review
                  </Button>
                  <Button
                    secondary
                    onClick={() => moderateReview(r.id, 'Rejected')}
                  >
                    Reject review
                  </Button>
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title={`No ${filter === 'All' ? '' : filter.toLowerCase()} reviews`}
        >
          Customer reviews of delivered purchases will appear here.
        </EmptyState>
      )}
    </>
  );
}

function ManagerInvoice({ order }) {
  return (
    <details className="manager-invoice">
      <summary>View invoice · {order.id}</summary>
      <article>
        <h3>Takıştır · Invoice {order.id}</h3>
        <p>
          {displayDate(order.date)} · Customer {order.customerId}
        </p>
        <p>{order.address}</p>
        <div className="table-scroll">
          <table>
            <caption className="sr-only">Invoice items</caption>
            <thead>
              <tr>
                <th>Product</th>
                <th>Quantity</th>
                <th>Unit price paid</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    {item.name}
                    <small>{item.id}</small>
                  </td>
                  <td>{item.qty}</td>
                  <td>{money(item.price)}</td>
                  <td>{money(item.price * item.qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="summary-line summary-total">
          Total paid{' '}
          <strong>
            {money(
              order.items.reduce(
                (total, item) => total + item.qty * item.price,
                0,
              ),
            )}
          </strong>
        </p>
        <p className="muted">Demo invoice. This is not a tax invoice.</p>
      </article>
    </details>
  );
}
