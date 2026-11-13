import { useState } from 'react';
import { Button, EmptyState, Field, Notice, Summary } from './components.jsx';
import { money, navigate } from './data.js';
import { useStore } from './Store.jsx';

export function Checkout({ step }) {
  const { user, cartItems, address, setAddress, total, placeOrder } =
    useStore();
  const [paymentFailed, setPaymentFailed] = useState(false);
  if (!cartItems.length)
    return (
      <main className="container page">
        <EmptyState title="Your cart is empty">
          Add products before checking out.
        </EmptyState>
      </main>
    );
  if (!user || user.role !== 'customer')
    return (
      <main className="container page">
        <EmptyState
          title="Sign in as a customer to continue"
          action="Sign in"
          href="#/login?next=%2Fcheckout%2Fdelivery"
        >
          Your cart is ready and will be kept when you sign in.
        </EmptyState>
      </main>
    );
  const payment = step === 'payment' && address;
  return (
    <main className="container page">
      <p className="breadcrumb">
        <a href="#/cart">Cart</a> / <a href="#/checkout/delivery">Delivery</a> /
        Payment
      </p>
      <h1>{payment ? 'Payment' : 'Delivery address'}</h1>
      <Notice>
        Demo checkout — no payment is processed and no card details are saved.
      </Notice>
      <div className="checkout-layout">
        {payment ? (
          <section>
            {paymentFailed && (
              <Notice error>
                <strong>Payment failed</strong>
                <p>
                  No charge was made. Check your card details and try again.
                </p>
                <p>Your cart and delivery address have been kept.</p>
              </Notice>
            )}
            <form
              className="panel form-stack"
              onSubmit={async (event) => {
                event.preventDefault();
                const order = await placeOrder();
                if (order) navigate(`/confirmation/${order.id}`);
              }}
            >
              <Field
                label="Cardholder name"
                name="cardholder"
                autoComplete="off"
                defaultValue={user.name}
                required
              />
              <Field
                label="Card number"
                name="cardnumber"
                inputMode="numeric"
                autoComplete="off"
                placeholder="4242 4242 4242 4242"
                pattern="[0-9 ]{13,23}"
                title="Use a sample card number with 13–19 digits."
                maxLength={23}
                required
              />
              <div className="form-row">
                <Field
                  label="Expiry date"
                  name="expiry"
                  placeholder="MM / YY"
                  inputMode="numeric"
                  autoComplete="off"
                  pattern="(0[1-9]|1[0-2])\s?/?\s?[0-9]{2}"
                  title="Enter an expiry date in MM / YY format."
                  required
                />
                <Field
                  label="Security code"
                  name="securitycode"
                  placeholder="123"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  pattern="[0-9]{3,4}"
                  maxLength={4}
                  required
                />
              </div>
              <Button type="submit">
                {paymentFailed ? 'Try payment again' : 'Pay'} · {money(total)}
              </Button>
              <a className="text-button" href="#/checkout/delivery">
                ← Back to delivery
              </a>
            </form>
            <details className="preview-tools">
              <summary>Preview payment error</summary>
              <p>Show the failed-payment state without submitting the form.</p>
              <Button secondary onClick={() => setPaymentFailed(true)}>
                Show payment failed
              </Button>
            </details>
          </section>
        ) : (
          <form
            className="panel form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              setAddress(Object.fromEntries(data));
              navigate('/checkout/payment');
            }}
          >
            <Field
              label="Full name"
              name="name"
              autoComplete="name"
              defaultValue={address?.name || user.name}
              required
            />
            <Field
              label="Street address"
              name="street"
              autoComplete="street-address"
              defaultValue={address?.street || ''}
              required
            />
            <div className="form-row">
              <Field
                label="City"
                name="city"
                autoComplete="address-level2"
                defaultValue={address?.city || ''}
                required
              />
              <Field
                label="Postcode"
                name="postcode"
                autoComplete="postal-code"
                defaultValue={address?.postcode || ''}
                required
              />
            </div>
            <Field
              label="Phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              defaultValue={address?.phone || ''}
              maxLength={40}
              required
            />
            <Button type="submit">Continue to payment</Button>
          </form>
        )}
        <Summary>
          {address && (
            <div className="delivery-summary">
              <h3>Delivery to</h3>
              <p>
                {address.name}
                <br />
                {address.street}
                <br />
                {address.city} {address.postcode}
              </p>
            </div>
          )}
        </Summary>
      </div>
    </main>
  );
}

export function Confirmation({ id }) {
  const { orders } = useStore();
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
