import { useEffect, useRef, useState } from 'react';
import { Button, EmptyState, Field, Notice, Summary } from '../components.jsx';
import { money, navigate } from '../data.js';
import { useStore } from '../Store.jsx';
import { cartQuote, sameQuote, validateAddress } from './model.js';
import './checkout.css';

export function Checkout({ step }) {
  const {
    user,
    cartItems,
    total,
    address,
    setAddress,
    cartReady,
    cartLoading,
    cartSyncError,
    refreshCart,
    placeOrder,
    checkout,
    retryCheckoutCleanup,
    acknowledgeCheckout,
    busy,
  } = useStore();
  const [reviewed, setReviewed] = useState(null);
  const [errors, setErrors] = useState({});
  const [requestError, setRequestError] = useState('');
  const [paymentFailed, setPaymentFailed] = useState(false);
  const form = useRef(null);
  const mounted = useRef(true);
  const submitting = useRef(false);
  const payment = step === 'payment' && !!address;
  const quote = cartQuote({ items: cartItems, total });
  const changed = !!reviewed && !sameQuote(reviewed, quote);
  const unavailable = cartItems.some((item) => !item.available);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (payment && cartReady && !reviewed) setReviewed(quote);
  }, [payment, cartReady, reviewed, cartItems, total]);
  useEffect(() => {
    const first = ['name', 'street', 'city', 'postcode'].find(
      (name) => errors[name],
    );
    if (first) form.current?.elements.namedItem(first)?.focus();
  }, [errors]);

  async function pay(event) {
    event?.preventDefault();
    if (submitting.current || busy) return;
    submitting.current = true;
    setRequestError('');
    try {
      const result = await placeOrder(reviewed);
      if (!mounted.current) return;
      if (result.order) navigate(`/confirmation/${result.order.id}`);
      else {
        setRequestError(
          result.error || 'Unable to place your order. Please retry.',
        );
        if (result.fieldErrors) navigate('/checkout/delivery');
      }
    } finally {
      submitting.current = false;
    }
  }

  if (user?.role !== 'customer')
    return (
      <main className="container page">
        <EmptyState
          title="Sign in as a customer to continue"
          action={user ? 'My account' : 'Sign in'}
          href={user ? '#/account' : '#/login?next=%2Fcheckout%2Fdelivery'}
        >
          Your guest cart will be kept when you sign in or create a customer
          account.
        </EmptyState>
      </main>
    );
  // These recovery paths remain available even if checkout depleted the stock
  // or emptied the cart. They must not create a fresh checkout attempt.
  if (checkout.uncertain)
    return (
      <main className="container page checkout-page">
        <h1>Check your previous order</h1>
        <Notice error>
          <strong>We could not confirm the result</strong>
          <p>{checkout.error}</p>
          <p>
            Your previous order may have been created. Confirm it before
            starting another order.
          </p>
        </Notice>
        <Button onClick={() => pay()}>
          {checkout.pending
            ? 'Checking your order…'
            : 'Retry order confirmation'}
        </Button>
        <a className="text-button checkout-history-link" href="#/orders">
          View order history
        </a>
      </main>
    );
  if (checkout.cleanupError && checkout.order)
    return (
      <main className="container page checkout-page">
        <h1>Your order is already confirmed</h1>
        <Notice error>
          Order {checkout.order.id} was created, but your cart could not be
          updated. Do not place it again.
        </Notice>
        <div className="button-row">
          <Button onClick={retryCheckoutCleanup}>Retry cart cleanup</Button>
          <a
            className="button button-secondary"
            href={`#/confirmation/${checkout.order.id}`}
          >
            View confirmation
          </a>
        </div>
      </main>
    );
  if (!cartReady)
    return (
      <main className="container page">
        <h1>Checkout</h1>
        {cartSyncError ? (
          <Notice error>
            <p>{cartSyncError}</p>
            <Button onClick={refreshCart}>Retry loading cart</Button>
          </Notice>
        ) : (
          <p role="status">Loading your cart…</p>
        )}
      </main>
    );
  if (!cartItems.length && !checkout.pending)
    return (
      <main className="container page">
        <EmptyState title="Your cart is empty">
          Add products before checking out.
        </EmptyState>
      </main>
    );
  const blocked =
    busy || cartLoading || !!cartSyncError || unavailable || !cartItems.length;
  return (
    <main className="container page checkout-page" aria-busy={checkout.pending}>
      <p className="breadcrumb">
        <a href="#/cart">Cart</a> /{' '}
        <a
          href="#/checkout/delivery"
          onClick={(event) => {
            if (busy) event.preventDefault();
          }}
        >
          Delivery
        </a>{' '}
        / Payment
      </p>
      <h1>{payment ? 'Payment' : 'Delivery address'}</h1>
      <Notice>
        Demo checkout — no payment is processed and no card details are saved or
        sent.
      </Notice>
      {cartSyncError && (
        <Notice error>
          <p>{cartSyncError}</p>
          <Button onClick={refreshCart} disabled={cartLoading}>
            Retry loading cart
          </Button>
        </Notice>
      )}
      {unavailable && (
        <Notice error>
          <strong>Stock or availability changed</strong>
          <p>
            {cartItems
              .filter((item) => !item.available)
              .map(
                (item) =>
                  `${item.name}: requested ${item.qty}, ${item.stock} in stock`,
              )
              .join('; ')}
          </p>
          <a className="text-button" href="#/cart">
            Review quantities in your cart
          </a>
        </Notice>
      )}
      {payment && (changed || checkout.reviewRequired) && (
        <Notice>
          <strong>Review your updated order</strong>
          <p>
            The products, quantities or prices changed. Check the current
            summary before continuing.
          </p>
          <Button
            secondary
            disabled={blocked}
            onClick={() => {
              setReviewed(quote);
              setRequestError('');
              acknowledgeCheckout();
            }}
          >
            I have reviewed this summary · {money(total)}
          </Button>
        </Notice>
      )}
      {(requestError || checkout.error) && !checkout.reviewRequired && (
        <Notice error>
          <strong>Order was not confirmed</strong>
          <p>{requestError || checkout.error}</p>
          <p>Your delivery address and cart have been kept.</p>
        </Notice>
      )}
      {checkout.pending && (
        <p role="status">
          Confirming your order and updating your cart. Please wait…
        </p>
      )}
      <div className="checkout-layout">
        {payment ? (
          <section>
            {paymentFailed && (
              <Notice error>
                <strong>Demo payment failed</strong>
                <p>
                  No order was sent. Your delivery address and cart have been
                  kept.
                </p>
              </Notice>
            )}
            <form className="panel form-stack" onSubmit={pay}>
              <fieldset className="checkout-fields form-stack" disabled={busy}>
                <Field
                  label="Cardholder name"
                  name="cardholder"
                  autoComplete="off"
                  defaultValue={user.name}
                  required
                  maxLength={160}
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
                <Button
                  type="submit"
                  disabled={
                    blocked || changed || checkout.reviewRequired || !reviewed
                  }
                >
                  {checkout.pending
                    ? 'Placing order…'
                    : paymentFailed
                      ? 'Try demo payment again'
                      : 'Place demo order'}{' '}
                  · {money(total)}
                </Button>
                <a
                  className="text-button"
                  href="#/checkout/delivery"
                  onClick={(event) => {
                    if (busy) event.preventDefault();
                  }}
                >
                  ← Back to delivery
                </a>
              </fieldset>
            </form>
            <details className="preview-tools">
              <summary>Preview payment error</summary>
              <p>Show the demo failure state without submitting an order.</p>
              <Button secondary onClick={() => setPaymentFailed(true)}>
                Show payment failed
              </Button>
            </details>
          </section>
        ) : (
          <form
            ref={form}
            className="panel form-stack"
            noValidate
            onChange={() => setErrors({})}
            onSubmit={(event) => {
              event.preventDefault();
              const result = validateAddress(
                Object.fromEntries(new FormData(event.currentTarget)),
              );
              setErrors(result.errors);
              if (Object.keys(result.errors).length || blocked) return;
              setAddress(result.address);
              navigate('/checkout/payment');
            }}
          >
            <fieldset className="checkout-fields form-stack" disabled={busy}>
              {[
                ['name', 'Full name', address?.name || user.name, 'name', 160],
                [
                  'street',
                  'Street address',
                  address?.street || user.home || '',
                  'street-address',
                  300,
                ],
                ['city', 'City', address?.city || '', 'address-level2', 160],
                [
                  'postcode',
                  'Postcode',
                  address?.postcode || '',
                  'postal-code',
                  20,
                ],
              ].map(([name, label, defaultValue, autoComplete, maxLength]) => (
                <div key={name}>
                  <Field
                    label={label}
                    name={name}
                    defaultValue={defaultValue}
                    autoComplete={autoComplete}
                    maxLength={maxLength}
                    required
                    aria-invalid={!!errors[name]}
                    aria-describedby={
                      errors[name] ? `checkout-${name}-error` : undefined
                    }
                  />
                  {errors[name] && (
                    <small
                      className="checkout-field-error"
                      id={`checkout-${name}-error`}
                    >
                      {errors[name]}
                    </small>
                  )}
                </div>
              ))}
              <Button type="submit" disabled={blocked}>
                Continue to payment
              </Button>
            </fieldset>
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
