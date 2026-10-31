import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';

const NPR = new Intl.NumberFormat('en-NP', { style: 'currency', currency: 'NPR', maximumFractionDigits: 0 });

function useDocumentTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} — Sajilo Pasal` : 'Sajilo Pasal — Shop local, live better';
  }, [title]);
}

// 24 hex characters, same shape as a MongoDB ObjectId, doubling as the
// server-side idempotency key for one checkout submission.
function createCheckoutKey() {
  const bytes = new Uint8Array(12);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function submitPaymentForm(payment) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = payment.gatewayUrl;
  Object.entries(payment.formData).forEach(([name, value]) => {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  });
  document.body.appendChild(form);
  form.submit();
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

async function request(path, options = {}) {
  const isFormData = options.body instanceof FormData;
  const headers = { ...(options.body && !isFormData ? { 'Content-Type': 'application/json' } : {}), ...options.headers };
  const url = path.startsWith('http') ? path : `${API_BASE_URL}${path}`;
  const response = await fetch(url, { ...options, headers, credentials: 'include' });
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || 'Something went wrong. Please try again.');
    error.status = response.status;
    throw error;
  }
  return data;
}

function useSession() {
  const [user, setUser] = useState(null);
  const [cartCount, setCartCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState('');
  const navigate = useNavigate();
  const sessionGeneration = useRef(0);

  const acceptAuth = (data) => {
    sessionGeneration.current += 1;
    setUser(data.user);
    setLoading(false);
    setSessionError('');
  };

  const logout = async () => {
    try {
      await request('/api/v1/auth/logout', { method: 'POST' });
      sessionGeneration.current += 1;
      setUser(null);
      setCartCount(0);
      setSessionError('');
      navigate('/');
    } catch (error) {
      if (error.status === 401) {
        sessionGeneration.current += 1;
        setUser(null);
        setCartCount(0);
        setSessionError('');
        navigate('/');
        return;
      }
      setSessionError(error.message);
    }
  };

  useEffect(() => {
    localStorage.removeItem('sajilo-token');
    localStorage.removeItem('sajilo-user');
    const generation = sessionGeneration.current;
    let active = true;
    request('/api/v1/auth/me')
      .then(({ user: currentUser }) => {
        if (active && generation === sessionGeneration.current) setUser(currentUser);
      })
      .catch((error) => {
        if (!active || generation !== sessionGeneration.current || error.status === 401) return;
        setSessionError(error.message);
      })
      .finally(() => {
        if (active && generation === sessionGeneration.current) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!user || loading) return;
    request('/api/v1/users/cart')
      .then(({ cart = [] }) => setCartCount(cart.reduce((sum, row) => sum + row.quantity, 0)))
      .catch(() => setCartCount(0));
  }, [user, loading]);

  return { user, setUser, cartCount, setCartCount, acceptAuth, logout, loading, sessionError };
}

function Header({ session }) {
  const { user, cartCount, logout, sessionError } = session;
  return <header className="site-header">
    <div className="header-inner">
      <Link to="/" className="brand" aria-label="Sajilo Pasal home"><img className="brand-mark" src="/images/sajilo-pasal-mark.png" alt="" /><span>Sajilo Pasal<small>EASY MARKET FOR GROCERY</small></span></Link>
      <nav className="main-nav" aria-label="Main navigation">
        <Link to="/">Shop</Link>
        {user && <Link to="/orders">My orders</Link>}
        {user?.role === 'seller' && <Link to="/seller">Seller studio</Link>}
        {user?.role === 'admin' && <><Link to="/admin">Admin</Link><Link to="/admin/catalog">Catalog</Link></>}
      </nav>
      <div className="header-actions">
        {user ? <>
          <Link className="nav-profile" to="/profile">{user.name}</Link>
          <Link to="/cart" className="cart-link">Bag <span className="cart-count">{cartCount}</span></Link>
          <button className="button button-quiet header-logout" onClick={logout}>Log out</button>
        </> : <><Link to="/login" className="header-login">Log in</Link><Link to="/register" className="button button-dark header-join">Create account</Link></>}
      </div>
      {sessionError && <p className="form-error" role="alert">{sessionError}</p>}
    </div>
  </header>;
}

function ProductCard({ product, onAdd, onBuyNow = onAdd, onRemove }) {
  const locality = [product.location?.municipality, product.location?.district, product.location?.province]
    .filter(Boolean)
    .join(', ');
  return <article className="product-card">
    <Link to={`/products/${product._id}`} className="product-image-wrap">
      {product.images?.[0] ? <img src={product.images[0]} alt={product.name} loading="lazy" /> : <div className="image-placeholder"><span>SAJILO</span></div>}
      {product.stock <= 0 && <span className="stock-label">Out of stock</span>}
    </Link>
    <div className="product-meta"><span>{product.category}</span><span>{product.stock > 0 ? 'In stock' : 'Unavailable'}</span></div>
    <Link to={`/products/${product._id}`} className="product-name">{product.name}</Link>
    {locality && <p className="product-location">{locality}</p>}
    <div className="product-price-row"><strong>{NPR.format(product.price)}</strong>{product.stock > 0 ? <span>{product.stock} available</span> : <span>Unavailable</span>}</div>
    <div className="product-actions">
      <button disabled={product.stock <= 0} onClick={() => onAdd(product)} className="button button-outline">Add to cart</button>
      <button disabled={product.stock <= 0} onClick={() => onBuyNow(product)} className="button button-dark">Buy now</button>
    </div>
    {onRemove && <button className="remove-button wishlist-remove" onClick={() => onRemove(product._id)}>Remove from saved items</button>}
  </article>;
}

const MEAL_PLANNER_OPTIONS = [
  { value: 'day', label: 'Plan my day' },
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'snack', label: 'Snack' }
];

function MealPlanner({ onAdd }) {
  const [meal, setMeal] = useState('day');
  const [servings, setServings] = useState('2');
  const [preferences, setPreferences] = useState('');
  const [quickPreferences, setQuickPreferences] = useState([]);
  const [recentIdeas, setRecentIdeas] = useState([]);
  const [addedProducts, setAddedProducts] = useState(() => new Set());
  const [recommendations, setRecommendations] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const toggleQuickPreference = (preference) => {
    setQuickPreferences((current) => current.includes(preference)
      ? current.filter((value) => value !== preference)
      : [...current, preference]);
  };

  const addSuggestedProduct = async (product) => {
    if (!await onAdd(product)) return;
    setAddedProducts((current) => new Set(current).add(product._id));
    window.setTimeout(() => {
      setAddedProducts((current) => {
        const next = new Set(current);
        next.delete(product._id);
        return next;
      });
    }, 2200);
  };

  const generateIdeas = async (event) => {
    event?.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = await request('/api/v1/meals/recommendations', {
        method: 'POST',
        body: JSON.stringify({
          meal,
          servings: Number(servings),
          preferences: [quickPreferences.join(', '), preferences.trim()].filter(Boolean).join(', '),
          excludeIdeas: recentIdeas.slice(-9)
        })
      });
      setRecommendations(result);
      setRecentIdeas((current) => [...current, ...result.ideas.map((idea) => ({
        title: idea.title,
        productIds: idea.products.map((product) => product._id)
      }))].slice(-9));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  return <section className="meal-planner section-wrap" aria-labelledby="meal-planner-title">
    <div className="meal-planner-card">
      <div className="meal-planner-intro">
        <span className="meal-planner-mark" aria-hidden="true">✦</span>
        <p className="eyebrow">A LITTLE HELP WITH WHAT'S COOKING</p>
        <h2 id="meal-planner-title">Make something good today.</h2>
        <p>Tell Gemini what you’re planning. It’ll find meal ideas using food that’s actually in stock here.</p>
      </div>
      <form className="meal-planner-form" onSubmit={generateIdeas}>
        <fieldset className="meal-choice-group">
          <legend>What are you planning?</legend>
          <div className="meal-choice-list" role="group" aria-label="Meal time">
            {MEAL_PLANNER_OPTIONS.map((option) => <button
              key={option.value}
              type="button"
              className={`meal-choice${meal === option.value ? ' is-selected' : ''}`}
              aria-pressed={meal === option.value}
              onClick={() => setMeal(option.value)}
            >{option.label}</button>)}
          </div>
        </fieldset>
        <div className="meal-form-row">
          <div className="meal-servings">
            <label htmlFor="meal-servings"><span>People</span></label>
            <div className="servings-stepper">
              <button type="button" aria-label="Remove one person" disabled={Number(servings) <= 1} onClick={() => setServings(String(Math.max(1, (Number(servings) || 1) - 1)))}>−</button>
              <input id="meal-servings" type="number" min="1" max="8" step="1" value={servings} onChange={(event) => setServings(event.target.value)} required />
              <button type="button" aria-label="Add one person" disabled={Number(servings) >= 8} onClick={() => setServings(String(Math.min(8, (Number(servings) || 1) + 1)))}>+</button>
            </div>
          </div>
          <label className="meal-preferences">
            <span>Preferences <small>Optional</small></span>
            <input value={preferences} onChange={(event) => setPreferences(event.target.value)} maxLength="190" placeholder="e.g. mild spice, no peanuts" />
          </label>
        </div>
        <div className="meal-quick-picks" role="group" aria-label="Quick preferences">
          <span>Quick picks</span>
          {['Vegetarian', 'Quick & easy', 'Budget-friendly'].map((preference) => <button
            key={preference}
            type="button"
            className={`meal-quick-pick${quickPreferences.includes(preference) ? ' is-selected' : ''}`}
            aria-pressed={quickPreferences.includes(preference)}
            onClick={() => toggleQuickPreference(preference)}
          >{preference}</button>)}
        </div>
        <button className="button button-dark meal-submit" type="submit" disabled={loading}>
          {loading ? 'Finding ideas…' : recommendations ? 'Update my menu' : 'Find meal ideas'} <span aria-hidden="true">{loading ? '…' : '✦'}</span>
        </button>
        <p className="meal-planner-disclaimer">Your preferences and available food listings go to Gemini. Check product packaging for ingredients and allergens.</p>
        {loading && <p className="meal-status" role="status">Putting together your menu…</p>}
        {error && <p className="meal-error" role="alert">{error}</p>}
      </form>
    </div>
    {recommendations && <div className="meal-results">
      <div className="meal-results-heading">
        <div><p className="eyebrow">YOUR MEAL IDEAS</p><p>{recommendations.summary}</p></div>
        <button type="button" className="meal-refresh-button" onClick={() => generateIdeas()} disabled={loading}>
          <span aria-hidden="true">{loading ? '…' : '↻'}</span>{loading ? 'Finding another menu…' : 'Try a different menu'}
        </button>
      </div>
      {loading && <p className="meal-status meal-refresh-status" role="status">Keeping your current ideas here while we find something new…</p>}
      <div className={`meal-idea-grid${loading ? ' is-refreshing' : ''}`} aria-live="polite">
        {recommendations.ideas.map((idea, index) => <article className="meal-idea" key={`${idea.mealType}-${idea.title}`} style={{ '--idea-index': index }}>
          <span className="meal-type-label">{idea.mealType}</span>
          <h3>{idea.title}</h3>
          <p className="meal-idea-description">{idea.description}</p>
          <div className="meal-product-list">
            {idea.products.map((product) => <div className="meal-product" key={product._id}>
              <Link className="meal-product-image" to={`/products/${product._id}`} aria-label={`View ${product.name}`}>
                {product.images?.[0] ? <img src={product.images[0]} alt="" loading="lazy" /> : <span aria-hidden="true">✦</span>}
              </Link>
              <div className="meal-product-copy">
                <Link to={`/products/${product._id}`}>{product.name}</Link>
                <span>{NPR.format(product.price)} · {product.category}</span>
              </div>
              <button
                type="button"
                className={`meal-product-add${addedProducts.has(product._id) ? ' is-added' : ''}`}
                onClick={() => addSuggestedProduct(product)}
                aria-label={addedProducts.has(product._id) ? `Added ${product.name} to cart` : `Add ${product.name} to cart`}
              >{addedProducts.has(product._id) ? '✓' : '+'}</button>
            </div>)}
          </div>
        </article>)}
      </div>
    </div>}
  </section>;
}

function Home({ session }) {
  useDocumentTitle();
  const [params, setParams] = useSearchParams();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [categories, setCategories] = useState([]);
  const [provinces, setProvinces] = useState([]);
  const [pageCount, setPageCount] = useState(1);
  const [search, setSearch] = useState(params.get('search') || '');
  const [district, setDistrict] = useState(params.get('district') || '');
  const [municipality, setMunicipality] = useState(params.get('municipality') || '');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    request('/api/v1/products/locations')
      .then(({ provinces: rows = [] }) => setProvinces(rows))
      .catch((err) => setError(err.message));
    request('/api/v1/products/categories')
      .then(({ categories: rows = [] }) => setCategories(rows))
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    setSearch(params.get('search') || '');
    setDistrict(params.get('district') || '');
    setMunicipality(params.get('municipality') || '');
  }, [params]);

  useEffect(() => {
    setLoading(true);
    const query = new URLSearchParams(params);
    request(`/api/v1/products?${query}`)
      .then(({ products: rows = [], pages = 1 }) => {
        setProducts(rows);
        setPageCount(pages);
        setError('');
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [params]);

  const addToBag = async (product) => {
    if (!session.user) {
      window.location.assign('/login');
      return false;
    }
    try {
      await request('/api/v1/users/cart', { method: 'POST', body: JSON.stringify({ productId: product._id }) });
      session.setCartCount((count) => count + 1);
      setNotice(`${product.name} added to your bag.`);
      window.setTimeout(() => setNotice(''), 2600);
      return true;
    } catch (err) { setNotice(err.message); }
    return false;
  };

  const buyNow = async (product) => {
    if (!session.user) return window.location.assign('/login');
    try {
      await request('/api/v1/users/cart', { method: 'POST', body: JSON.stringify({ productId: product._id }) });
      session.setCartCount((count) => count + 1);
      window.location.assign('/checkout');
    } catch (err) {
      setNotice(err.message);
    }
  };

  const submitSearch = (event) => {
    event.preventDefault();
    const next = new URLSearchParams(params);
    if (search.trim()) next.set('search', search.trim()); else next.delete('search');
    if (district.trim()) next.set('district', district.trim()); else next.delete('district');
    if (municipality.trim()) next.set('municipality', municipality.trim()); else next.delete('municipality');
    next.set('page', '1');
    setParams(next);
  };

  const clearFilters = () => {
    setSearch('');
    setDistrict('');
    setMunicipality('');
    setParams(new URLSearchParams());
  };

  const selectCategory = (category) => {
    const next = new URLSearchParams(params);
    if (category) next.set('category', category);
    else next.delete('category');
    next.set('page', '1');
    setParams(next);
  };

  const activeFilters = [
    ['search', params.get('search') ? `Search: ${params.get('search')}` : ''],
    ['category', params.get('category') ? `Category: ${params.get('category')}` : ''],
    ['province', params.get('province') ? `Province: ${params.get('province')}` : ''],
    ['district', params.get('district') ? `District: ${params.get('district')}` : ''],
    ['municipality', params.get('municipality') ? `Municipality: ${params.get('municipality')}` : ''],
    ['maxPrice', params.get('maxPrice') ? `Up to ${NPR.format(Number(params.get('maxPrice')))}` : '']
  ].filter(([, label]) => label);

  const removeFilter = (key) => {
    const next = new URLSearchParams(params);
    next.delete(key);
    next.set('page', '1');
    setParams(next);
  };

  let catalogContent;
  if (loading) {
    catalogContent = <div className="loading-state" role="status">Finding the good stuff…</div>;
  } else if (error) {
    catalogContent = <div className="state-card"><h3>We couldn’t load the collection</h3><p>{error}</p><button className="button button-outline" onClick={() => setParams(new URLSearchParams(params))}>Try again</button></div>;
  } else if (products.length) {
    catalogContent = <>
      <div className="product-grid">{products.map((product) => <ProductCard key={product._id} product={product} onAdd={addToBag} onBuyNow={buyNow} />)}</div>
      <Pager
        page={Number(params.get('page')) || 1}
        pages={pageCount}
        onPage={(next) => { const nextParams = new URLSearchParams(params); nextParams.set('page', String(next)); setParams(nextParams); }}
        label="Product pages"
      />
    </>;
  } else {
    catalogContent = <div className="state-card"><h3>Nothing here just yet.</h3><p>Try another search or category to find your next favourite.</p><button className="button button-outline" onClick={() => { setSearch(''); setDistrict(''); setMunicipality(''); setParams(new URLSearchParams()); }}>Clear filters</button></div>;
  }

  return <main>
    <section className="hero">
      <div className="hero-copy"><p className="eyebrow">MADE IN NEPAL. FOUND BY YOU.</p><h1>Good things,<br /><em>close to home.</em></h1><p className="hero-description">Thoughtful finds from independent makers and trusted local sellers. Discover what Nepal makes best.</p><a className="button button-dark" href="#shop">Explore the collection <span aria-hidden="true">↘</span></a></div>
      <div className="hero-art" aria-label="Sajilo Pasal, easy market for grocery"><img className="hero-logo" src="/images/sajilo-pasal-logo.png" alt="Sajilo Pasal grocery cart logo" /><div className="hero-sticker"><span aria-hidden="true">✦</span><span><strong>Find your new favourite</strong><small>Shop the makers near you</small></span></div><div className="hero-art-caption"><span>MADE FOR NEPAL</span><span>SHOP LOCAL, LIVE BETTER</span></div></div>
      <div className="hero-side-note">A BETTER WAY TO SHOP, ONE LOCAL FIND AT A TIME</div>
    </section>
    <section className="trust-strip" aria-label="Why shop Sajilo Pasal">
      <div className="trust-item"><span className="trust-icon" aria-hidden="true">⌂</span><div><strong>Made close to home</strong><span>Discover Nepal-made goods</span></div></div>
      <div className="trust-item"><span className="trust-icon" aria-hidden="true">♡</span><div><strong>People-first shopping</strong><span>Support independent sellers</span></div></div>
      <div className="trust-item"><span className="trust-icon" aria-hidden="true">↗</span><div><strong>Easy from start to finish</strong><span>Browse, choose, and enjoy</span></div></div>
    </section>
    <MealPlanner onAdd={addToBag} />

    <section id="shop" className="catalog section-wrap">
      <div className="section-heading"><div><p className="eyebrow">THE COLLECTION</p><h2>Shop the good stuff.</h2></div><p className="muted">Considered essentials, made and sold by people who care.</p></div>
      {categories.length > 0 && <nav className="category-shortcuts" aria-label="Browse product categories">
        <button type="button" className={`category-shortcut${!params.get('category') ? ' is-selected' : ''}`} aria-pressed={!params.get('category')} onClick={() => selectCategory('')}>Everything</button>
        {categories.map((category) => <button key={category} type="button" className={`category-shortcut${params.get('category') === category ? ' is-selected' : ''}`} aria-pressed={params.get('category') === category} onClick={() => selectCategory(category)}>{category}</button>)}
      </nav>}
      <form className="catalog-toolbar" onSubmit={submitSearch}>
        <label className="search-control"><span className="visually-hidden">Search products</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products, makers, categories" /><button aria-label="Search">⌕</button></label>
        <label><span className="visually-hidden">Category</span><select aria-label="Filter by category" value={params.get('category') || ''} onChange={(event) => { const next = new URLSearchParams(params); event.target.value ? next.set('category', event.target.value) : next.delete('category'); next.set('page', '1'); setParams(next); }}><option value="">All categories</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
        <label><span className="visually-hidden">Sort products</span><select aria-label="Sort products" value={params.get('sort') || 'newest'} onChange={(event) => { const next = new URLSearchParams(params); next.set('sort', event.target.value); next.set('page', '1'); setParams(next); }}><option value="newest">Recently added</option><option value="priceLow">Price: low to high</option><option value="priceHigh">Price: high to low</option><option value="name">Name: A to Z</option></select></label>
        <label className="price-filter"><span className="visually-hidden">Maximum price in rupees</span><input type="number" min="0" value={params.get('maxPrice') || ''} placeholder="Max NPR" onChange={(event) => { const next = new URLSearchParams(params); event.target.value ? next.set('maxPrice', event.target.value) : next.delete('maxPrice'); next.set('page', '1'); setParams(next); }} /></label>
        <label><span className="visually-hidden">Filter by province</span><select aria-label="Filter by province" value={params.get('province') || ''} onChange={(event) => { const next = new URLSearchParams(params); event.target.value ? next.set('province', event.target.value) : next.delete('province'); next.set('page', '1'); setParams(next); }}><option value="">All Nepal</option>{provinces.map((province) => <option key={province} value={province}>{province}</option>)}</select></label>
        <label><span className="visually-hidden">District</span><input aria-label="District" value={district} onChange={(event) => setDistrict(event.target.value)} placeholder="District" /></label>
        <label><span className="visually-hidden">Municipality</span><input aria-label="Municipality" value={municipality} onChange={(event) => setMunicipality(event.target.value)} placeholder="Municipality" /></label>
        <button className="button button-outline" type="submit">Apply filters</button>
      </form>
      {activeFilters.length > 0 && <div className="active-filters" aria-label="Active filters">
        <span className="active-filters-label">Showing:</span>
        {activeFilters.map(([key, label]) => <button key={key} className="filter-chip" type="button" onClick={() => removeFilter(key)} aria-label={`Remove ${label} filter`}>
          {label}<span aria-hidden="true">×</span>
        </button>)}
        <button className="clear-filters" type="button" onClick={clearFilters}>Clear all</button>
      </div>}
      {notice && <p role="status" className="inline-notice">{notice}</p>}
      {catalogContent}
    </section>
  </main>;
}

function ProductDetail({ session }) {
  const { id } = useParams();
  const [product, setProduct] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [wishlisted, setWishlisted] = useState(false);
  useDocumentTitle(product?.name || 'Product');

  useEffect(() => {
    request(`/api/v1/products/${id}`).then(({ product: row }) => setProduct(row)).catch((err) => setError(err.message));
    if (session.user) {
      request('/api/v1/users/wishlist')
        .then(({ wishlist = [] }) => setWishlisted(wishlist.some((item) => String(item?._id || item) === String(id))))
        .catch(() => setWishlisted(false));
    }
  }, [id, session.user]);

  const addItem = async (path, body) => {
    if (!session.user) return window.location.assign('/login');
    try {
      const data = await request(path, { method: 'POST', body: JSON.stringify(body) });
      if (path.includes('cart')) session.setCartCount((count) => count + quantity);
      else setWishlisted(data.wishlist.some((item) => String(item) === String(id)));
      setNotice(path.includes('cart') ? 'Added to your bag.' : 'Wishlist updated.');
    } catch (err) { setNotice(err.message); }
  };

  const buyNow = async () => {
    if (!session.user) return window.location.assign('/login');
    try {
      await request('/api/v1/users/cart', {
        method: 'POST',
        body: JSON.stringify({ productId: product._id, quantity })
      });
      session.setCartCount((count) => count + quantity);
      window.location.assign('/checkout');
    } catch (err) {
      setNotice(err.message);
    }
  };

  if (error) return <main className="page-wrap"><div className="state-card"><h2>Product unavailable</h2><p>{error}</p><Link className="button button-outline" to="/">Back to shop</Link></div></main>;
  if (!product) return <main className="page-wrap"><div className="loading-state">Loading product…</div></main>;
  return <main className="page-wrap product-detail">
    <p className="breadcrumb"><Link to="/">Shop</Link> / {product.category}</p>
    <div className="detail-layout">
      <div className="detail-image">{product.images?.[0] ? <img src={product.images[0]} alt={product.name} /> : <div className="image-placeholder"><span>SAJILO</span></div>}</div>
      <section className="detail-copy"><p className="eyebrow">{product.category}</p><h1>{product.name}</h1><p className="detail-price">{NPR.format(product.price)}</p><p className="detail-description">{product.description}</p><p className="product-location">{[product.location?.municipality, product.location?.district, product.location?.province].filter(Boolean).join(', ')}</p><p className={`availability ${product.stock > 0 ? '' : 'unavailable'}`}>{product.stock > 0 ? `${product.stock} available` : 'Currently unavailable'}</p>
        <div className="purchase-row"><label className="qty-control">Quantity <input type="number" min="1" max={Math.min(product.stock || 1, 99)} value={quantity} onChange={(event) => setQuantity(Math.max(1, Math.min(product.stock || 1, 99, Number(event.target.value) || 1)))} /></label><button disabled={product.stock <= 0} className="button button-outline" onClick={() => addItem('/api/v1/users/cart', { productId: product._id, quantity })}>Add to cart</button><button disabled={product.stock <= 0} className="button button-dark" onClick={buyNow}>Buy now</button><button className="button button-outline" onClick={() => addItem(`/api/v1/users/wishlist/${product._id}`, {})}>{wishlisted ? 'Saved' : 'Save for later'}</button></div>
        {notice && <p role="status" className="inline-notice">{notice}</p>}
        <div className="seller-note"><span>SELLER</span><strong>{product.seller?.name || 'Independent seller'}</strong><p>Supporting local businesses across Nepal.</p></div>
      </section>
    </div>
  </main>;
}

function AuthPage({ mode, session }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(() => location.state?.notice || '');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState('form'); // 'form' | 'otp'
  const [regData, setRegData] = useState({ name: '', email: '', password: '', role: 'buyer' });
  const [otp, setOtp] = useState('');
  useDocumentTitle(mode === 'login' ? 'Log in' : 'Create account');

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setNotice('');

    try {
      if (mode === 'login') {
        const form = new FormData(event.currentTarget);
        const body = Object.fromEntries(form.entries());
        const data = await request('/api/v1/auth/login', { method: 'POST', body: JSON.stringify(body) });
        session.acceptAuth(data);
        navigate(data.user.role === 'seller' ? '/seller' : data.user.role === 'admin' ? '/admin' : '/');
      } else if (step === 'form') {
        const form = new FormData(event.currentTarget);
        const body = Object.fromEntries(form.entries());
        setRegData(body);
        const res = await request('/api/v1/auth/send-registration-otp', {
          method: 'POST',
          body: JSON.stringify({ name: body.name, email: body.email })
        });
        setStep('otp');
        setNotice(res.devOtp
          ? `${res.message} (development code: ${res.devOtp})`
          : res.message || `Verification code sent to ${body.email}. Please check your inbox.`);
      } else if (step === 'otp') {
        const fullBody = { ...regData, otp: otp.trim() };
        const data = await request('/api/v1/auth/register', {
          method: 'POST',
          body: JSON.stringify(fullBody)
        });
        session.acceptAuth(data);
        navigate(data.user.role === 'seller' ? '/seller' : data.user.role === 'admin' ? '/admin' : '/');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const resendOtp = async () => {
    setError('');
    setNotice('');
    setLoading(true);
    try {
      const res = await request('/api/v1/auth/send-registration-otp', {
        method: 'POST',
        body: JSON.stringify({ name: regData.name, email: regData.email })
      });
      setNotice(res.devOtp
        ? `${res.message} (development code: ${res.devOtp})`
        : res.message || `A new verification code was sent to ${regData.email}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return <main className="auth-page">
    <div className="auth-visual">
      <p className="eyebrow">SAJILO PASAL</p>
      <h1>Good finds.<br /><em>Good people.</em></h1>
      <p>Shop closer to home and meet the people behind what you buy.</p>
    </div>
    <section className="auth-panel">
      <Link to="/" className="back-link">← Back to the shop</Link>
      <p className="eyebrow">{mode === 'login' ? 'WELCOME BACK' : 'JOIN THE COMMUNITY'}</p>
      <h2>{mode === 'login' ? 'Come on in.' : step === 'otp' ? 'Verify your email.' : 'Create your account.'}</h2>
      <p className="muted">
        {mode === 'login'
          ? 'Sign in to pick up where you left off.'
          : step === 'otp'
          ? `Enter the 6-digit code sent to ${regData.email}`
          : 'Your next local favourite is just around the corner.'}
      </p>
      {mode === 'login' && (
        <p className="auth-guidance">
          New accounts need email verification before sign-in. If you haven’t finished signup, <Link to="/register">create your account</Link> and complete the verification-code step first.
        </p>
      )}

      {notice && <p className="success-message" role="status" style={{ marginBottom: 16 }}>{notice}</p>}
      {error && <p className="form-error" role="alert" style={{ marginBottom: 16 }}>{error}</p>}

      {mode === 'register' && step === 'otp' ? (
        <form onSubmit={submit} className="form-stack">
          <label className="field">
            <span>6-Digit Verification Code (OTP)</span>
            <input
              name="otp"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              placeholder="e.g. 123456"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              autoFocus
              required
              style={{ fontSize: 20, letterSpacing: 4, textAlign: 'center', fontWeight: 'bold' }}
            />
          </label>
          <button className="button button-dark full-width" disabled={loading || otp.trim().length !== 6}>
            {loading ? 'Verifying…' : 'Verify & Complete Registration'}
          </button>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, fontSize: 13 }}>
            <button type="button" className="button button-quiet" onClick={resendOtp} disabled={loading} style={{ padding: 0 }}>
              Resend verification code
            </button>
            <button type="button" className="button button-quiet" onClick={() => { setStep('form'); setError(''); }} disabled={loading} style={{ padding: 0 }}>
              ← Edit details
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={submit} className="form-stack">
          {mode === 'register' && <>
            <Field label="Your name" name="name" defaultValue={regData.name} autoComplete="name" required />
            <label className="field">
              <span>Account type</span>
              <select name="role" defaultValue={regData.role || 'buyer'}>
                <option value="buyer">Buyer</option>
                <option value="seller">Seller</option>
              </select>
            </label>
          </>}
          <Field label="Email address" name="email" type="email" defaultValue={regData.email} autoComplete="email" required />
          <PasswordField label="Password" name="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength="8" required />
          {mode === 'login' && <p className="auth-switch" style={{ marginTop: 0 }}><Link to="/forgot-password">Forgot your password?</Link></p>}
          <button className="button button-dark full-width" disabled={loading}>
            {loading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Continue & Send Verification Code'}
          </button>
        </form>
      )}

      <p className="auth-switch">
        {mode === 'login' ? 'New to Sajilo Pasal?' : 'Already have an account?'}
        {' '}
        <Link to={mode === 'login' ? '/register' : '/login'} onClick={() => { setStep('form'); setError(''); setNotice(''); }}>
          {mode === 'login' ? 'Create an account' : 'Sign in'}
        </Link>
      </p>
    </section>
  </main>;
}

