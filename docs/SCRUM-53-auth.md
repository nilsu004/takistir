# SCRUM-53: login and registration

## Frontend changes

- `frontend/src/auth/Login.jsx` contains the login/registration UI. `Account.jsx` re-exports it to preserve the existing route imports. Existing account and order pages are retained.
- Registration requires a full name, valid email, home address, an 8–128-character password and a matching confirmation. The API trims passwords; the frontend rejects leading/trailing spaces when creating one, instead of silently creating a different password. Sign-in does not impose a new registration policy on existing passwords.
- Field errors are associated with their inputs and the first invalid field receives focus. Forms and demo actions are disabled during a request, duplicate submissions are blocked, and errors permit retry without discarding the guest cart. Password visibility is optional. Passwords are never stored in localStorage/sessionStorage or application state.
- Email addresses and names are normalized before submission. Password confirmation is validated locally and is not sent to the API. Self-registration never supplies or chooses a staff role. After account creation, the home address is saved through the existing profile endpoint; this second request never sends the password. If address saving fails, the user stays signed in, receives an explicit warning and goes to the profile screen to correct it. Account creation is not retried.
- Successful login/registration waits for the existing server cart reload. Guest-cart retention and account/guest separation use SCRUM-50 and the backend's existing SCRUM-52 merge. Notices explain retained products, stock-capped quantities and products skipped by the cart-line limit; the browser does not re-add merged products.
- If authentication succeeds but the cart reload fails, checkout return destinations lead to the cart for retry. The session is not reported as a failed login and no second registration request is sent.
- Return destinations are restricted to known customer routes. Auth loops, external paths, backslashes and control characters are rejected. Product Manager goes to its workspace; unsupported staff roles go to the account screen. An already signed-in visitor sees a continuation link instead of a second login form.
- Merge notices survive navigation in memory and can be dismissed; account changes remove the previous account's notice.

## Try it locally

Run `npm run dev` and open <http://127.0.0.1:5173/#/login>.

1. Add an in-stock product as a guest, then continue to checkout. Submit an incorrect password; confirm the error is shown and the guest cart remains. Sign in using the customer demo and confirm the cart remains and the delivery form opens.
2. Sign out. Add another guest item and open registration using the link from login. Try an empty name/address, invalid email, short password and mismatching confirmation. Check the field errors and show/hide password control.
3. Register with a new email and matching passwords. Confirm the customer session, saved home address on the profile and retained-cart notice. A duplicate email must show the API's error and leave the guest cart unchanged.
4. Put the same product in the account cart and a guest cart with summed quantities exceeding stock. After login, check the notice explaining requested/kept quantities and the actual server cart quantity.
5. Sign out and back in. The account cart must be hidden from guests and restored after login. A staff sign-in must not consume the guest cart or open customer checkout.
6. Open `#/login?next=%2Fcheckout%2Fdelivery`, then switch to registration and back; the destination must persist. An external or manager return destination must not redirect a customer outside the allowed customer routes.
7. Test server/network errors, keyboard focus, duplicate-click protection and narrow layouts.

## Checks

`frontend/src/auth/model.test.js` tests validation, accepted payloads, return destinations, role routing, merge feedback and request errors. `api.test.js` runs the production frontend auth adapter and cart client against the real backend in fresh temporary PostgreSQL databases, covering registration with a saved address, stock-capped merges, failed login/duplicate registration, logout/restoration, staff separation and recovery from address-save failure without duplicate account creation. Both run under `npm test` and `npm run check`.

## Backend boundaries and course requirements

Browser checks used Safari and a separate temporary PostgreSQL cluster. Empty-form validation, password mismatch, successful registration/return navigation, saved home address on the profile, logout, wrong-password feedback with an unchanged guest cart, and successful customer login with the retained-cart notice were verified. No production/team database was used. Native mobile-device testing remains outstanding.

No backend, shared business-rule or database files are changed. Login/registration use existing endpoints and HttpOnly server sessions; frontend routing is not authorization.

The current register endpoint persists only name, email and password credentials. Course requirement 14 also requires tax ID and home address on customer records. This frontend saves the required home address immediately after account creation using the existing profile endpoint, but tax ID cannot currently be supplied/updated through the API. Completing tax-ID registration requires a coordinated backend contract change; SCRUM-53 must not be presented as completing that full course requirement. Government-ID collection beyond the specified tax ID should not be invented.

Password reset, email verification and production staff provisioning remain unimplemented backend capabilities. Sales Manager and Support Agent screens are outside this task.

## Coordination

This task builds on the SCRUM-50 API cart. SCRUM-53 changes are concentrated in `auth/`, the login re-export in `Account.jsx`, the login adapter/notice in `Store.jsx` and the test script. Review the shared `Store.jsx` sections when combining Doğa's work.
