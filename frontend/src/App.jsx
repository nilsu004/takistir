import { useEffect, useState } from 'react';
import { StoreProvider } from './Store.jsx';
import { Footer, Header, Overlays, EmptyState } from './components.jsx';
import { Cart, Catalog, Home, Info, Product, Wishlist } from './Storefront.jsx';
import { Checkout, Confirmation } from './Checkout.jsx';
import { Invoice, Login, Order, Orders, Profile } from './Account.jsx';

import ProductManager from './manager/ProductManager.jsx';

function Router() {
  const [hash, setHash] = useState(window.location.hash.slice(1) || '/');
  useEffect(() => {
    const onHashChange = () => {
      setHash(window.location.hash.slice(1) || '/');
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  const [path, query = ''] = hash.split('?');
  const params = new URLSearchParams(query);
  const [section, id] = path.split('/').filter(Boolean);
  let page;
  switch (section) {
    case undefined:
      page = <Home />;
      break;
    case 'product-manager':
      page = <ProductManager />;
      break;
    case 'catalog':
      page = <Catalog key={hash} params={params} />;
      break;
    case 'product':
      page = <Product key={id} id={id} />;
      break;
    case 'cart':
      page = <Cart />;
      break;
    case 'wishlist':
      page = <Wishlist />;
      break;
    case 'login':
    case 'register':
      page = (
        <Login
          key={section}
          register={section === 'register'}
          next={params.get('next') || '/account'}
        />
      );
      break;
    case 'checkout':
      page = <Checkout step={id} />;
      break;
    case 'confirmation':
      page = <Confirmation id={id} />;
      break;
    case 'account':
      page = <Profile />;
      break;
    case 'orders':
      page = id ? <Order key={id} id={id} /> : <Orders />;
      break;
    case 'invoice':
      page = <Invoice id={id} />;
      break;
    case 'info':
      page = <Info section={id} />;
      break;
    default:
      page = (
        <main className="container page">
          <EmptyState title="Page not found" href="#/" action="Back to home" />
        </main>
      );
  }
  return (
    <>
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          const main = document.querySelector('main');
          main?.setAttribute('tabindex', '-1');
          main?.focus();
        }}
      >
        Skip to content
      </a>
      <Header />
      <div id="main-content" key={path}>
        {page}
      </div>
      <Footer />
      <Overlays />
    </>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Router />
    </StoreProvider>
  );
}
