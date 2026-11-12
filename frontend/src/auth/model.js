export function validateCredentials({
  email = '',
  password = '',
  name,
  confirmation,
  home,
}) {
  const errors = {};
  const registering = name !== undefined;
  const normalizedEmail =
    typeof email === 'string' ? email.trim().toLowerCase() : '';
  password = typeof password === 'string' ? password : '';
  const normalizedName = typeof name === 'string' ? name.trim() : '';
  const normalizedHome = typeof home === 'string' ? home.trim() : '';
  if (
    normalizedEmail.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
  )
    errors.email = 'Enter a valid email address.';
  if (!password.trim() || password.length > 128)
    errors.password = 'Enter your password (maximum 128 characters).';
  if (registering) {
    if (!normalizedName || normalizedName.length > 160)
      errors.name = 'Enter your full name (maximum 160 characters).';
    if (password.length < 8 || password.length > 128)
      errors.password = 'Use a password with 8–128 characters.';
    // The current API trims passwords. Do not silently register a different
    // password from the one the customer chose.
    else if (password !== password.trim())
      errors.password = 'Your password must not start or end with spaces.';
    if (password !== confirmation)
      errors.confirmation = 'Passwords do not match.';
    if (!normalizedHome || normalizedHome.length > 500)
      errors.home = 'Enter your home address (maximum 500 characters).';
  }
  return {
    errors,
    home: normalizedHome,
    body: {
      email: normalizedEmail,
      password,
      ...(registering ? { name: normalizedName } : {}),
    },
  };
}

export function safeDestination(next) {
  if (typeof next !== 'string' || /[\\#\u0000-\u0020]/.test(next))
    return '/account';
  const path = next.split('?')[0];
  return /^\/(?:$|catalog|cart|wishlist|account|product\/[^/]+|orders(?:\/[^/]+)?|invoice\/[^/]+|checkout\/(?:delivery|payment))$/.test(
    path,
  )
    ? next
    : '/account';
}

export function signedInDestination(
  user,
  next,
  cartError = '',
  profileError = '',
) {
  if (user.role === 'product-manager') return '/product-manager';
  if (user.role !== 'customer') return '/account';
  if (profileError) return '/account';
  const destination = safeDestination(next);
  return cartError && destination.startsWith('/checkout/')
    ? '/cart'
    : destination;
}

export function mergeNotice(summary, products = []) {
  if (!summary) return null;
  const messages = [];
  const label = (id) =>
    products.find((product) => product.id === id)?.name || id;
  if (summary.merged > 0)
    messages.push(
      `${summary.merged} guest-cart product${summary.merged === 1 ? '' : 's'} saved to your account.`,
    );
  for (const adjustment of summary.adjusted || [])
    messages.push(
      `${label(adjustment.id)}: requested ${adjustment.requested}, kept ${adjustment.qty} due to available stock.`,
    );
  if (summary.skipped?.length)
    messages.push(
      `Not added because your account cart is full: ${summary.skipped.map(label).join(', ')}. Review your cart.`,
    );
  return messages.length ? messages.join(' ') : null;
}

// This adapter is used by the UI's store and is testable without storing any
// credentials. The existing mutation path owns session cookies and cart reload.
export async function submitCredentials(credentials, mutate) {
  const { body, errors, home } = validateCredentials(credentials);
  if (Object.keys(errors).length)
    return {
      error: 'Please check the highlighted fields.',
      fieldErrors: errors,
    };
  let result;
  try {
    result = await mutate(
      credentials.name !== undefined ? '/auth/register' : '/auth/login',
      'POST',
      body,
      credentials.name !== undefined
        ? 'Account created. You are signed in.'
        : 'Signed in.',
    );
  } catch (error) {
    return { error: error.message || 'Unable to sign in. Please try again.' };
  }
  if (result.error) return result;
  // Registration currently accepts only name/email/password. Save the required
  // address through the existing profile API, retaining the registration merge
  // result. A failure here must never be reported as a failed registration.
  if (credentials.name !== undefined) {
    let profile;
    try {
      profile = await mutate('/profile', 'PATCH', {
        name: body.name,
        email: body.email,
        home,
      });
    } catch (error) {
      profile = {
        error: error.message || 'Please try saving it from your profile.',
      };
    }
    if (profile.error)
      result = {
        ...result,
        profileError: `Your account was created, but your home address was not saved. Update it in your profile. ${profile.error}`,
      };
    else result = { ...result, state: profile.state };
  }
  return {
    ...result,
    notice: mergeNotice(result.data?.cart, result.state.products),
  };
}
