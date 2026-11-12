import { Button, EmptyState, Notice } from './components.jsx';
import { money } from './data.js';
import { useStore } from './Store.jsx';

export { Checkout } from './checkout/Checkout.jsx';

export function Confirmation({ id }) {
  const { orders, checkout, retryCheckoutCleanup } = useStore();
  const order = orders.find((item) => item.id === id);
  if (!order)
    return (
      <main className="container page">
        <EmptyState
          title="Order not found"
          action="View orders"
          href="#/orders"
        />
      </main>
    );
  return (
    <main className="container page confirmation-page">
      <span className="confirmation-check" aria-hidden="true">
        ✓
      </span>
      <p className="eyebrow">Order #{order.id}</p>
      <h1>Order confirmed</h1>
      <p>Your demo order is now processing.</p>
      <Notice>
        This is a local preview. No payment was collected and no invoice email
        was sent.
      </Notice>
      <div className="panel">
        <h2>Confirmed total</h2>
        <strong>
          {money(
            order.items.reduce(
              (sum, item) => sum + Math.round(item.price * 100) * item.qty,
              0,
            ) / 100,
          )}
        </strong>
      </div>
      {checkout.order?.id === id && checkout.priceWarning && (
        <Notice>{checkout.priceWarning}</Notice>
      )}
      {checkout.order?.id === id && checkout.cleanupError && (
        <Notice error>
          <strong>Your order is confirmed, but the cart needs updating</strong>
          <p>{checkout.cleanupError}</p>
          <p>
            Retrying this step only updates the cart; it does not place another
            order.
          </p>
          <Button secondary onClick={retryCheckoutCleanup}>
            {checkout.pending ? 'Updating cart…' : 'Retry cart cleanup'}
          </Button>
        </Notice>
      )}
      <div className="button-row">
        <a className="button" href={`#/orders/${id}`}>
          View order
        </a>
        <a className="button button-secondary" href={`#/invoice/${id}`}>
          View invoice
        </a>
        <a className="text-button" href="#/catalog">
          Continue shopping →
        </a>
      </div>
    </main>
  );
}
