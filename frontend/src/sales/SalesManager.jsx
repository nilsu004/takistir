import { useEffect, useState } from 'react';
import { Button, EmptyState, Field, Notice } from '../components.jsx';
import { useStore } from '../Store.jsx';
import { api } from '../api.js';
import { money, displayDate } from '../data.js';
import '../manager/manager.css';
import './sales.css';

const today = () => new Date().toISOString().slice(0, 10);
const monthAgo = () =>
  new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
const discounted = (p, percent) =>
  Math.round((Math.round(p * 100) * (100 - percent)) / 100) / 100;
const tabs = ['Pricing & discounts', 'Invoices', 'Revenue & profit', 'Returns'];
export default function SalesManager() {
  const { user } = useStore();
  if (user?.role !== 'sales-manager')
    return (
      <main className="container page">
        <EmptyState
          title={
            user
              ? 'Sales Manager access required'
              : 'Sign in to access Sales Manager'
          }
          href={user ? '#/account' : '#/login?next=%2Fsales-manager'}
          action={user ? 'My account' : 'Sign in'}
        >
          Pricing, financial reports and refunds are available to Sales
          Managers.
        </EmptyState>
      </main>
    );
  return <Workspace key={user.id} />;
}
function Workspace() {
  const { revision, salesAction, busy, connectionError } = useStore();
  const [tab, setTab] = useState(tabs[0]);
  const [range, setRange] = useState({ from: monthAgo(), to: today() });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    api(`/sales/workspace?${new URLSearchParams(range)}`, {
      signal: controller.signal,
    })
      .then((result) => {
        setData(result);
        setError('');
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision, range, reload]);
  async function act(path, body, message, method = 'POST') {
    setError('');
    const result = await salesAction(path, method, body, message);
    if (result.error) setError(result.error);
    else setReload((v) => v + 1);
    return !result.error;
  }
  return (
    <main className="container page manager-page sales-page">
      <div className="manager-heading">
        <div>
          <p className="eyebrow">Takıştır / Commercial workspace</p>
          <h1>Sales Manager</h1>
          <p className="muted">
            Price the collection. Understand every sale. Resolve returns.
          </p>
        </div>
        <a className="button button-secondary" href="#/catalog">
          View storefront ↗
        </a>
      </div>
      <nav className="manager-tabs" aria-label="Sales Manager sections">
        {tabs.map((t) => (
          <button
            key={t}
            aria-current={tab === t ? 'page' : undefined}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </nav>
      {error && (
        <Notice error>
          <p>{error}</p>
          <Button secondary onClick={() => setReload((v) => v + 1)}>
            Retry workspace
          </Button>
        </Notice>
      )}
      <fieldset
        className="manager-workspace"
        disabled={busy || !!connectionError}
        aria-busy={busy}
      >
        {tab === tabs[0] && <Pricing act={act} />}
        {(tab === tabs[1] || tab === tabs[2]) && (
          <form
            className="sales-range no-print"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setData(null);
              setRange({ from: f.get('from'), to: f.get('to') });
            }}
          >
            <Field
              label="From date"
              name="from"
              type="date"
              defaultValue={range.from}
              required
              min="1900-01-01"
              max="2200-12-31"
            />
            <Field
              label="To date"
              name="to"
              type="date"
              defaultValue={range.to}
              required
              min="1900-01-01"
              max="2200-12-31"
            />
            <Button type="submit">Apply dates</Button>
          </form>
        )}
        {tab !== tabs[0] && loading && (
          <p role="status">Refreshing workspace…</p>
        )}
        {tab !== tabs[0] && !loading && data && !error && (
          <>
            {tab === tabs[1] && <Invoices data={data} />}
            {tab === tabs[2] && <Reports data={data} />}
            {tab === tabs[3] && <Returns rows={data.returns} act={act} />}
          </>
        )}
      </fieldset>
    </main>
  );
}
function Pricing({ act }) {
  const { products } = useStore();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState([]);
  const [percent, setPercent] = useState('10');
  const [operation, setOperation] = useState(null);
  const shown = products.filter((p) =>
    `${p.name} ${p.id}`.toLowerCase().includes(search.toLowerCase()),
  );
  const chosen = products.filter((p) => selected.includes(p.id));
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>Pricing & discounts</h2>
          <p className="muted">
            A blank cost uses 50% of the paid sale price at checkout. A cost of
            0 stays zero.
          </p>
        </div>
      </div>
      <Field
        label="Find a product"
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="sales-products">
        {shown.map((p) => (
          <article className="panel" key={p.id}>
            <div className="section-heading">
              <div>
                <p className="eyebrow">
                  {p.id} · {p.category}
                </p>
                <h3>{p.name}</h3>
              </div>
              <label className="sales-select">
                <input
                  type="checkbox"
                  aria-label={`Select ${p.name} for discount`}
                  disabled={p.listPrice === null}
                  checked={selected.includes(p.id)}
                  onChange={(e) => {
                    setOperation(null);
                    setSelected((ids) =>
                      e.target.checked
                        ? [...ids, p.id]
                        : ids.filter((id) => id !== p.id),
                    );
                  }}
                />
                Select for discount
              </label>
            </div>
            <p className="sales-current">
              {p.originalPrice !== null && (
                <>
                  <del>{money(p.originalPrice)}</del>{' '}
                </>
              )}
              <strong>{money(p.price)}</strong>
              {p.discount > 0 && (
                <span className="badge">{p.discount}% off</span>
              )}
            </p>
            <form
              key={`${p.id}:${p.listPrice}:${p.cost}`}
              className="sales-price-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                await act(
                  `/sales/products/${p.id}/pricing`,
                  {
                    price: Number(f.get('price')),
                    cost: f.get('cost') === '' ? null : Number(f.get('cost')),
                  },
                  'Pricing saved.',
                  'PATCH',
                );
              }}
            >
              <Field
                label={`Sale price before discount · ${p.id}`}
                name="price"
                type="number"
                min="0"
                max="999999999"
                step="0.01"
                required
                defaultValue={p.listPrice ?? ''}
              />
              <Field
                label={`Unit cost · ${p.id}`}
                name="cost"
                type="number"
                min="0"
                max="999999999"
                step="0.01"
                defaultValue={p.cost ?? ''}
                placeholder="50% of paid price"
              />
              <Button type="submit" secondary>
                Save pricing
              </Button>
            </form>
          </article>
        ))}
      </div>
      {!shown.length && <p role="status">No matching products.</p>}
      <section className="panel sales-discount">
        <h2>Apply a discount</h2>
        <p>
          {chosen.length} products selected. Discounts replace the existing
          percentage; they never stack. Set 0% to remove a discount.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const payload = {
              ids: chosen.map((p) => p.id).sort(),
              percent: Number(percent),
            };
            const signature = JSON.stringify(payload);
            const key =
              operation?.signature === signature
                ? operation.key
                : crypto.randomUUID();
            setOperation({ signature, key });
            if (
              await act(
                '/sales/discounts',
                { ...payload, key },
                'Discount applied. Demo notifications created for matching wishlists when the price decreased.',
              )
            ) {
              setOperation(null);
              setSelected([]);
            }
          }}
        >
          <Field
            label="Discount percentage"
            type="number"
            min="0"
            max="100"
            step="1"
            required
            value={percent}
            onChange={(e) => {
              setOperation(null);
              setPercent(e.target.value);
            }}
          />
          {chosen.length > 0 && (
            <ul className="sales-preview">
              {chosen.map((p) => (
                <li key={p.id}>
                  <span>{p.name}</span>
                  <span>
                    <del>{money(p.listPrice)}</del> →{' '}
                    {money(discounted(p.listPrice, Number(percent)))}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Button
            type="submit"
            disabled={!chosen.length || chosen.length > 100}
          >
            Apply to selected products
          </Button>
        </form>
        <p className="muted small">
          Signed-in customers who saved a selected product receive an in-app
          demo notification when its discounted price decreases. No email is
          sent.
        </p>
      </section>
    </>
  );
}
function Invoices({ data }) {
  return (
    <section>
      <h2>Invoices</h2>
      <p className="muted">
        {displayDate(data.from)} – {displayDate(data.to)} ·{' '}
        {data.invoices.length} invoices. Original paid prices are retained.
        Cancelled orders are labelled and excluded from revenue.
      </p>
      {!data.invoices.length ? (
        <p>No invoices in this date range.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Invoice / date</th>
                <th>Customer</th>
                <th>Status</th>
                <th>Paid total</th>
                <th>Document</th>
              </tr>
            </thead>
            <tbody>
              {data.invoices.map((o) => (
                <tr key={o.id}>
                  <td>
                    {o.id}
                    <br />
                    {displayDate(o.date)}
                  </td>
                  <td>{o.customer}</td>
                  <td>{o.status}</td>
                  <td>{money(o.total)}</td>
                  <td>
                    <a className="text-button" href={`#/invoice/${o.id}`}>
                      View / Print / PDF
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Notice>
        Open an invoice, then choose Print / Save PDF. In the browser print
        dialog choose Save as PDF to keep a copy. These are demo documents.
      </Notice>
    </section>
  );
}
function Reports({ data }) {
  const t = data.totals;
  return (
    <section>
      <h2>Revenue & profit</h2>
      <p className="muted">
        {displayDate(data.from)} – {displayDate(data.to)} · TRY · inclusive
        dates, UTC
      </p>
      <div className="sales-metrics">
        {[
          [t.gross, 'Gross sales'],
          [t.refunds, 'Approved refunds'],
          [t.net, 'Net revenue'],
          [t.cost, 'Sale-time costs'],
          [t.returnedCost, 'Returned cost reversal'],
          [t.netCost, 'Net cost'],
          [t.profit, 'Profit / loss'],
        ].map(([value, label]) => (
          <div className="panel" key={label}>
            <span>{label}</span>
            <strong className={value < 0 ? 'sales-negative' : ''}>
              {money(value)}
            </strong>
          </div>
        ))}
      </div>
      <Notice>
        Sales are recorded on the order date; cancelled orders are excluded.
        Refunds and their cost reversals are recorded on the approval date, even
        if the purchase was outside this range. Profit = gross sales − refunds −
        sale-time costs + returned cost. Pending/rejected returns have no
        financial effect. All amounts use the paid price and stored cost from
        checkout; returned stock is assumed resalable. Historical orders without
        a recorded cost use 50% of their paid unit price.
      </Notice>
      <RevenueChart series={data.series} />
      <details>
        <summary>Daily report data</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Sales</th>
                <th>Refunds</th>
                <th>Net revenue</th>
                <th>Costs</th>
                <th>Cost reversal</th>
                <th>Profit / loss</th>
              </tr>
            </thead>
            <tbody>
              {data.series.map((d) => (
                <tr key={d.date}>
                  <td>{d.date}</td>
                  <td>{money(d.gross)}</td>
                  <td>{money(d.refunds)}</td>
                  <td>{money(d.net)}</td>
                  <td>{money(d.cost)}</td>
                  <td>{money(d.returnedCost)}</td>
                  <td>{money(d.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
function RevenueChart({ series }) {
  if (!series.length)
    return (
      <div className="panel sales-chart-empty">
        No sales or approved refunds in this date range.
      </div>
    );
  const max = Math.max(1, ...series.flatMap((d) => [d.net, d.profit]));
  const min = Math.min(0, ...series.flatMap((d) => [d.net, d.profit]));
  const y = (v) => 30 + ((max - v) / (max - min)) * 220;
  const width = Math.max(680, series.length * 70 + 100);
  const step = (width - 120) / series.length;
  return (
    <figure className="sales-chart">
      <figcaption>Daily net revenue and profit / loss</figcaption>
      <p className="sales-legend">
        <span>■ Net revenue</span>
        <span>▨ Profit / loss</span>
      </p>
      <div className="sales-chart-scroll">
        <svg
          viewBox={`0 0 ${width} 300`}
          role="img"
          aria-label="Daily revenue and profit chart. Exact values are available in Daily report data."
        >
          <line
            x1="70"
            x2={width - 20}
            y1={y(0)}
            y2={y(0)}
            stroke="currentColor"
          />
          <text x="2" y="25">
            {money(max)}
          </text>
          <text x="2" y="273">
            {money(min)}
          </text>
          {series.map((d, i) => (
            <g key={d.date}>
              {[d.net, d.profit].map((v, j) => (
                <rect
                  key={j}
                  x={80 + i * step + j * 17}
                  y={Math.min(y(v), y(0))}
                  width="14"
                  height={Math.max(1, Math.abs(y(v) - y(0)))}
                  fill={j ? '#a57859' : '#4b1026'}
                >
                  <title>
                    {d.date}: {j ? 'Profit / loss' : 'Net revenue'} {money(v)}
                  </title>
                </rect>
              ))}
              <text x={80 + i * step} y="294" fontSize="11">
                {d.date.slice(5)}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </figure>
  );
}
function Returns({ rows, act }) {
  const [filter, setFilter] = useState('Open');
  const shown = rows.filter(
    (r) =>
      filter === 'All' ||
      (filter === 'Open'
        ? ['Awaiting item', 'Received'].includes(r.status)
        : r.status === filter),
  );
  return (
    <section>
      <h2>Returns & refunds</h2>
      <p className="muted">
        Confirm the returned items physically arrived before approving. Refunds
        use the customer's original paid price.
      </p>
      <label className="field">
        Return status
        <select
          aria-label="Return status"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          {[
            'Open',
            'Awaiting item',
            'Received',
            'Approved',
            'Rejected',
            'All',
          ].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <div className="sales-return-list">
        {shown.map((r) => (
          <ReturnCard key={r.id} row={r} act={act} />
        ))}
      </div>
      {!shown.length && <p>No returns match this status.</p>}
    </section>
  );
}
function ReturnCard({ row: r, act }) {
  const [received, setReceived] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [reject, setReject] = useState(false);
  return (
    <article className="panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{r.id}</p>
          <h3>
            {r.orderId} · {r.customer}
          </h3>
        </div>
        <span className="badge">{r.status}</span>
      </div>
      <ul className="sales-preview">
        {r.items.map((i) => (
          <li key={i.id}>
            <span>
              {i.name} × {i.qty}
            </span>
            <span>
              {money(i.price)} each · {money(i.price * i.qty)}
            </span>
          </li>
        ))}
      </ul>
      <p>
        <strong>Original paid refund: {money(r.amount)}</strong>
      </p>
      {r.reason && <Notice>Rejection reason: {r.reason}</Notice>}
      {r.status === 'Awaiting item' && (
        <div className="sales-receipt">
          <label>
            <input
              type="checkbox"
              checked={received}
              onChange={(e) => setReceived(e.target.checked)}
            />
            I confirm these items physically arrived at the store.
          </label>
          <Button
            secondary
            disabled={!received}
            onClick={() =>
              act(
                `/sales/returns/${r.id}/receive`,
                { confirmed: true },
                'Store receipt confirmed.',
              )
            }
          >
            Confirm store receipt
          </Button>
        </div>
      )}
      {r.status === 'Received' && (
        <>
          <p className="stock">
            Store receipt confirmed. Ready for refund review.
          </p>
          <Button onClick={() => setConfirm(true)}>Approve demo refund</Button>
          {confirm && (
            <section className="sales-confirm" aria-label="Confirm refund">
              <p>
                Refund {money(r.amount)}, restock the listed quantities and
                notify {r.customer}?
              </p>
              <div className="button-row">
                <Button
                  onClick={async () => {
                    if (
                      await act(
                        `/sales/returns/${r.id}/approve`,
                        {},
                        'Refund approved, stock restored and customer notified.',
                      )
                    )
                      setConfirm(false);
                  }}
                >
                  Confirm refund
                </Button>
                <Button secondary onClick={() => setConfirm(false)}>
                  Keep reviewing
                </Button>
              </div>
            </section>
          )}
        </>
      )}
      {['Awaiting item', 'Received'].includes(r.status) && (
        <>
          <button
            className="text-button sales-reject"
            onClick={() => setReject(!reject)}
          >
            Reject return
          </button>
          {reject && (
            <form
              className="form-stack"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                await act(
                  `/sales/returns/${r.id}/reject`,
                  { reason: f.get('reason') },
                  'Return rejected. Customer notified.',
                );
              }}
            >
              <Field
                label="Reason for rejection"
                name="reason"
                required
                maxLength={500}
              />
              <Button secondary type="submit">
                Confirm rejection
              </Button>
            </form>
          )}
        </>
      )}
      {r.status === 'Approved' && (
        <Notice>
          Demo refund recorded. Returned quantities were restocked and the
          customer was notified. Repeated processing will not repeat these
          actions.
        </Notice>
      )}
    </article>
  );
}
export function Notifications() {
  const { user, notifications, markNotificationRead } = useStore();
  return (
    <main className="container page narrow-page">
      <h1>Notifications</h1>
      {user?.role !== 'customer' ? (
        <EmptyState
          title="Sign in as a customer"
          href="#/login"
          action="Sign in"
        />
      ) : notifications.length ? (
        <div className="sales-return-list">
          {notifications.map((n) => (
            <article className="panel" key={n.id}>
              <p className="eyebrow">
                Demo notification · {new Date(n.createdAt).toLocaleString()}
              </p>
              <p>{n.message}</p>
              {!n.readAt ? (
                <Button secondary onClick={() => markNotificationRead(n.id)}>
                  Mark as read
                </Button>
              ) : (
                <span className="muted">Read</span>
              )}
            </article>
          ))}
        </div>
      ) : (
        <p>
          No notifications yet. Save products to your wishlist to hear about
          discounts.
        </p>
      )}
    </main>
  );
}
