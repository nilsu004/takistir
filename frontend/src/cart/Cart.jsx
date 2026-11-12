import { useState } from 'react';
import {
  Button,
  EmptyState,
  Notice,
  ProductArt,
  Quantity,
  Summary,
} from '../components.jsx';
import { money, navigate } from '../data.js';
import { useStore } from '../Store.jsx';
import './cart.css';

export function Cart() {
  const {
    cartItems,
    updateQuantity,
    clearCart,
    user,
    busy,
    cartReady,
    cartEnabled,
    cartLoading,
    cartBusy,
    cartError,
    refreshCart,
    checkout,
  } = useStore();
  const [confirmClear, setConfirmClear] = useState(false);
  if (!cartEnabled)
    return (
      <main className="container page">
        <EmptyState
          title="Shopping carts are for customers and guests"
          href="#/account"
          action="My account"
        >
          Sign out of your staff account to shop as a guest, or sign in as a
          customer.
        </EmptyState>
      </main>
    );

  const unavailable = cartItems.some((item) => !item.available);
  const locked =
    checkout.pending || checkout.uncertain || !!checkout.cleanupError;
  return (
    <main
      className="container page cart-page"
      aria-busy={!cartReady && cartLoading}
    >
      <p className="breadcrumb">
        <a href="#/">Home</a> / Cart
      </p>
      <div className="page-heading">
        <h1>Cart</h1>
        <Button secondary disabled={cartLoading} onClick={refreshCart}>
          {cartLoading ? 'Refreshing…' : 'Refresh cart'}
        </Button>
      </div>
      {cartError && (
        <Notice error>
          <strong>Your cart needs attention</strong>
          <p>{cartError}</p>
          <Button secondary disabled={cartLoading} onClick={refreshCart}>
            Retry
          </Button>
        </Notice>
      )}
      {locked && (
        <Notice>
          Finish checking your previous order before changing this cart.{' '}
          <a
            className="text-button"
            href={
              checkout.order
                ? `#/confirmation/${checkout.order.id}`
                : '#/checkout/payment'
            }
          >
            Review previous checkout
          </a>
        </Notice>
      )}
      <p className="sr-only" role="status">
        {cartBusy
          ? 'Saving your cart…'
          : cartLoading
            ? 'Refreshing your cart…'
            : ''}
      </p>
      {!cartReady ? (
        !cartError && <p role="status">Loading your cart…</p>
      ) : !cartItems.length ? (
        <EmptyState title="Your cart is empty">
          Add an accessory to start your order.
        </EmptyState>
      ) : (
        <>
          {unavailable && (
            <Notice>
              Some items are unavailable in the requested quantity. Reduce their
              quantities or remove them before checkout. Unavailable items are
              excluded from the total.
            </Notice>
          )}
          <div className="checkout-layout">
            <section
              className="cart-items"
              aria-label="Cart items"
              aria-busy={cartBusy}
            >
              {cartItems.map((item) => (
                <article className="cart-item" key={item.id}>
                  <a href={`#/product/${item.id}`}>
                    <ProductArt product={item} />
                  </a>
                  <div className="cart-item-copy">
                    <h2>
                      <a href={`#/product/${item.id}`}>{item.name}</a>
                    </h2>
                    <p className="muted">
                      {money(item.price)} · {item.stock} in stock
                    </p>
                    {!item.available && (
                      <p className="cart-item-warning">
                        {item.price === null
                          ? 'Price pending.'
                          : item.stock === 0
                            ? 'This product is no longer available.'
                            : `Only ${item.stock} available; you requested ${item.qty}.`}
                      </p>
                    )}
                    <Quantity
                      label={`${item.name} quantity`}
                      value={item.qty}
                      max={item.stock}
                      disabled={
                        busy ||
                        locked ||
                        cartLoading ||
                        item.stock === 0 ||
                        item.price === null
                      }
                      onChange={(value) => updateQuantity(item.id, value)}
                    />
                    {!item.available &&
                      item.stock > 0 &&
                      item.price !== null && (
                        <Button
                          secondary
                          className="cart-adjust"
                          disabled={cartLoading || locked}
                          onClick={() => updateQuantity(item.id, item.stock)}
                        >
                          Use available stock ({item.stock})
                        </Button>
                      )}
                    <button
                      className="text-button remove-item"
                      disabled={busy || cartLoading || locked}
                      onClick={() => updateQuantity(item.id, 0)}
                    >
                      Remove<span className="sr-only"> {item.name}</span>
                    </button>
                  </div>
                  <strong>
                    {item.available
                      ? money(item.price * item.qty)
                      : 'Unavailable'}
                  </strong>
                </article>
              ))}
              <div className="cart-footer-actions">
                <a className="text-button" href="#/catalog">
                  ← Continue shopping
                </a>
                <button
                  className="text-button"
                  disabled={busy || cartLoading || locked}
                  onClick={() => setConfirmClear(true)}
                >
                  Clear cart
                </button>
              </div>
              {confirmClear && (
                <section
                  className="panel cart-clear-confirm"
                  aria-label="Confirm clearing cart"
                >
                  <h2>Remove all items?</h2>
                  <p>Your cart will be emptied.</p>
                  <div className="button-row">
                    <Button
                      disabled={cartLoading || locked}
                      onClick={async () => {
                        if (await clearCart()) setConfirmClear(false);
                      }}
                    >
                      Clear cart
                    </Button>
                    <Button secondary onClick={() => setConfirmClear(false)}>
                      Keep items
                    </Button>
                  </div>
                </section>
              )}
            </section>
            <Summary>
              <Button
                disabled={unavailable || !!cartError || cartLoading || locked}
                onClick={() =>
                  navigate(
                    user
                      ? '/checkout/delivery'
                      : '/login?next=%2Fcheckout%2Fdelivery',
                  )
                }
              >
                {cartBusy ? 'Updating cart…' : 'Continue to checkout'}
              </Button>
              {!user && (
                <p className="muted small">
                  Sign in to continue. Your cart will be kept.
                </p>
              )}
              <p className="muted small">
                Items are not reserved until your order is placed.
              </p>
            </Summary>
          </div>
        </>
      )}
    </main>
  );
}
