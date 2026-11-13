import { useState } from 'react';
import {
  Button,
  EmptyState,
  Notice,
  ProductArt,
  ProductGrid,
  Quantity,
  Summary,
} from './components.jsx';
import { money } from './data.js';
import { publishedRating } from './manager/model.js';
import { useStore } from './Store.jsx';

export function Home() {
  const { products } = useStore();
  return (
    <main className="container home-page">
      <h1 className="sr-only">Takıştır accessories</h1>
      <section className="hero" aria-label="New arrivals">
        <div className="hero-copy">
          <p className="eyebrow">Takıştır / New arrivals</p>
          <a className="button button-secondary" href="#/catalog">
            Browse products →
          </a>
        </div>
        <div className="hero-art">
          <img
            src="/assets/necklace-hero.svg"
            alt="Gold necklace with a pearl pendant"
          />
        </div>
      </section>
      <section className="featured">
        <h2>Featured products</h2>
        <ProductGrid products={products} />
      </section>
    </main>
  );
}

export function Catalog({ params }) {
  const { products, categories } = useStore();
  const [category, setCategory] = useState(
    params.get('category') || 'All accessories',
  );
  const [availability, setAvailability] = useState('all');
  const [sort, setSort] = useState('popular');
  const query = params.get('q') || '';
  const shown = products
    .filter(
      (p) =>
        (category === 'All accessories' || p.category === category) &&
        `${p.name} ${p.description}`
          .toLowerCase()
          .includes(query.toLowerCase()) &&
        (availability === 'all' || p.stock > 0),
    )
    .sort((a, b) =>
      sort === 'low'
        ? a.price - b.price
        : sort === 'high'
          ? b.price - a.price
          : b.popularity - a.popularity,
    );
  return (
    <main className="container page">
      <div className="page-heading">
        <div>
          <p className="breadcrumb">
            <a href="#/">Home</a> / Products
          </p>
          <h1>{query ? `Results for “${query}”` : category}</h1>
          <p className="muted">
            {shown.length} {shown.length === 1 ? 'product' : 'products'}
          </p>
        </div>
      </div>
      <div className="filters">
        <label>
          Category
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            {['All accessories', ...categories].map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <label>
          Availability
          <select
            value={availability}
            onChange={(event) => setAvailability(event.target.value)}
          >
            <option value="all">All products</option>
            <option value="in-stock">In stock</option>
          </select>
        </label>
        <label className="sort-filter">
          Sort by
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="popular">Popularity</option>
            <option value="low">Price: low to high</option>
            <option value="high">Price: high to low</option>
          </select>
        </label>
      </div>
      {shown.length ? (
        <ProductGrid products={shown} />
      ) : (
        <EmptyState
          title="No products found"
          href="#/catalog"
          action="Clear filters"
          onAction={() => {
            setCategory('All accessories');
            setAvailability('all');
          }}
        >
          Try another search or category.
        </EmptyState>
      )}
    </main>
  );
}

export function Product({ id }) {
  const {
    products,
    addToCart,
    toggleWishlist,
    wishlist,
    user,
    orders,
    reviews,
    submitReview,
    setToast,
  } = useStore();
  const [qty, setQty] = useState(1);
  const [reviewOpen, setReviewOpen] = useState(false);
  const product = products.find((p) => p.id === id);
  if (!product)
    return (
      <main className="container page">
        <EmptyState title="Product not found">
          Browse the catalog to find another accessory.
        </EmptyState>
      </main>
    );
  const saved = wishlist.includes(id);
  const eligible =
    user?.role === 'customer' &&
    orders.some(
      (order) =>
        order.status === 'Delivered' &&
        order.items.some((item) => item.id === id),
    );
  const ownReviews = reviews.filter((review) => review.productId === id);
  const { rating, count } = publishedRating(product, reviews);
  return (
    <main className="container product-page">
      <p className="breadcrumb">
        <a href="#/">Home</a> /{' '}
        <a href={`#/catalog?category=${product.category}`}>
          {product.category}
        </a>{' '}
        / {product.name}
      </p>
      <div className="product-detail">
        <ProductArt product={product} detail />
        <div className="product-information">
          <p className="eyebrow">{product.collection}</p>
          <h1>{product.name}</h1>
          <a
            className="rating"
            href="#reviews"
            onClick={(event) => {
              event.preventDefault();
              document
                .getElementById('reviews')
                ?.scrollIntoView({ behavior: 'smooth' });
            }}
          >
            ★★★★★ &nbsp; {rating} / 5 · {count} reviews
          </a>
          <p className="detail-price">{money(product.price)}</p>
          {product.price === null && (
            <p className="muted">
              Available to purchase after Sales Manager pricing.
            </p>
          )}
          <p className="product-description">{product.description}</p>
          <p className={product.stock ? 'stock' : 'out-of-stock'}>
            {product.stock
              ? `${product.stock} in stock · Ships in 1–3 business days`
              : 'Out of stock'}
          </p>
          <div className="product-actions">
            <Quantity value={qty} onChange={setQty} max={product.stock} />
            <Button
              disabled={!product.stock || product.price === null}
              onClick={() => addToCart(id, qty)}
            >
              Add to cart
            </Button>
            <Button
              secondary
              aria-label={saved ? 'Remove from wishlist' : 'Add to wishlist'}
              aria-pressed={saved}
              onClick={() => toggleWishlist(id)}
            >
              {saved ? '♥' : '♡'}
            </Button>
          </div>
          <div className="product-specs">
            <p>
              Product ID: {id} · Model: {product.model}
            </p>
            <p>Serial no: {product.serial}</p>
            <p>
              Warranty: {product.warranty} · Distributor: {product.distributor}
            </p>
            <p>Material: {product.material}</p>
          </div>
        </div>
      </div>
      <section className="reviews-section" id="reviews">
        <div className="section-heading">
          <h2>Customer reviews</h2>
          {eligible && (
            <Button secondary onClick={() => setReviewOpen(!reviewOpen)}>
              Write a review
            </Button>
          )}
        </div>
        <Notice>
          Only purchased and delivered products can be reviewed. Star ratings
          appear immediately. Comments appear after Product Manager approval.
        </Notice>
        {reviewOpen && (
          <form
            className="panel review-form"
            onSubmit={async (event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const error = await submitReview(
                id,
                Number(data.get('rating')),
                String(data.get('comment')),
              );
              if (error) {
                setToast(error);
                return;
              }
              setReviewOpen(false);
            }}
          >
            <label className="field">
              Rating
              <select name="rating" required>
                <option value="5">5 stars</option>
                <option value="4">4 stars</option>
                <option value="3">3 stars</option>
                <option value="2">2 stars</option>
                <option value="1">1 star</option>
              </select>
            </label>
            <label className="field">
              Comment
              <textarea name="comment" required maxLength={500} />
            </label>
            <Button type="submit">Submit review</Button>
          </form>
        )}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Rating</th>
                <th>Review</th>
                <th>Customer</th>
              </tr>
            </thead>
            <tbody>
              {ownReviews
                .filter((review) => review.status === 'Approved')
                .map((review) => (
                  <tr key={review.id}>
                    <td>{'★'.repeat(review.rating)}</td>
                    <td>{review.comment}</td>
                    <td>{review.author?.slice(0, 1)}*** · Verified purchase</td>
                  </tr>
                ))}
              {!ownReviews.some((review) => review.status === 'Approved') && (
                <tr>
                  <td colSpan={3}>No published comments yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {user &&
          ownReviews.some(
            (review) =>
              review.status === 'Pending' && review.customerId === user.id,
          ) && (
            <p className="muted">
              Your rating is published. Your comment is awaiting approval.
            </p>
          )}
      </section>
    </main>
  );
}

export function Cart() {
  const { cartItems, updateQuantity, user } = useStore();
  if (!cartItems.length)
    return (
      <main className="container page">
        <EmptyState title="Your cart is empty">
          Add an accessory to start your order.
        </EmptyState>
      </main>
    );
  return (
    <main className="container page">
      <p className="breadcrumb">
        <a href="#/">Home</a> / Cart
      </p>
      <h1>Cart</h1>
      <div className="checkout-layout">
        <section className="cart-items" aria-label="Cart items">
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
                  {item.category} · {money(item.price)}
                </p>
                <Quantity
                  label={`${item.name} quantity`}
                  value={item.qty}
                  max={item.stock}
                  onChange={(value) => updateQuantity(item.id, value)}
                />
                <button
                  className="text-button remove-item"
                  onClick={() => updateQuantity(item.id, 0)}
                >
                  Remove
                </button>
              </div>
              <strong>{money(item.qty * item.price)}</strong>
            </article>
          ))}
          <a className="text-button" href="#/catalog">
            ← Continue shopping
          </a>
        </section>
        <Summary>
          <a
            className="button"
            href={
              user
                ? '#/checkout/delivery'
                : '#/login?next=%2Fcheckout%2Fdelivery'
            }
          >
            Continue to checkout
          </a>
          {!user && (
            <p className="muted small">
              Sign in to continue. Your cart will be kept.
            </p>
          )}
        </Summary>
      </div>
    </main>
  );
}