function ForgotPassword() {
  const navigate = useNavigate();
  const [step, setStep] = useState('email'); // 'email' | 'reset'
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  useDocumentTitle('Reset password');

  const requestCode = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const value = String(values.email || '').trim();
    try {
      const res = await request('/api/v1/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email: value }) });
      setEmail(value);
      setStep('reset');
      setNotice(res.devOtp ? `${res.message} (development code: ${res.devOtp})` : res.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const submitReset = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await request('/api/v1/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ email, otp: otp.trim(), newPassword })
      });
      navigate('/login', { state: { notice: res.message || 'Your password was updated. Sign in with your new password.' } });
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return <main className="auth-page">
    <div className="auth-visual">
      <p className="eyebrow">SAJILO PASAL</p>
      <h1>Back in.<br /><em>Easily.</em></h1>
      <p>Reset your password with a code sent to your email.</p>
    </div>
    <section className="auth-panel">
      <Link to="/login" className="back-link">← Back to sign in</Link>
      <p className="eyebrow">ACCOUNT RECOVERY</p>
      <h2>{step === 'email' ? 'Forgot your password?' : 'Choose a new password.'}</h2>
      <p className="muted">
        {step === 'email'
          ? 'Enter the email on your account and we will send a reset code.'
          : `Enter the 6-digit code sent to ${email} and pick a new password.`}
      </p>

      {notice && <p className="success-message" role="status" style={{ marginBottom: 16 }}>{notice}</p>}
      {error && <p className="form-error" role="alert" style={{ marginBottom: 16 }}>{error}</p>}

      {step === 'email' ? (
        <form onSubmit={requestCode} className="form-stack">
          <Field label="Email address" name="email" type="email" autoComplete="email" required />
          <button className="button button-dark full-width" disabled={loading}>{loading ? 'Sending…' : 'Send reset code'}</button>
        </form>
      ) : (
        <form onSubmit={submitReset} className="form-stack">
          <label className="field">
            <span>Reset code</span>
            <input name="otp" type="text" inputMode="numeric" maxLength={6} placeholder="e.g. 123456" value={otp} onChange={(event) => setOtp(event.target.value)} required />
          </label>
          <PasswordField label="New password (at least 8 characters)" name="newPassword" minLength="8" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required />
          <button className="button button-dark full-width" disabled={loading || !otp.trim() || newPassword.length < 8}>{loading ? 'Updating…' : 'Update password'}</button>
          <button type="button" className="button button-quiet" disabled={loading} onClick={() => { setStep('email'); setError(''); setNotice(''); }}>← Use a different email</button>
        </form>
      )}
    </section>
  </main>;
}

function Field({ label, name, type = 'text', required = false, ...props }) {
  return <label className="field"><span>{label}</span><input name={name} type={type} required={required} {...props} /></label>;
}

function PasswordField({ label, name, ...props }) {
  const [visible, setVisible] = useState(false);

  return (
    <label className="field">
      <span>{label}</span>
      <span className="password-field-control">
        <input name={name} type={visible ? 'text' : 'password'} {...props} />
        <button
          type="button"
          className="password-visibility-toggle"
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </span>
    </label>
  );
}

function Protected({ session, roles, children }) {
  if (session.loading) return <main className="page-wrap"><div className="loading-state">Checking your account…</div></main>;
  if (session.sessionError) return <main className="page-wrap"><div className="state-card"><h2>Unable to verify your session</h2><p>{session.sessionError}</p><button className="button button-outline" onClick={() => window.location.reload()}>Try again</button></div></main>;
  if (!session.user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(session.user.role)) return <main className="page-wrap"><div className="state-card"><h2>Not available for this account</h2><p>This area requires a different account role.</p><Link to="/" className="button button-outline">Return to shop</Link></div></main>;
  return children;
}

function QuantityInput({ value, max, onCommit, label }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  const commit = () => {
    const parsed = Number.parseInt(draft, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.max(1, Math.min(parsed, max));
    setDraft(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };
  return <input
    type="number"
    min="1"
    max={max}
    value={draft}
    aria-label={label}
    onChange={(event) => setDraft(event.target.value)}
    onBlur={commit}
    onKeyDown={(event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commit();
      }
    }}
  />;
}

function Cart({ session }) {
  const [cart, setCart] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const total = useMemo(() => cart.reduce((sum, item) => sum + (item.product?.price || 0) * item.quantity, 0), [cart]);
  useDocumentTitle('Your bag');

  const refresh = async () => {
    try {
      const { cart: rows = [] } = await request('/api/v1/users/cart');
      setCart(rows);
      setError('');
      session.setCartCount(rows.reduce((sum, item) => sum + item.quantity, 0));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void refresh(); }, []);

  const update = async (id, quantity) => {
    try {
      if (quantity < 1) await request(`/api/v1/users/cart/${id}`, { method: 'DELETE' });
      else await request(`/api/v1/users/cart/${id}`, { method: 'PUT', body: JSON.stringify({ quantity }) });
      await refresh();
    } catch (err) { setError(err.message); }
  };
  if (loading) return <main className="page-wrap"><div className="loading-state">Loading your bag…</div></main>;
  return <main className="page-wrap"><p className="eyebrow">YOUR BAG</p><h1 className="page-title">A good choice.</h1>{error && <p className="form-error">{error}</p>}{cart.length ? <div className="cart-layout"><div className="cart-list">{cart.map(({ product, quantity }) => product && <article className="cart-item" key={product._id}><Link to={`/products/${product._id}`} className="cart-thumbnail">{product.images?.[0] ? <img src={product.images[0]} alt="" /> : 'SAJILO'}</Link><div className="cart-item-info"><Link to={`/products/${product._id}`}><strong>{product.name}</strong></Link><span>{NPR.format(product.price)}</span><span className={product.stock < quantity ? 'form-error' : 'muted'}>{product.stock < quantity ? 'Please adjust quantity; stock changed.' : `${product.stock} available`}</span></div><label className="cart-quantity"><span className="visually-hidden">Quantity for {product.name}</span><QuantityInput value={quantity} max={Math.min(product.stock || 1, 99)} label={`Quantity for ${product.name}`} onCommit={(next) => update(product._id, next)} /></label><button className="remove-button" onClick={() => update(product._id, 0)}>Remove</button></article>)}</div><aside className="summary-box"><h2>Order summary</h2><div><span>Subtotal</span><strong>{NPR.format(total)}</strong></div><div><span>Shipping</span><span>Calculated at checkout</span></div><Link className="button button-dark full-width" to="/checkout">Continue to checkout</Link><Link to="/" className="text-link">Keep exploring</Link></aside></div> : <div className="state-card"><h2>Your bag is taking a breather.</h2><p>Find something made with care and bring it home.</p><Link to="/" className="button button-dark">Explore the collection</Link></div>}</main>;
}

function Checkout() {
  const [cart, setCart] = useState([]);
  const [paymentMethod, setPaymentMethod] = useState('cash_on_delivery');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [provinces, setProvinces] = useState([]);
  // One key per checkout page visit; retries reuse it so the server can
  // reject duplicate submissions of the same checkout.
  const checkoutKey = useRef(createCheckoutKey());
  useDocumentTitle('Checkout');
  useEffect(() => {
    request('/api/v1/users/cart').then(({ cart: rows = [] }) => setCart(rows.filter((item) => item.product))).catch((err) => setError(err.message));
    request('/api/v1/products/locations').then(({ provinces: rows = [] }) => setProvinces(rows)).catch((err) => setError(err.message));
  }, []);
  const subtotal = cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  const sellers = [...new Map(cart.map(({ product }) => [
    String(product.seller?._id || product.seller),
    { id: String(product.seller?._id || product.seller), name: product.seller?.name || 'Local seller' }
  ])).values()];
  const canPayEverySellerOnline = cart.length > 0 && cart.every(({ product }) => (
    Boolean(product.seller?.paymentSettings?.esewa?.merchantCode)
  ));
  useEffect(() => {
    if (!canPayEverySellerOnline && paymentMethod === 'esewa') {
      setPaymentMethod('cash_on_delivery');
    }
  }, [canPayEverySellerOnline, paymentMethod]);
  const sellerTotals = sellers.map((seller) => {
    const sellerSubtotal = cart.reduce((sum, item) => (
      String(item.product.seller?._id || item.product.seller) === seller.id
        ? sum + item.product.price * item.quantity
        : sum
    ), 0);
    const shippingCost = sellerSubtotal >= 5000 ? 0 : 200;
    return { ...seller, subtotal: sellerSubtotal, shippingCost, total: sellerSubtotal + shippingCost };
  });
  const checkoutTotal = sellerTotals.reduce((sum, seller) => sum + seller.total, 0);

  const checkout = async (event) => {
    event.preventDefault();
    setLoading(true); setError('');
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const { checkoutId } = await request('/api/v1/orders', { method: 'POST', body: JSON.stringify({ items: cart.map(({ product, quantity }) => ({ productId: product._id, quantity })), shippingAddress: values, paymentMethod, checkoutId: checkoutKey.current }) });
      window.location.assign(`/checkout/payments?checkoutId=${checkoutId}&status=${paymentMethod === 'esewa' ? 'ready' : 'created'}`);
    } catch (err) { setError(err.message); setLoading(false); }
  };

  if (!cart.length) return <main className="page-wrap"><div className="state-card"><h2>Your bag is empty</h2><Link to="/" className="button button-dark">Return to shop</Link></div></main>;
  return <main className="page-wrap"><p className="eyebrow">CHECKOUT</p><h1 className="page-title">Let’s get it to you.</h1><div className="checkout-layout"><form className="checkout-form" onSubmit={checkout}><h2>Delivery details</h2><div className="field-grid"><Field label="Full name" name="fullName" required autoComplete="name" /><Field label="Phone number" name="phone" required type="tel" autoComplete="tel" /><Field label="Address line 1" name="addressLine1" required autoComplete="address-line1" /><Field label="Address line 2 (optional)" name="addressLine2" autoComplete="address-line2" /><Field label="City / municipality" name="city" required autoComplete="address-level2" /><label className="field"><span>Province</span><select name="state" defaultValue="" required autoComplete="address-level1"><option value="" disabled>Select province</option>{provinces.map((province) => <option key={province} value={province}>{province}</option>)}</select></label><label className="field"><span>Country</span><select name="country" defaultValue="Nepal" required><option value="Nepal">Nepal</option></select></label></div><h2 className="payment-heading">Payment method</h2><label className="payment-choice"><input type="radio" name="payment" disabled={!canPayEverySellerOnline} checked={paymentMethod === 'esewa'} onChange={() => setPaymentMethod('esewa')} /><span><strong>eSewa</strong><small>{canPayEverySellerOnline ? 'Pay each seller directly to their connected merchant account' : 'Available when every seller connects eSewa'}</small></span><span className="payment-badge">ONLINE</span></label><label className="payment-choice"><input type="radio" name="payment" checked={paymentMethod === 'cash_on_delivery'} onChange={() => setPaymentMethod('cash_on_delivery')} /><span><strong>Cash on delivery to this address</strong><small>Pay in cash when your order arrives at the Nepal delivery address above.</small></span></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-dark full-width" disabled={loading}>{loading ? 'Placing your orders…' : paymentMethod === 'esewa' ? 'Continue to seller payments' : 'Place orders'}</button></form><aside className="summary-box"><h2>Orders by seller</h2>{cart.map(({ product, quantity }) => <div className="summary-product" key={product._id}><span>{product.name} × {quantity}</span><strong>{NPR.format(product.price * quantity)}</strong></div>)}{sellerTotals.map((seller) => <div key={seller.id}><span>{seller.name} · delivery</span><strong>{seller.shippingCost === 0 ? 'Free' : NPR.format(seller.shippingCost)}</strong></div>)}<div className="summary-total"><span>Total across sellers</span><strong>{NPR.format(checkoutTotal)}</strong></div><p className="muted small-copy">Each seller receives a separate order and payment. Delivery is calculated per seller; totals are verified securely when placing orders.</p></aside></div></main>;
}

function CheckoutPayments() {
  const [params] = useSearchParams();
  const checkoutId = params.get('checkoutId');
  const callbackStatus = params.get('status');
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [payingOrderId, setPayingOrderId] = useState('');
  useDocumentTitle('Seller payments');
  const load = () => {
    if (!checkoutId) {
      setError('Checkout ID is missing');
      setLoading(false);
      return;
    }
    request(`/api/v1/orders/checkout/${checkoutId}`)
      .then(({ orders: rows = [] }) => { setOrders(rows); setError(''); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [checkoutId]);

  const startPayment = async (orderId) => {
    setPayingOrderId(orderId);
    setError('');
    try {
      const payment = await request('/api/v1/payments/esewa/initiate', {
        method: 'POST',
        body: JSON.stringify({ orderId })
      });
      submitPaymentForm(payment);
    } catch (err) {
      setError(err.message);
      setPayingOrderId('');
    }
  };

  if (loading) return <main className="page-wrap"><div className="loading-state">Loading seller orders…</div></main>;
  const isCash = orders[0]?.paymentMethod === 'cash_on_delivery';
  const allPaid = orders.length > 0 && orders.every((order) => order.paymentStatus === 'PAID');
  const nextPayment = orders.find((order) => order.canPay);
  const paymentInProgress = orders.some((order) => order.paymentStarted && order.paymentStatus === 'PENDING');
  return <main className="page-wrap narrow-page result-page">
    <p className="eyebrow">{isCash ? 'ORDERS CONFIRMED' : allPaid ? 'ALL SELLERS PAID' : 'PAY EACH SELLER'}</p>
    <h1 className="page-title">{isCash ? 'Your local orders are placed.' : allPaid ? 'Your orders are confirmed.' : 'Complete your seller payments.'}</h1>
    <p className="muted">{isCash ? 'Each seller will fulfill a separate cash-on-delivery order.' : allPaid ? 'Every seller payment has been verified.' : 'Each seller receives their payment directly. Pay one seller at a time; you will return here after each eSewa payment.'}</p>
    {callbackStatus === 'pending' && <p role="status" className="inline-notice">That payment is not confirmed yet. Check the order status below before continuing.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="seller-payment-list">{orders.map((order) => <article className="seller-payment-row" key={order._id}>
      <div><strong>{order.sellerName}</strong><span>{NPR.format(order.total)} · {order.paymentStatus}</span></div>
      <span className={`status-pill status-${order.orderStatus.toLowerCase()}`}>{order.orderStatus}</span>
      {order.canPay && <button className="button button-dark" disabled={Boolean(payingOrderId) || paymentInProgress} onClick={() => startPayment(order._id)}>{payingOrderId === order._id ? 'Connecting…' : 'Pay via eSewa'}</button>}
    </article>)}</div>
    {paymentInProgress && <p className="muted small-copy">A seller payment is still pending verification. Refresh this page after returning from eSewa.</p>}
    <div className="result-actions"><button className="button button-outline" onClick={() => { setLoading(true); load(); }}>Refresh payment status</button><Link className="button button-dark" to="/orders">View my orders</Link></div>
    {!isCash && !allPaid && !nextPayment && !paymentInProgress && <p className="muted small-copy">Any unpaid order may have expired. Visit your orders to see its status and place a new order if needed.</p>}
  </main>;
}

function Orders() {
  const [orders, setOrders] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  useDocumentTitle('My orders');
  useEffect(() => {
    request(`/api/v1/orders/my-orders?page=${page}`)
      .then((data) => { setOrders(data.orders || []); setPages(data.pages || 1); setTotal(data.total || 0); })
      .catch((err) => setError(err.message));
  }, [page]);
  return <main className="page-wrap"><p className="eyebrow">YOUR HISTORY</p><h1 className="page-title">Orders.</h1>{error && <p className="form-error">{error}</p>}{total ? <><div className="order-list">{orders.map((order) => <Link to={`/orders/${order._id}`} className="order-row" key={order._id}><div><span className="eyebrow">ORDER PLACED</span><strong>{new Date(order.createdAt).toLocaleDateString()}</strong><span>{order.items.length} items · {NPR.format(order.total)}</span></div><span className={`status-pill status-${order.orderStatus.toLowerCase()}`}>{order.orderStatus}</span><span className="payment-state">{order.paymentStatus}</span><span aria-hidden="true">→</span></Link>)}</div><Pager page={page} pages={pages} onPage={setPage} label="Order pages" /></> : <div className="state-card"><h2>No orders yet.</h2><p>Your next great local find is waiting.</p><Link to="/" className="button button-dark">Explore products</Link></div>}</main>;
}

function OrderDetail() {
  const { id } = useParams();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  useDocumentTitle('Order details');
  useEffect(() => { request(`/api/v1/orders/${id}`).then(({ order: row }) => setOrder(row)).catch((err) => setError(err.message)); }, [id]);
  if (error) return <main className="page-wrap"><div className="state-card"><h2>Order not found</h2><p>{error}</p></div></main>;
  if (!order) return <main className="page-wrap"><div className="loading-state">Loading order…</div></main>;
  return <main className="page-wrap"><p className="eyebrow"><Link to="/orders">YOUR ORDERS</Link></p><h1 className="page-title">Order details</h1><div className="order-detail-header"><span>#{order._id}</span><span className={`status-pill status-${order.orderStatus.toLowerCase()}`}>{order.orderStatus}</span><span>Payment: {order.paymentStatus}</span></div><div className="order-items">{order.items.map((item) => <div className="cart-item" key={item._id}><div className="cart-thumbnail">{item.product?.images?.[0] ? <img src={item.product.images[0]} alt="" /> : 'SAJILO'}</div><div className="cart-item-info"><strong>{item.productName}</strong><span>{item.quantity} × {NPR.format(item.price)}</span></div><strong>{NPR.format(item.subtotal)}</strong></div>)}</div><div className="order-total-line"><span>Total paid / due</span><strong>{NPR.format(order.total)}</strong></div><section className="address-card"><h2>Delivery address</h2><p>{order.shippingAddress.fullName} · {order.shippingAddress.phone}<br />{order.shippingAddress.addressLine1}, {order.shippingAddress.city}, {order.shippingAddress.state}, {order.shippingAddress.country}</p></section></main>;
}

function Profile({ session }) {
  const navigate = useNavigate();
  const [user, setUser] = useState(session.user);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useDocumentTitle('Your profile');
  const save = async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const data = await request('/api/v1/users/profile', { method: 'PUT', body: JSON.stringify(values) });
      setUser(data.user);
      session.setUser(data.user);
      localStorage.setItem('sajilo-user', JSON.stringify(data.user));
      setMessage('Your details are up to date.');
      setError('');
    } catch (err) { setError(err.message); }
  };
  const switchRole = async () => {
    const role = user.role === 'seller' ? 'buyer' : 'seller';
    setError('');
    setMessage('');
    try {
      const data = await request('/api/v1/users/role', { method: 'PATCH', body: JSON.stringify({ role }) });
      setUser(data.user);
      session.setUser(data.user);
      localStorage.setItem('sajilo-user', JSON.stringify(data.user));
      setMessage(`You are now in ${role} mode. ${role === 'buyer' ? 'Your listings are hidden until you switch back to seller mode.' : 'Your listings are visible again.'}`);
      navigate(role === 'seller' ? '/seller' : '/profile');
    } catch (err) { setError(err.message); }
  };
  return <main className="page-wrap narrow-page"><p className="eyebrow">ACCOUNT</p><h1 className="page-title">Your profile.</h1><p className="muted">Manage your details and how we reach you.</p><form onSubmit={save} className="form-stack profile-form"><Field label="Full name" name="name" defaultValue={user.name} required /><Field label="Email address" name="email" type="email" defaultValue={user.email} required /><Field label="Phone number" name="phone" type="tel" defaultValue={user.phone || ''} /><Field label="Address" name="address" defaultValue={user.address || ''} />{message && <p className="success-message" role="status">{message}</p>}{error && <p className="form-error">{error}</p>}<button className="button button-dark">Save details</button></form>{user.role !== 'admin' && <section className="role-switch"><h2>Account mode</h2><p className="muted">{user.role === 'seller' ? 'Switch to buyer mode to hide your products and shop local. Open seller orders must be completed first.' : 'Switch to seller mode to manage your listings and sell local products.'}</p><button className="button button-outline" onClick={switchRole}>Switch to {user.role === 'seller' ? 'buyer' : 'seller'} mode</button></section>}<div className="profile-links"><Link to="/orders">View your orders →</Link><Link to="/wishlist">Your saved items →</Link></div></main>;
}

function Wishlist({ session }) {
  const [items, setItems] = useState([]);
  const [notice, setNotice] = useState('');
  useDocumentTitle('Saved items');
  const reload = async () => {
    const { wishlist = [] } = await request('/api/v1/users/wishlist');
    setItems(wishlist);
  };
  useEffect(() => { reload().catch(() => setItems([])); }, []);
  const remove = async (id) => {
    try {
      await request(`/api/v1/users/wishlist/${id}`, { method: 'POST', body: JSON.stringify({}) });
      await reload();
    } catch (err) { setNotice(err.message); }
  };
  const addToCart = async (product, goToCheckout = false) => {
    try {
      await request('/api/v1/users/cart', { method: 'POST', body: JSON.stringify({ productId: product._id }) });
      session.setCartCount((count) => count + 1);
      if (goToCheckout) window.location.assign('/checkout');
      else setNotice(`${product.name} added to your bag.`);
    } catch (err) { setNotice(err.message); }
  };
  return <main className="page-wrap"><p className="eyebrow">YOUR SAVED FINDS</p><h1 className="page-title">Wishlist.</h1>{notice && <p role="status" className="inline-notice">{notice}</p>}{items.length ? <div className="product-grid">{items.map((product) => <ProductCard key={product._id} product={product} onRemove={remove} onAdd={(item) => addToCart(item)} onBuyNow={(item) => addToCart(item, true)} />)}</div> : <div className="state-card"><h2>Keep your favourites close.</h2><Link to="/" className="button button-dark">Explore the collection</Link></div>}</main>;
}

function SellerDashboard() {
  const [products, setProducts] = useState([]);
  const [productPage, setProductPage] = useState(1);
  const [productPages, setProductPages] = useState(1);
  const [activeProducts, setActiveProducts] = useState(0);
  const [orders, setOrders] = useState([]);
  const [orderPage, setOrderPage] = useState(1);
  const [orderPages, setOrderPages] = useState(1);
  const [orderTotal, setOrderTotal] = useState(0);
  const [salesTotal, setSalesTotal] = useState(0);
  const [categories, setCategories] = useState([]);
  const [provinces, setProvinces] = useState([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [imageUrl, setImageUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [esewaSettings, setEsewaSettings] = useState({ connected: false, phoneNumber: '', merchantCode: '' });
  const [esewaSecret, setEsewaSecret] = useState('');
  const [paymentMessage, setPaymentMessage] = useState('');
  useDocumentTitle('Seller studio');

  const loadProducts = (page) => request(`/api/v1/products/seller/my-products?page=${page}`).then((data) => {
    setProducts(data.products || []);
    setProductPages(data.pages || 1);
    setActiveProducts(data.activeCount || 0);
  });
  const loadOrders = (page) => request(`/api/v1/orders/seller?page=${page}`).then((data) => {
    setOrders(data.orders || []);
    setOrderPages(data.pages || 1);
    setOrderTotal(data.total || 0);
    setSalesTotal(data.salesTotal || 0);
  });

  useEffect(() => { loadProducts(productPage).catch((err) => setError(err.message)); }, [productPage]);
  useEffect(() => { loadOrders(orderPage).catch((err) => setError(err.message)); }, [orderPage]);
  useEffect(() => {
    request('/api/v1/products/categories').then(({ categories: rows = [] }) => setCategories(rows)).catch((err) => setError(err.message));
    request('/api/v1/products/locations').then(({ provinces: rows = [] }) => setProvinces(rows)).catch((err) => setError(err.message));
    request('/api/v1/payments/seller/esewa').then(setEsewaSettings).catch((err) => setError(err.message));
  }, []);

  const saveEsewaConnection = async (event) => {
    event.preventDefault();
    setError('');
    setPaymentMessage('');
    try {
      const result = await request('/api/v1/payments/seller/esewa', {
        method: 'PUT',
        body: JSON.stringify({
          phoneNumber: event.currentTarget.elements.phoneNumber.value,
          merchantCode: event.currentTarget.elements.merchantCode.value,
          merchantSecret: esewaSecret
        })
      });
      setEsewaSettings(result);
      setEsewaSecret('');
      setPaymentMessage('eSewa merchant account connected. A live payment test is needed to confirm the details.');
    } catch (err) {
      setError(err.message);
    }
  };

  const disconnectEsewa = async () => {
    setError('');
    setPaymentMessage('');
    try {
      const result = await request('/api/v1/payments/seller/esewa', { method: 'DELETE' });
      setEsewaSettings(result);
      setEsewaSecret('');
      setPaymentMessage(result.message);
    } catch (err) {
      setError(err.message);
    }
  };

  const saveProduct = async (event) => {
    event.preventDefault();
    const raw = Object.fromEntries(new FormData(event.currentTarget).entries());
    const body = {
      ...raw,
      price: Number(raw.price),
      stock: Number(raw.stock),
      location: {
        province: raw.province,
        district: raw.district,
        municipality: raw.municipality,
        ward: raw.ward
      },
      images: imageUrl ? [imageUrl] : []
    };

    try {
      await request(editing ? `/api/v1/products/${editing._id}` : '/api/v1/products', {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify(body)
      });
      setEditing(null);
      setImageUrl('');
      await loadProducts(productPage);
    } catch (err) {
      setError(err.message);
    }
  };

  const uploadImage = async (file) => {
    if (!file) return;
    const body = new FormData();
    body.append('image', file);
    setUploading(true);
    setError('');
    try {
      const { image } = await request('/api/v1/products/images', { method: 'POST', body });
      setImageUrl(image.url);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const updateFulfillment = async (orderId, itemId, fulfillmentStatus) => {
    try {
      await request(`/api/v1/orders/${orderId}/items/${itemId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ fulfillmentStatus })
      });
      await loadOrders(orderPage);
    } catch (err) {
      setError(err.message);
    }
  };

  return <main className="dashboard page-wrap">
    <div className="dashboard-heading"><div><p className="eyebrow">SELLER STUDIO</p><h1 className="page-title">Your business, at a glance.</h1></div><a href="#product-form" className="button button-dark">Add a product</a></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="stat-grid"><Stat label="Active products" value={activeProducts} /><Stat label="Orders" value={orderTotal} /><Stat label="Paid sales" value={NPR.format(salesTotal)} /></div>
    <section className="dashboard-section payment-connection">
      <h2>Seller payment account</h2>
      <p className="muted">Add your eSewa number and merchant code. Automatic checkout also needs the API secret issued by eSewa for your merchant account; it is encrypted before storage and is never shown again.</p>
      <details className="esewa-setup-help">
        <summary>Where do I get the merchant API secret?</summary>
        <ol>
          <li>Register or upgrade your eSewa account for merchant payments.</li>
          <li>Ask eSewa merchant support to enable ePay V2 and provide your merchant code and API secret.</li>
          <li>Enter the credentials supplied for the merchant integration here. Do not use your eSewa login password or PIN.</li>
        </ol>
        <p>Only enter a new API secret when first connecting or rotating credentials. It can be left blank when updating the number or merchant code.</p>
      </details>
      {esewaSettings.connected && <p className="connected-badge" role="status">Connected · {esewaSettings.phoneNumber} · merchant {esewaSettings.merchantCode}</p>}
      <form key={esewaSettings.connected ? 'connected' : 'new'} onSubmit={saveEsewaConnection} className="payment-connect-form">
        <Field label="eSewa mobile number" name="phoneNumber" type="tel" defaultValue={esewaSettings.phoneNumber} placeholder="98XXXXXXXX" required maxLength="16" autoComplete="tel" />
        <Field label="eSewa merchant code" name="merchantCode" defaultValue={esewaSettings.merchantCode} required maxLength="80" autoComplete="off" />
        <Field label={esewaSettings.connected ? 'New merchant API secret (optional)' : 'Merchant API secret from eSewa'} name="merchantSecret" type="password" value={esewaSecret} onChange={(event) => setEsewaSecret(event.target.value)} required={!esewaSettings.connected} minLength="8" maxLength="256" autoComplete="new-password" />
        <div className="form-actions"><button className="button button-dark">{esewaSettings.connected ? 'Update eSewa connection' : 'Connect eSewa'}</button>{esewaSettings.connected && <button type="button" className="button button-outline" onClick={disconnectEsewa}>Disconnect</button>}</div>
      </form>
      {paymentMessage && <p className="success-message" role="status">{paymentMessage}</p>}
    </section>
    <section className="dashboard-section" id="product-form">
      <h2>{editing ? 'Edit product' : 'List a product'}</h2>
      <form key={editing?._id || 'new-product'} onSubmit={saveProduct} className="seller-product-form">
        <Field label="Product name" name="name" defaultValue={editing?.name || ''} required />
        <Field label="Category" name="category" list="seller-categories" defaultValue={editing?.category || ''} required />
        <datalist id="seller-categories">{categories.map((category) => <option key={category} value={category} />)}</datalist>
        <Field label="Price (NPR)" name="price" type="number" min="0" step="1" defaultValue={editing?.price || ''} required />
        <Field label="Stock" name="stock" type="number" min="0" step="1" defaultValue={editing?.stock ?? ''} required />
        <label className="field"><span>Province</span><select name="province" defaultValue={editing?.location?.province || ''} required><option value="" disabled>Select province</option>{provinces.map((province) => <option key={province} value={province}>{province}</option>)}</select></label>
        <Field label="District" name="district" defaultValue={editing?.location?.district || ''} required maxLength="80" />
        <Field label="Municipality" name="municipality" defaultValue={editing?.location?.municipality || ''} required maxLength="100" />
        <Field label="Ward (optional)" name="ward" defaultValue={editing?.location?.ward || ''} maxLength="20" />
        <label className="field"><span>Upload product image</span><input type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={(event) => uploadImage(event.target.files?.[0])} /><small className="muted">{uploading ? 'Uploading…' : 'JPEG, PNG, WebP or AVIF · up to 5 MB'}</small></label>
        <label className="field"><span>Or provide an image URL</span><input name="image" type="url" value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} /></label>
        <label className="field wide-field"><span>Description</span><textarea name="description" rows="3" defaultValue={editing?.description || ''} required /></label>
        <div className="form-actions"><button className="button button-dark" disabled={uploading}>{editing ? 'Save changes' : 'Publish product'}</button>{editing && <button type="button" className="button button-outline" onClick={() => { setEditing(null); setImageUrl(''); }}>Cancel</button>}</div>
      </form>
    </section>
    <section className="dashboard-section">
      <h2>Your products</h2>
      {products.length ? <><div className="table-wrap"><table><thead><tr><th>Product</th><th>Price</th><th>Stock</th><th>Status</th><th>Actions</th></tr></thead><tbody>{products.map((product) => <tr key={product._id}><td>{product.name}</td><td>{NPR.format(product.price)}</td><td>{product.stock}</td><td>{product.isActive ? 'Active' : 'Hidden'}</td><td className="table-actions"><button onClick={() => { setEditing(product); setImageUrl(product.images?.[0] || ''); document.getElementById('product-form').scrollIntoView({ behavior: 'smooth' }); }}>Edit</button><button onClick={async () => { try { await request(`/api/v1/products/${product._id}`, { method: 'DELETE' }); await loadProducts(productPage); } catch (err) { setError(err.message); } }}>Remove</button></td></tr>)}</tbody></table></div><Pager page={productPage} pages={productPages} onPage={setProductPage} label="Product pages" /></> : <p className="muted">Your first listing starts here.</p>}
    </section>
    <section className="dashboard-section">
      <h2>Orders containing your products</h2>
      {orders.length ? <div className="order-list">
        {orders.map((order) => {
          const buyerName = order.shippingAddress?.fullName || order.buyer?.name || 'Customer';
          const buyerPhone = order.shippingAddress?.phone || order.buyer?.phone || '';
          const buyerEmail = order.buyer?.email || '';
          const fullAddress = [
            order.shippingAddress?.addressLine1,
            order.shippingAddress?.addressLine2,
            order.shippingAddress?.city,
            order.shippingAddress?.state,
            order.shippingAddress?.country || 'Nepal'
          ].filter(Boolean).join(', ');
          const paymentMethodText = order.paymentMethod === 'esewa' ? 'eSewa' : 'Cash on Delivery';
          const orderDate = order.createdAt ? new Date(order.createdAt).toLocaleString() : '';

          return (
            <div className="seller-order-card" key={order._id}>
              <div className="seller-order-header">
                <div>
                  <span className="order-badge">#{order._id.slice(-8).toUpperCase()}</span>
                  <span className="order-date-text">{orderDate}</span>
                </div>
                <div className="order-badges-row">
                  <span className={`status-pill status-${(order.orderStatus || '').toLowerCase()}`}>{order.orderStatus}</span>
                  <span className={`payment-pill payment-${(order.paymentStatus || '').toLowerCase()}`}>
                    {order.paymentStatus} ({paymentMethodText})
                  </span>
                </div>
              </div>

              {/* Customer & Shipping Information */}
              <div className="seller-customer-box">
                <h4>Customer & Shipping Information</h4>
                <div className="customer-info-grid">
                  <div>
                    <strong>Customer:</strong> <span>{buyerName}</span>
                  </div>
                  {buyerPhone && (
                    <div>
                      <strong>Phone:</strong> <a href={`tel:${buyerPhone}`}>{buyerPhone}</a>
                    </div>
                  )}
                  {buyerEmail && (
                    <div>
                      <strong>Email:</strong> <a href={`mailto:${buyerEmail}`}>{buyerEmail}</a>
                    </div>
                  )}
                  <div className="full-width-info">
                    <strong>Delivery Address:</strong> <span>{fullAddress}</span>
                  </div>
                </div>
              </div>

              {/* Items Table for this Seller */}
              <div className="seller-items-section">
                <h4>Ordered Items</h4>
                <div className="table-wrap">
                  <table className="seller-order-table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Qty</th>
                        <th>Unit Price</th>
                        <th>Subtotal</th>
                        <th>Fulfillment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {order.items.map((item) => (
                        <tr key={item._id}>
                          <td><strong>{item.productName}</strong></td>
                          <td>{item.quantity}</td>
                          <td>{NPR.format(item.price)}</td>
                          <td><strong>{NPR.format(item.subtotal)}</strong></td>
                          <td>
                            <select
                              aria-label={`Fulfillment status for ${item.productName}`}
                              className="fulfillment-select"
                              value={item.fulfillmentStatus || 'PENDING'}
                              onChange={(event) => updateFulfillment(order._id, item._id, event.target.value)}
                            >
                              <option value="PENDING">PENDING</option>
                              <option value="PROCESSING">PROCESSING</option>
                              <option value="SHIPPED">SHIPPED</option>
                              <option value="DELIVERED">DELIVERED</option>
                              <option value="CANCELLED">CANCELLED</option>
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Order Footer Totals */}
              <div className="seller-order-footer">
                <span className="seller-subtotal-text">
                  Your Subtotal: <strong>{NPR.format(order.sellerSubtotal || order.items.reduce((s, i) => s + i.subtotal, 0))}</strong>
                </span>
              </div>
            </div>
          );
        })}
      </div> : <p className="muted">New orders will appear here.</p>}
      <Pager page={orderPage} pages={orderPages} onPage={setOrderPage} label="Seller order pages" />
    </section>
  </main>;
}

function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [userPage, setUserPage] = useState(1);
  const [userPages, setUserPages] = useState(1);
  const [orders, setOrders] = useState([]);
  const [orderPage, setOrderPage] = useState(1);
  const [orderPages, setOrderPages] = useState(1);
  const [error, setError] = useState('');
  useDocumentTitle('Admin');
  const loadUsers = (page) => request(`/api/v1/admin/users?page=${page}`).then((data) => { setUsers(data.users || []); setUserPages(data.pages || 1); });
  const loadOrders = (page) => request(`/api/v1/admin/orders?page=${page}`).then((data) => { setOrders(data.orders || []); setOrderPages(data.pages || 1); });
  useEffect(() => { request('/api/v1/admin/dashboard').then(({ stats: rows }) => setStats(rows)).catch((err) => setError(err.message)); }, []);
  useEffect(() => { loadUsers(userPage).catch((err) => setError(err.message)); }, [userPage]);
  useEffect(() => { loadOrders(orderPage).catch((err) => setError(err.message)); }, [orderPage]);
  const updateUser = async (id, values) => { try { await request(`/api/v1/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(values) }); await loadUsers(userPage); } catch (err) { setError(err.message); } };
  return <main className="dashboard page-wrap"><p className="eyebrow">PLATFORM ADMIN</p><h1 className="page-title">The bigger picture.</h1>{error && <p className="form-error">{error}</p>}{stats && <div className="stat-grid"><Stat label="Users" value={stats.totalUsers} /><Stat label="Buyers" value={stats.buyers} /><Stat label="Sellers" value={stats.sellers} /><Stat label="Products" value={stats.totalProducts} /><Stat label="Orders" value={stats.totalOrders} /><Stat label="Order value" value={NPR.format(stats.revenue)} /></div>}<section className="dashboard-section"><h2>People on the platform</h2><div className="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Access</th><th>Actions</th></tr></thead><tbody>{users.map((user) => <tr key={user._id}><td>{user.name}</td><td>{user.email}</td><td><select value={user.role} aria-label={`Role for ${user.name}`} onChange={(event) => updateUser(user._id, { role: event.target.value })}><option value="buyer">Buyer</option><option value="seller">Seller</option><option value="admin">Admin</option></select></td><td>{user.isActive === false ? 'Suspended' : 'Active'}</td><td><button onClick={() => updateUser(user._id, { isActive: user.isActive === false })}>{user.isActive === false ? 'Restore' : 'Suspend'}</button></td></tr>)}</tbody></table></div><Pager page={userPage} pages={userPages} onPage={setUserPage} label="User pages" /></section><section className="dashboard-section"><h2>Recent orders</h2><div className="order-list">{orders.map((order) => <Link to={`/orders/${order._id}`} className="order-row" key={order._id}><div><strong>#{order._id.slice(-8)}</strong><span>{new Date(order.createdAt).toLocaleDateString()}</span></div><span>{order.paymentStatus}</span><span>{order.orderStatus}</span><strong>{NPR.format(order.total)}</strong></Link>)}</div><Pager page={orderPage} pages={orderPages} onPage={setOrderPage} label="Order pages" /></section></main>;
}

function AdminCatalog() {
  const [products, setProducts] = useState([]);
  const [productPage, setProductPage] = useState(1);
  const [productPages, setProductPages] = useState(1);
  const [categories, setCategories] = useState([]);
  const [error, setError] = useState('');
  useDocumentTitle('Catalog admin');
  const loadProducts = (page) => request(`/api/v1/admin/products?page=${page}`).then((data) => { setProducts(data.products || []); setProductPages(data.pages || 1); });
  const loadCategories = () => request('/api/v1/admin/categories').then((data) => setCategories(data.categories || []));
  useEffect(() => { loadProducts(productPage).catch((err) => setError(err.message)); }, [productPage]);
  useEffect(() => { loadCategories().catch((err) => setError(err.message)); }, []);

  const addCategory = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const name = new FormData(form).get('name');
    try {
      await request('/api/v1/admin/categories', { method: 'POST', body: JSON.stringify({ name }) });
      form.reset();
      await loadCategories();
      setError('');
    } catch (err) { setError(err.message); }
  };

  const setProductVisibility = async (product, isActive) => {
    try {
      await request(`/api/v1/admin/products/${product._id}`, { method: 'PATCH', body: JSON.stringify({ isActive }) });
      await loadProducts(productPage);
    } catch (err) { setError(err.message); }
  };

  const setCategoryVisibility = async (category, isActive) => {
    try {
      await request(`/api/v1/admin/categories/${category._id}`, { method: 'PATCH', body: JSON.stringify({ isActive }) });
      await loadCategories();
    } catch (err) { setError(err.message); }
  };

  return <main className="dashboard page-wrap">
    <p className="eyebrow">CATALOG ADMINISTRATION</p><h1 className="page-title">Products and categories.</h1>
    {error && <p className="form-error" role="alert">{error}</p>}
    <section className="dashboard-section">
      <h2>Categories</h2>
      <form className="category-form" onSubmit={addCategory}><Field label="New category" name="name" required /><button className="button button-dark">Add category</button></form>
      {categories.length ? <div className="table-wrap"><table><thead><tr><th>Category</th><th>Status</th><th>Action</th></tr></thead><tbody>{categories.map((category) => <tr key={category._id}><td>{category.name}</td><td>{category.isActive ? 'Active' : 'Hidden'}</td><td><button onClick={() => setCategoryVisibility(category, !category.isActive)}>{category.isActive ? 'Hide' : 'Activate'}</button></td></tr>)}</tbody></table></div> : <p className="muted">No categories have been created yet.</p>}
    </section>
    <section className="dashboard-section">
      <h2>Products</h2>
      <div className="table-wrap"><table><thead><tr><th>Product</th><th>Seller</th><th>Category</th><th>Price</th><th>Stock</th><th>Status</th><th>Action</th></tr></thead><tbody>{products.map((product) => <tr key={product._id}><td>{product.name}</td><td>{product.seller?.name || '—'}</td><td>{product.category}</td><td>{NPR.format(product.price)}</td><td>{product.stock}</td><td>{product.isActive ? 'Active' : 'Hidden'}</td><td><button onClick={() => setProductVisibility(product, !product.isActive)}>{product.isActive ? 'Hide' : 'Restore'}</button></td></tr>)}</tbody></table></div>
      <Pager page={productPage} pages={productPages} onPage={setProductPage} label="Product pages" />
    </section>
  </main>;
}

function Pager({ page, pages, onPage, label = 'Pages' }) {
  if (!pages || pages <= 1) return null;
  return <nav className="pagination" aria-label={label}>
    <button className="button button-outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
    <span>Page {page} of {pages}</span>
    <button className="button button-outline" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
  </nav>;
}

function Stat({ label, value }) { return <div className="stat-card"><span>{label}</span><strong>{value}</strong></div>; }

function PaymentResult() {
  const [params] = useSearchParams();
  const orderId = params.get('orderId');
  const status = params.get('status');
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  useDocumentTitle('Payment status');
  useEffect(() => { if (orderId) request(`/api/v1/orders/${orderId}`).then(({ order: row }) => setOrder(row)).catch((err) => setError(err.message)); }, [orderId]);
  const paid = order?.paymentStatus === 'PAID';
  return <main className="page-wrap result-page"><p className="eyebrow">{paid ? 'PAYMENT COMPLETE' : status === 'created' ? 'ORDER RECEIVED' : 'PAYMENT UPDATE'}</p><h1 className="page-title">{paid ? 'That’s all yours.' : status === 'created' ? 'Order placed.' : 'We’re checking your payment.'}</h1><p className="muted">{paid ? 'Your eSewa payment is verified and your order is confirmed.' : status === 'created' ? 'Your order is saved. You can check its current status in your orders.' : 'Payment is not confirmed yet. Please check again shortly.'}</p>{error && <p className="form-error">{error}</p>}{order && <div className="result-card"><span>Order #{order._id.slice(-8)}</span><strong>{NPR.format(order.total)}</strong><span>Payment: {order.paymentStatus} · {order.orderStatus}</span></div>}<div className="result-actions"><Link className="button button-dark" to="/orders">View my orders</Link><Link className="button button-outline" to="/">Continue shopping</Link></div></main>;
}

function Footer() {
  return <footer className="site-footer"><div className="footer-inner"><Link to="/" className="brand" aria-label="Sajilo Pasal home"><img className="brand-mark" src="/images/sajilo-pasal-mark.png" alt="" /><span>Sajilo Pasal<small>EASY MARKET FOR GROCERY</small></span></Link><p>Made for Nepal. Built around community.</p><span>© {new Date().getFullYear()} Sajilo Pasal</span></div></footer>;
}

function getHelpAnswer(question) {
  const text = question.toLowerCase();
  if (/esewa|merchant|secret|payment|pay\b/.test(text)) {
    return 'For automatic eSewa checkout, sellers need an eSewa mobile number, merchant code, and the API secret issued for ePay V2. Ask eSewa merchant support to enable ePay V2 and provide the credentials. Never use your login password or PIN. Buyers see eSewa at checkout only when every seller in the bag is connected; cash on delivery is also available.';
  }
  if (/order|track|status|delivery|ship/.test(text)) {
    return 'Sign in and open My orders to see order and payment status. Each seller handles their own part of a multi-seller order, so updates may appear separately.';
  }
  if (/sell|seller|product|listing|shop/.test(text)) {
    return 'Create an account in seller mode, then open Seller studio. You can add products, stock, location, photos, manage orders, and connect your eSewa merchant account there.';
  }
  if (/buy|cart|checkout|purchase/.test(text)) {
    return 'Choose a product and select Add to cart or Buy now. At checkout, enter your delivery details and choose an available payment method. Online eSewa appears only if each seller has connected eSewa.';
  }
  if (/account|profile|login|log in|password/.test(text)) {
    return 'Use Log in to access your account. Once signed in, open your profile to update account details and switch between buyer and seller mode when eligible.';
  }
  return 'I can answer common questions about buying, orders, accounts, selling, and eSewa payments. Try asking “How do I track an order?” or “How do I connect eSewa?”';
}

function HelpAssistant() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState([
    { from: 'assistant', text: 'Hi! I’m Sajilo Help. I can guide you through shopping, orders, accounts, seller setup, and payments.' }
  ]);
  const ask = (value) => {
    const text = value.trim();
    if (!text) return;
    setMessages((current) => [...current, { from: 'you', text }, { from: 'assistant', text: getHelpAnswer(text) }]);
    setQuestion('');
  };
  return <div className="help-assistant">
    {open && <section className="help-panel" aria-label="Sajilo Help assistant">
      <div className="help-heading"><div><strong>Sajilo Help</strong><span>Quick answers, anytime</span></div><button type="button" className="help-close" onClick={() => setOpen(false)} aria-label="Close help">×</button></div>
      <div className="help-messages" role="log" aria-live="polite">
        {messages.map((message, index) => <p key={`${index}-${message.from}`} className={`help-message ${message.from}`}>{message.text}</p>)}
      </div>
      <div className="help-topics" aria-label="Common questions">
        <button type="button" onClick={() => ask('How do I track an order?')}>Track order</button>
        <button type="button" onClick={() => ask('How do I connect eSewa?')}>Connect eSewa</button>
      </div>
      <form className="help-input" onSubmit={(event) => { event.preventDefault(); ask(question); }}>
        <label className="visually-hidden" htmlFor="help-question">Ask Sajilo Help</label>
        <input id="help-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask a question…" maxLength="300" />
        <button type="submit" aria-label="Send question" disabled={!question.trim()}>Send</button>
      </form>
      <p className="help-disclaimer">Automated FAQs only; it can’t access your account or order details.</p>
    </section>}
    <button type="button" className="help-launcher" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label={open ? 'Close Sajilo Help' : 'Open Sajilo Help'}>
      <span aria-hidden="true">{open ? '×' : '?'}</span>{open ? 'Close' : 'Need help?'}
    </button>
  </div>;
}

export default function App() {
  const session = useSession();
  return <><Header session={session} /><Routes>
    <Route path="/" element={<Home session={session} />} />
    <Route path="/products/:id" element={<ProductDetail session={session} />} />
    <Route path="/login" element={<AuthPage mode="login" session={session} />} />
    <Route path="/register" element={<AuthPage mode="register" session={session} />} />
    <Route path="/forgot-password" element={<ForgotPassword />} />
    <Route path="/cart" element={<Protected session={session}><Cart session={session} /></Protected>} />
    <Route path="/checkout" element={<Protected session={session}><Checkout /></Protected>} />
    <Route path="/checkout/payments" element={<Protected session={session}><CheckoutPayments /></Protected>} />
    <Route path="/orders" element={<Protected session={session}><Orders /></Protected>} />
    <Route path="/orders/:id" element={<Protected session={session}><OrderDetail /></Protected>} />
    <Route path="/payment/result" element={<Protected session={session}><PaymentResult /></Protected>} />
    <Route path="/profile" element={<Protected session={session}><Profile session={session} /></Protected>} />
    <Route path="/wishlist" element={<Protected session={session}><Wishlist session={session} /></Protected>} />
    <Route path="/seller" element={<Protected session={session} roles={['seller']}><SellerDashboard /></Protected>} />
    <Route path="/admin" element={<Protected session={session} roles={['admin']}><AdminDashboard /></Protected>} />
    <Route path="/admin/catalog" element={<Protected session={session} roles={['admin']}><AdminCatalog /></Protected>} />
    <Route path="*" element={<main className="page-wrap"><div className="state-card"><h1>Page not found</h1><Link to="/" className="button button-dark">Return to shop</Link></div></main>} />
  </Routes><Footer /><HelpAssistant /></>;
}
