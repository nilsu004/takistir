import { cartQuote, sameQuote, validateAddress } from './model.js';

export function createCheckoutClient({
  request,
  cart,
  getUser,
  applyState,
  makeKey = () => crypto.randomUUID(),
}) {
  let state = initialState();
  let attempt;
  let generation = 0;
  const listeners = new Set();
  const publish = (fields) => {
    state = { ...state, ...fields };
    listeners.forEach((listener) => listener());
  };
  const sameAccount = (id, scope) =>
    generation === scope && getUser()?.id === id;

  async function cleanUp(scope) {
    const current = attempt;
    const refreshed = await cart.refresh({ force: true });
    if (!sameAccount(current.userId, scope))
      throw new Error('The account changed.');
    if (!refreshed || refreshed.error)
      throw new Error(refreshed?.error || 'Cannot load the cart.');
    // Calculate cleanup targets once. Retrying cleanup must not subtract paid
    // quantities twice, and unrelated products added in another tab stay put.
    current.targets ??= current.items.map((paid) => {
      const line = cart.getSnapshot().items.find((item) => item.id === paid.id);
      return { id: paid.id, qty: Math.max(0, (line?.qty || 0) - paid.qty) };
    });
    for (const target of current.targets) {
      const line = cart
        .getSnapshot()
        .items.find((item) => item.id === target.id);
      if (!line || line.qty <= target.qty) continue;
      const result = await cart.setQuantity(target.id, target.qty);
      if (!sameAccount(current.userId, scope))
        throw new Error('The account changed.');
      if (result.error) {
        const remaining = cart
          .getSnapshot()
          .items.find((item) => item.id === target.id);
        if (
          cart.getSnapshot().syncError ||
          (remaining && remaining.qty > target.qty)
        )
          throw new Error(result.error);
      }
    }
    publish({ cleanupError: '' });
    attempt = undefined;
  }

  async function submit(input, reviewedQuote) {
    if (state.pending)
      return { error: 'Your order is already being submitted.' };
    const user = getUser();
    if (user?.role !== 'customer')
      return { error: 'Sign in as a customer before placing an order.' };
    if (state.cleanupError)
      return { order: state.order, cleanupError: state.cleanupError };
    const scope = generation;
    publish({
      pending: true,
      error: '',
      fieldErrors: {},
      reviewRequired: false,
    });
    if (!state.uncertain) publish({ order: null, priceWarning: '' });
    let sent = false;
    try {
      if (!state.uncertain) {
        const { address, errors } = validateAddress(input);
        if (Object.keys(errors).length) {
          publish({ fieldErrors: errors });
          return {
            error: 'Please check your delivery address.',
            fieldErrors: errors,
          };
        }
        const refreshed = await cart.refresh({ force: true });
        if (!sameAccount(user.id, scope))
          throw new Error('The account changed.');
        if (!refreshed || refreshed.error)
          throw new Error(refreshed?.error || 'Cannot refresh your cart.');
        const currentCart = cart.getSnapshot();
        if (
          !currentCart.items.length ||
          currentCart.items.some((item) => !item.available)
        )
          throw new Error(
            'Stock or availability changed. Please review your cart.',
          );
        if (!sameQuote(reviewedQuote, cartQuote(currentCart))) {
          publish({ reviewRequired: true });
          throw new Error(
            'Your cart or total has changed. Review the updated summary before placing your order.',
          );
        }
        attempt = {
          userId: user.id,
          key: makeKey(),
          address,
          quote: reviewedQuote,
          items: currentCart.items.map(({ id, qty }) => ({ id, qty })),
        };
      }
      if (!attempt || attempt.userId !== user.id)
        throw new Error('The account changed.');
      sent = true;
      const response = await request('/orders', {
        method: 'POST',
        body: {
          items: attempt.items,
          address: attempt.address,
          key: attempt.key,
        },
      });
      if (!sameAccount(user.id, scope))
        return { error: 'The account changed. Check your order history.' };
      if (response.state?.user?.id !== user.id)
        throw new Error('The account changed. Check your order history.');
      const order = response.state.orders.find(
        (item) => item.id === response.data,
      );
      if (!order)
        throw new Error(
          'The order response was incomplete. Check the previous order before trying again.',
        );
      const orderTotal =
        order.items.reduce(
          (sum, item) => sum + Math.round(item.price * 100) * item.qty,
          0,
        ) / 100;
      const priceWarning =
        orderTotal !== attempt.quote.total
          ? 'The server confirmed a different total after the final stock/price check. The amount shown on this order is the confirmed amount.'
          : '';
      applyState(response.state);
      publish({ order, uncertain: false, priceWarning });
      try {
        await cleanUp(scope);
      } catch (error) {
        if (sameAccount(user.id, scope))
          publish({ cleanupError: error.message });
      }
      return { order, cleanupError: state.cleanupError, error: '' };
    } catch (error) {
      if (!sameAccount(user.id, scope))
        return { error: 'The account changed.' };
      const uncertain =
        sent && ![400, 401, 403, 404, 409, 422, 429].includes(error.status);
      publish({ error: error.message, uncertain });
      if (sent && !uncertain) attempt = undefined;
      await cart.refresh({ force: true });
      return {
        error: error.message,
        uncertain,
        reviewRequired: state.reviewRequired,
      };
    } finally {
      if (scope === generation) publish({ pending: false });
    }
  }

  async function retryCleanup() {
    if (
      state.pending ||
      !attempt ||
      !state.order ||
      getUser()?.id !== attempt.userId
    )
      return;
    const scope = generation;
    publish({ pending: true });
    try {
      await cleanUp(scope);
    } catch (error) {
      if (scope === generation) publish({ cleanupError: error.message });
    } finally {
      if (scope === generation) publish({ pending: false });
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    submit,
    retryCleanup,
    acknowledgeReview() {
      if (!state.pending && !state.uncertain)
        publish({ error: '', reviewRequired: false });
    },
    reset() {
      generation += 1;
      attempt = undefined;
      state = initialState();
      listeners.forEach((listener) => listener());
    },
  };
}
function initialState() {
  return {
    pending: false,
    error: '',
    fieldErrors: {},
    reviewRequired: false,
    uncertain: false,
    order: null,
    cleanupError: '',
    priceWarning: '',
  };
}