export function Wishlist() {
  const { products, wishlist } = useStore();
  return (
    <main className="container page">
      <h1>Wishlist</h1>
      {wishlist.length ? (
        <ProductGrid
          products={products.filter((p) => wishlist.includes(p.id))}
        />
      ) : (
        <EmptyState title="Your wishlist is empty">
          Save products with the heart button to find them here.
        </EmptyState>
      )}
    </main>
  );
}

export function Info({ section }) {
  const { setChatOpen } = useStore();
  const content = {
    contact: [
      'Contact',
      'For help with products, delivery or an order, start a conversation with our support team.',
    ],
    returns: [
      'Delivery and returns',
      'Orders ship in 1–3 business days. Delivered items may be returned within 30 days of purchase. Select eligible items from your order details. Refunds use the original amount paid and are reviewed after the returned items arrive.',
    ],
    privacy: [
      'Privacy',
      'Your cart and wishlist are stored in this browser. Account credentials are verified by the local API. Card details are never sent to or stored by the API.',
    ],
  }[section];
  if (!content)
    return (
      <main className="container page">
        <EmptyState title="Page not found" />
      </main>
    );
  return (
    <main className="container page narrow-page">
      <h1>{content[0]}</h1>
      <p>{content[1]}</p>
      <Button onClick={() => setChatOpen(true)}>Contact support</Button>
    </main>
  );
}
