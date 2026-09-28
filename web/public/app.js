import { h, render } from "https://esm.sh/preact@10.26.4";
import { useState, useEffect, useCallback, useRef } from "https://esm.sh/preact@10.26.4/hooks";
import htm from "https://esm.sh/htm@3.1.1";

const html = htm.bind(h);

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

function Tag({ label, variant }) {
  return html`<span class="tag tag-${variant || "default"}">${label}</span>`;
}

function Nav({ route, setRoute }) {
  const links = [
    ["plan", "Plan"],
    ["history", "History"],
    ["settings", "Settings"],
  ];
  const cropHref = "/crop.html";
  return html`
    <nav class="nav">
      <a class="brand" href="#" onClick=${(e) => { e.preventDefault(); setRoute("plan"); }}>
        Meal Rotation
      </a>
      <div class="nav-links">
        ${links.map(([id, label]) => html`
          <button
            class=${route === id ? "nav-link active" : "nav-link"}
            onClick=${() => setRoute(id)}
          >${label}</button>
        `)}
        <a class="nav-link" href=${cropHref}>Crop images</a>
      </div>
    </nav>
  `;
}

function mealThumb(meal) {
  if (meal.images?.dish) return "dish";
  if (meal.images?.ingredients) return "ingredients";
  return null;
}

function MealCard({ meal, onView, onSwap, showSwap }) {
  const thumb = mealThumb(meal);
  return html`
    <article class="meal-card">
      ${thumb && html`
        <img
          class="meal-thumb meal-thumb-clickable"
          src="/api/images/${meal.slug}/${thumb}"
          alt=${thumb === "dish" ? meal.name : "Ingredients"}
          onClick=${() => onView(meal.slug, thumb === "dish" ? "instructions" : "ingredients")}
        />
      `}
      <div class="meal-card-body">
        <h3>${meal.name}</h3>
        <div class="tags">
          <${Tag} label=${meal.protein} variant="protein" />
          <${Tag} label=${meal.starch} variant="starch" />
          ${meal.cuisine !== "other" && html`<${Tag} label=${meal.cuisine} variant="cuisine" />`}
          ${meal.weeksSinceCooked === Infinity
            ? html`<${Tag} label="never cooked" variant="new" />`
            : html`<${Tag} label=${`${meal.weeksSinceCooked}w ago`} variant="history" />`}
        </div>
        <div class="meal-actions">
          <button class="btn btn-ghost" onClick=${() => onView(meal.slug)}>View recipe</button>
          ${showSwap && html`
            <button class="btn btn-ghost" onClick=${onSwap}>Swap</button>
          `}
        </div>
      </div>
    </article>
  `;
}

function formatPrice(price) {
  if (price == null) return "—";
  return `$${Number(price).toFixed(2)}`;
}

function formatIngredientNeed(item) {
  const qty = `${item.quantity} ${item.unit}`;
  if (item.orderOnce) return `${qty} needed · order 1 package`;
  return qty;
}

function formatIngredientMeals(item) {
  if (item.meals?.length > 1) return `${item.meals.length} meals`;
  return item.meal || item.meals?.[0] || "";
}

function OrderFlowPanel({ job, onApprove, onCancel, onRetry }) {
  const [skippedAuto, setSkippedAuto] = useState(new Set());
  const [reviewPicks, setReviewPicks] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [retrying, setRetrying] = useState(null);

  const autoItems = job.autoItems || [];
  const reviewItems = job.reviewItems || [];
  const unavailableItems = job.unavailableItems || [];
  const progress = job.progress || {};
  const prevPhase = useRef(null);

  useEffect(() => {
    if (job.phase === "approval" && prevPhase.current !== "approval") {
      setSkippedAuto(new Set());
      setReviewPicks({});
    }
    prevPhase.current = job.phase;
  }, [job.phase]);

  function toggleSkipAuto(autoIndex) {
    setSkippedAuto((prev) => {
      const next = new Set(prev);
      if (next.has(autoIndex)) next.delete(autoIndex);
      else next.add(autoIndex);
      return next;
    });
  }

  function setReviewPick(resolvedIndex, pickIndex) {
    setReviewPicks((prev) => ({ ...prev, [String(resolvedIndex)]: pickIndex }));
  }

  async function handleApprove() {
    setSubmitting(true);
    try {
      await onApprove({
        skippedAuto: [...skippedAuto],
        reviewPicks,
        action: "confirm",
      });
    } finally {
      setSubmitting(false);
    }
  }

  const keptAuto = autoItems.filter((_, i) => !skippedAuto.has(i));
  const confirmedReview = reviewItems
    .filter((item) => reviewPicks[String(item.index)] >= 0)
    .map((item) => {
      const pickIdx = reviewPicks[String(item.index)];
      const candidate = item.candidates[pickIdx];
      return { price: candidate?.price };
    });
  const estimatedTotal = [
    ...keptAuto.map((i) => i.price || 0),
    ...confirmedReview.map((i) => i.price || 0),
  ].reduce((a, b) => a + b, 0);

  const allReviewPicked = reviewItems.every(
    (item) => reviewPicks[String(item.index)] !== undefined,
  );

  if (job.phase === "resolving") {
    const pct = progress.total
      ? Math.round((progress.current / progress.total) * 100)
      : 0;
    return html`
      <article class="panel order-flow">
        <h2>Resolving ingredients</h2>
        <div class="order-progress-bar">
          <div class="order-progress-fill" style=${{ width: `${pct}%` }}></div>
        </div>
        <p class="order-progress-text">
          ${progress.phase === "searching" && progress.ingredient
            ? `Searching “${progress.ingredient}” for ${progress.meal} (${progress.current}/${progress.total})`
            : `Resolved ${progress.current || 0} of ${progress.total || "…"} ingredients`}
        </p>
      </article>
    `;
  }

  if (job.phase === "approval") {
    return html`
      <article class="panel order-flow">
        <header class="order-flow-header">
          <h2>Review your order</h2>
          ${job.meals?.length && html`
            <p class="subtitle">${job.meals.join(", ")}</p>
          `}
        </header>

        ${autoItems.length > 0 && html`
          <section class="order-section">
            <h3>Auto-matched items</h3>
            <p class="hint">Uncheck items you already have at home.</p>
            <ul class="order-item-list">
              ${autoItems.map((item, autoIndex) => html`
                <li class="order-item" key=${item.index}>
                  <label class="order-item-label">
                    <input
                      type="checkbox"
                      checked=${!skippedAuto.has(autoIndex)}
                      onChange=${() => toggleSkipAuto(autoIndex)}
                    />
                    <span class="order-item-main">
                      <strong>${item.name}</strong>
                      <span class="meta">${formatIngredientNeed(item)} · ${formatIngredientMeals(item)}</span>
                    </span>
                    <span class="order-item-product">${item.productTitle || "No match"}</span>
                    <span class="order-item-price">${formatPrice(item.price)}</span>
                  </label>
                </li>
              `)}
            </ul>
          </section>
        `}

        ${unavailableItems.length > 0 && html`
          <section class="order-section">
            <h3>Not available at Whole Foods</h3>
            <p class="hint">These items won't be added to your cart.</p>
            <ul class="order-item-list">
              ${unavailableItems.map((item) => html`
                <li class="order-item order-item-unavailable" key=${item.index}>
                  <span class="order-item-main">
                    <strong>${item.name}</strong>
                    <span class="meta">${formatIngredientNeed(item)} · ${formatIngredientMeals(item)}</span>
                  </span>
                </li>
              `)}
            </ul>
          </section>
        `}

        ${reviewItems.length > 0 && html`
          <section class="order-section">
            <h3>Items needing your selection</h3>
            ${reviewItems.map((item) => html`
              <div class="order-review-item" key=${item.index}>
                <div class="order-review-header">
                  <strong>${item.name}</strong>
                  <span class="meta">${formatIngredientNeed(item)} · ${formatIngredientMeals(item)}</span>
                </div>
                ${item.candidates?.length ? html`
                  <ul class="order-candidates">
                    ${item.candidates.map((c, ci) => html`
                      <li key=${ci}>
                        <label class="order-candidate">
                          <input
                            type="radio"
                            name=${`review-${item.index}`}
                            checked=${reviewPicks[String(item.index)] === ci}
                            onChange=${() => setReviewPick(item.index, ci)}
                          />
                          <span class="order-candidate-title">${c.title}</span>
                          <span class="order-item-price">${formatPrice(c.price)}</span>
                        </label>
                      </li>
                    `)}
                  </ul>
                ` : html`
                  <p class="hint">No products found on Amazon Whole Foods.</p>
                  <button
                    class="btn btn-ghost"
                    disabled=${retrying === item.index}
                    onClick=${async () => {
                      setRetrying(item.index);
                      try { await onRetry(item.index); } finally { setRetrying(null); }
                    }}
                  >${retrying === item.index ? "Searching…" : "Search again"}</button>
                `}
                <button
                  class="btn btn-ghost order-skip-btn"
                  onClick=${() => setReviewPick(item.index, -1)}
                >Skip this item</button>
              </div>
            `)}
          </section>
        `}

        <section class="order-summary">
          <p class="order-total">Estimated total: ${formatPrice(estimatedTotal)}</p>
          <div class="order-actions">
            <button
              class="btn btn-primary"
              disabled=${!allReviewPicked || submitting}
              onClick=${handleApprove}
            >
              ${submitting ? "Adding to cart…" : "Confirm & add to cart"}
            </button>
            <button class="btn btn-ghost" disabled=${submitting} onClick=${onCancel}>Cancel</button>
          </div>
        </section>
      </article>
    `;
  }

  if (job.phase === "cart") {
    const p = job.progress || {};
    const pct = p.total ? Math.round(((p.current || 0) / p.total) * 100) : 0;
    return html`
      <article class="panel order-flow">
        <h2>Adding to cart</h2>
        <div class="order-progress-bar">
          <div class="order-progress-fill" style=${{ width: `${pct}%` }}></div>
        </div>
        <p class="order-progress-text">
          ${p.name
            ? p.status === "added"
              ? `Added “${p.name}” (${p.current || 0}/${p.total || "…"})`
              : p.status === "failed"
                ? `Failed on “${p.name}” (${p.current || 0}/${p.total || "…"})`
                : `Adding “${p.name}” (${p.current || 0}/${p.total || "…"})`
            : (job.message || "Starting cart…")}
        </p>
        <div class="order-cart-stats">
          <span><strong>${p.itemsAdded ?? 0}</strong> items in cart</span>
          <span>Running total: <strong>${formatPrice(p.cartTotal)}</strong></span>
        </div>
      </article>
    `;
  }

  if (job.phase === "done" && !job.cancelled) {
    const cart = job.result?.cart;
    return html`
      <article class="panel order-flow order-flow-done">
        <h2>Order complete</h2>
        ${cart && html`
          <p>Added ${cart.itemsAdded} of ${cart.itemsRequested} items to your cart.</p>
          ${cart.cartTotal != null && html`
            <p class="order-total">Cart total: ${formatPrice(cart.cartTotal)}</p>
          `}
          <a class="btn btn-primary" href=${cart.cartUrl || "https://www.amazon.com/cart"} target="_blank" rel="noopener">
            Open Amazon cart
          </a>
        `}
      </article>
    `;
  }

  if (job.phase === "error") {
    return html`
      <article class="panel order-flow">
        <div class="alert alert-error">${job.error || "Order failed"}</div>
      </article>
    `;
  }

  return null;
}

function PlanView({ setRoute }) {
  const [data, setData] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [weekDate, setWeekDate] = useState("");
  const [mealNames, setMealNames] = useState([]);
  const [amazonStatus, setAmazonStatus] = useState(null);
  const [ordering, setOrdering] = useState(false);
  const [job, setJob] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [swapIndex, setSwapIndex] = useState(null);
  const [error, setError] = useState("");

  const loadWeekMeals = useCallback(async (target, weeksData) => {
    const existing = weeksData.weeks.find((w) => w.week === target);
    if (existing?.mealNames?.length) {
      setMealNames(existing.mealNames);
    } else {
      const suggested = await api(`/api/weeks/${target}/suggest`, { method: "POST" });
      setMealNames(suggested.mealNames);
    }
  }, []);

  const load = useCallback(async () => {
    const [weeks, cat, amazon] = await Promise.all([
      api("/api/weeks"),
      api("/api/catalog"),
      api("/api/amazon/status"),
    ]);
    setData(weeks);
    setCatalog(cat);
    setAmazonStatus(amazon);
    const target = weeks.upcoming;
    setWeekDate(target);
    await loadWeekMeals(target, weeks);
  }, [loadWeekMeals]);

  const skipWeekReload = useRef(true);

  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);

  useEffect(() => {
    if (!data || !weekDate) return;
    if (skipWeekReload.current) {
      skipWeekReload.current = false;
      return;
    }
    loadWeekMeals(weekDate, data).catch((e) => setError(e.message));
  }, [weekDate]);

  useEffect(() => {
    if (!jobId) return;
    const interval = setInterval(async () => {
      const j = await api(`/api/jobs/${jobId}`);
      setJob(j);
      if (j.done) {
        clearInterval(interval);
        setOrdering(false);
        if (j.result?.code === 0) {
          await load();
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [jobId, load]);

  const catalogByName = new Map(catalog.map((m) => [m.name, m]));
  const meals = mealNames.map((name) => {
    const fromCatalog = catalogByName.get(name);
    const fromWeek = data?.weeks.find((w) => w.week === weekDate);
    const enriched = fromWeek?.meals?.find((m) => m.name === name);
    return {
      name,
      slug: fromCatalog?.slug,
      protein: fromCatalog?.protein || enriched?.protein || "?",
      starch: fromCatalog?.starch || enriched?.starch || "?",
      cuisine: fromCatalog?.cuisine || enriched?.cuisine || "other",
      weeksSinceCooked: enriched?.weeksSinceCooked ?? Infinity,
      images: fromCatalog?.images || enriched?.images,
    };
  });

  async function suggestAll() {
    const res = await api(`/api/weeks/${weekDate}/suggest`, {
      method: "POST",
      body: { randomize: true },
    });
    setMealNames(res.mealNames);
  }

  async function orderGroceries() {
    setError("");
    if (mealNames.length < data.settings.mealsPerWeek) {
      setError(`Select ${data.settings.mealsPerWeek} meals before ordering.`);
      return;
    }
    try {
      setOrdering(true);
      const res = await api("/api/purchase/run", {
        method: "POST",
        body: { week: weekDate, mealNames },
      });
      setJobId(res.jobId);
      setJob({ log: [], done: false });
    } catch (e) {
      setError(e.message);
      setOrdering(false);
    }
  }

  async function handleApprove(approval) {
    const updated = await api(`/api/purchase/jobs/${jobId}/approve`, {
      method: "POST",
      body: approval,
    });
    setJob(updated);
  }

  async function handleCancelOrder() {
    const updated = await api(`/api/purchase/jobs/${jobId}/approve`, {
      method: "POST",
      body: { action: "cancel" },
    });
    setJob(updated);
    setOrdering(false);
  }

  async function handleRetrySearch(index) {
    const result = await api(`/api/purchase/jobs/${jobId}/retry`, {
      method: "POST",
      body: { index },
    });
    setJob((prev) => ({
      ...prev,
      resolved: prev.resolved.map((r) =>
        r.index === index ? { ...r, candidates: result.candidates } : r
      ),
      reviewItems: prev.reviewItems.map((r) =>
        r.index === index ? { ...r, candidates: result.candidates } : r
      ),
    }));
  }

  function pickMeal(name) {
    const next = [...mealNames];
    next[swapIndex] = name;
    setMealNames(next);
    setPickerOpen(false);
    setSwapIndex(null);
  }

  if (!data) return html`<div class="loading">Loading…</div>`;

  const canOrder = amazonStatus?.status === "valid"
    && mealNames.length >= data.settings.mealsPerWeek;

  return html`
    <section class="view">
      <header class="view-header">
        <div>
          <h1>This week</h1>
          <p class="subtitle">Plan ${data.settings.mealsPerWeek} meals with variety and shared staples</p>
        </div>
        <div class="week-picker">
          <label>Week of</label>
          <input type="date" value=${weekDate} onInput=${(e) => setWeekDate(e.target.value)} />
        </div>
      </header>

      ${error && html`<div class="alert alert-error">${error}</div>`}

      <div class="toolbar">
        <button class="btn" onClick=${suggestAll}>Suggest meals</button>
        <button class="btn btn-primary" onClick=${orderGroceries} disabled=${ordering || !canOrder}>
          ${ordering ? "Ordering…" : "Order groceries"}
        </button>
      </div>

      ${amazonStatus?.status !== "valid" && html`
        <p class="hint">
          Connect Amazon in
          <button class="link-btn" onClick=${() => setRoute("settings")}>Settings</button>
          to order groceries.
        </p>
      `}

      ${job && html`
        <${OrderFlowPanel}
          job=${job}
          onApprove=${handleApprove}
          onCancel=${handleCancelOrder}
          onRetry=${handleRetrySearch}
        />
      `}

      <div class="meal-grid">
        ${meals.map((meal, i) => html`
          <${MealCard}
            key=${meal.name}
            meal=${meal}
            onView=${(slug, tab) => slug && setRoute("recipe", slug, tab)}
            onSwap=${() => { setSwapIndex(i); setPickerOpen(true); }}
            showSwap=${true}
          />
        `)}
        ${mealNames.length < data.settings.mealsPerWeek && html`
          <div class="meal-card meal-card-empty">
            <p>Need ${data.settings.mealsPerWeek - mealNames.length} more meal(s)</p>
            <button class="btn" onClick=${suggestAll}>Add suggestion</button>
          </div>
        `}
      </div>

      ${pickerOpen && html`
        <${CatalogPicker}
          onPick=${pickMeal}
          onClose=${() => { setPickerOpen(false); setSwapIndex(null); }}
          exclude=${mealNames}
        />
      `}
    </section>
  `;
}

function ImageLightbox({ src, alt, onClose }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return html`
    <div class="image-lightbox-overlay" onClick=${onClose} role="dialog" aria-modal="true">
      <button class="image-lightbox-close btn btn-ghost" onClick=${onClose} aria-label="Close">×</button>
      <img
        class="image-lightbox-img"
        src=${src}
        alt=${alt}
        onClick=${(e) => e.stopPropagation()}
      />
    </div>
  `;
}

function CatalogPicker({ onPick, onClose, exclude }) {
  const [catalog, setCatalog] = useState([]);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    api("/api/catalog").then(setCatalog);
  }, []);

  const excludeSet = new Set(exclude || []);
  const filtered = catalog.filter((m) => {
    if (excludeSet.has(m.name)) return false;
    if (!filter) return true;
    const q = filter.toLowerCase();
    return m.name.toLowerCase().includes(q) || m.protein.includes(q) || m.cuisine.includes(q);
  });

  return html`
    <div class="modal-overlay" onClick=${onClose}>
      <div class="modal" onClick=${(e) => e.stopPropagation()}>
        <header class="modal-header">
          <h2>Choose a recipe</h2>
          <button class="btn btn-ghost" onClick=${onClose}>Close</button>
        </header>
        <input
          class="search-input"
          placeholder="Search by name, protein, cuisine…"
          value=${filter}
          onInput=${(e) => setFilter(e.target.value)}
        />
        <ul class="catalog-list">
          ${filtered.map((m) => html`
            <li>
              <button class="catalog-item" onClick=${() => onPick(m.name)}>
                <span class="catalog-name">${m.name}</span>
                <span class="tags">
                  <${Tag} label=${m.protein} variant="protein" />
                  <${Tag} label=${m.starch} variant="starch" />
                </span>
              </button>
            </li>
          `)}
        </ul>
      </div>
    </div>
  `;
}

function RecipeView({ slug, goBack, initialTab = "instructions" }) {
  const [recipe, setRecipe] = useState(null);
  const [tab, setTab] = useState(initialTab);
  const [lightbox, setLightbox] = useState(null);

  useEffect(() => {
    setTab(initialTab);
  }, [slug, initialTab]);

  useEffect(() => {
    api(`/api/recipes/${slug}`).then(setRecipe).catch(() => setRecipe(null));
  }, [slug]);

  if (!recipe) return html`<div class="loading">Loading recipe…</div>`;

  return html`
    <section class="view recipe-view">
      <button class="btn btn-ghost back-btn" onClick=${goBack}>← Back</button>
      <h1>${recipe.name}</h1>
      <div class="tags">
        <${Tag} label=${recipe.protein} variant="protein" />
        <${Tag} label=${recipe.starch} variant="starch" />
        ${recipe.cuisine !== "other" && html`<${Tag} label=${recipe.cuisine} variant="cuisine" />`}
        <${Tag} label=${`${recipe.servings} servings`} variant="default" />
      </div>

      ${recipe.images?.dish && html`
        <img
          class="recipe-image recipe-image-clickable"
          src="/api/images/${recipe.slug}/dish"
          alt=${recipe.name}
          onClick=${() => setLightbox({
            src: `/api/images/${recipe.slug}/dish`,
            alt: recipe.name,
          })}
        />
        ${recipe.photoCredit && html`<p class="photo-credit">${recipe.photoCredit}</p>`}
      `}

      <div class="tabs">
        <button class=${tab === "instructions" ? "tab active" : "tab"} onClick=${() => setTab("instructions")}>
          Instructions
        </button>
        <button class=${tab === "ingredients" ? "tab active" : "tab"} onClick=${() => setTab("ingredients")}>
          Ingredients
        </button>
        ${recipe.nutrition && html`
          <button class=${tab === "nutrition" ? "tab active" : "tab"} onClick=${() => setTab("nutrition")}>
            Nutrition
          </button>
        `}
      </div>

      ${tab === "instructions" && html`
        <div class="recipe-content">
          ${recipe.images?.instructions && html`
            <img
              class="recipe-image recipe-image-clickable"
              src="/api/images/${recipe.slug}/instructions"
              alt="Instructions card"
              onClick=${() => setLightbox({
                src: `/api/images/${recipe.slug}/instructions`,
                alt: "Instructions card",
              })}
            />
          `}
          <ol class="steps">
            ${(recipe.instructions || []).map((step) => html`
              <li class="step">
                <h3>Step ${step.step}: ${step.title}</h3>
                <p>${step.text}</p>
              </li>
            `)}
          </ol>
        </div>
      `}

      ${tab === "ingredients" && html`
        <div class="recipe-content">
          ${recipe.images?.ingredients && html`
            <img
              class="recipe-image recipe-image-clickable"
              src="/api/images/${recipe.slug}/ingredients"
              alt="Ingredients card"
              onClick=${() => setLightbox({
                src: `/api/images/${recipe.slug}/ingredients`,
                alt: "Ingredients card",
              })}
            />
          `}
          <ul class="ingredient-list">
            ${(recipe.ingredients || []).map((ing) => html`
              <li>${ing.quantity} ${ing.unit} ${ing.name}</li>
            `)}
          </ul>
        </div>
      `}

      ${tab === "nutrition" && recipe.nutrition && html`
        <div class="nutrition-grid">
          ${Object.entries(recipe.nutrition).map(([k, v]) => html`
            <div class="nutrition-item">
              <span class="nutrition-label">${k.replace(/_/g, " ")}</span>
              <span class="nutrition-value">${v}</span>
            </div>
          `)}
        </div>
      `}

      ${lightbox && html`
        <${ImageLightbox}
          src=${lightbox.src}
          alt=${lightbox.alt}
          onClose=${() => setLightbox(null)}
        />
      `}
    </section>
  `;
}

function HistoryView({ setRoute }) {
  const [weeks, setWeeks] = useState([]);

  useEffect(() => {
    api("/api/weeks").then((d) => setWeeks(d.weeks));
  }, []);

  return html`
    <section class="view">
      <h1>Meal history</h1>
      <p class="subtitle">Past weeks and when each meal was last cooked</p>

      ${weeks.length === 0 && html`<p class="empty">No planned weeks yet.</p>`}

      <div class="history-list">
        ${weeks.map((week) => html`
          <article class="history-week" key=${week.week}>
            <header>
              <h2>Week of ${week.week}</h2>
              <div class="history-week-meta">
                <${Tag}
                  label=${week.status === "ordered" ? "ordered" : (week.status || "planned")}
                  variant=${week.status === "ordered" ? "ordered" : "default"}
                />
                ${week.orderedAt && html`
                  <span class="meta">${new Date(week.orderedAt).toLocaleDateString()}</span>
                `}
              </div>
            </header>
            <ul>
              ${(week.meals || []).map((meal) => html`
                <li>
                  <button class="link-btn" onClick=${() => meal.slug && setRoute("recipe", meal.slug)}>
                    ${meal.name}
                  </button>
                  <span class="meta">
                    ${meal.weeksSinceCooked === Infinity ? "first time" : `${meal.weeksSinceCooked}w since prior`}
                  </span>
                </li>
              `)}
            </ul>
          </article>
        `)}
      </div>
    </section>
  `;
}

function SettingsView() {
  const [settings, setSettings] = useState(null);
  const [saved, setSaved] = useState(false);
  const [amazonStatus, setAmazonStatus] = useState(null);
  const [job, setJob] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [authError, setAuthError] = useState("");

  const refreshAmazon = useCallback(() => {
    api("/api/amazon/status").then(setAmazonStatus);
  }, []);

  useEffect(() => {
    api("/api/settings").then(setSettings);
    refreshAmazon();
  }, [refreshAmazon]);

  useEffect(() => {
    if (!jobId) return;
    const interval = setInterval(async () => {
      const j = await api(`/api/jobs/${jobId}`);
      setJob(j);
      if (j.done) {
        clearInterval(interval);
        refreshAmazon();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [jobId, refreshAmazon]);

  async function save() {
    await api("/api/settings", { method: "PUT", body: settings });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function startAuth() {
    setAuthError("");
    try {
      const res = await api("/api/amazon/auth", { method: "POST" });
      setJobId(res.jobId);
      setJob({ log: [], done: false });
    } catch (e) {
      setAuthError(e.message);
    }
  }

  if (!settings) return html`<div class="loading">Loading…</div>`;

  const statusLabel = {
    valid: "Connected",
    expired: "Session expired",
    missing: "Not authenticated",
  };

  return html`
    <section class="view">
      <h1>Settings</h1>
      <div class="settings-form">
        <label>
          Meals per week
          <input
            type="number" min="1" max="7"
            value=${settings.mealsPerWeek}
            onInput=${(e) => setSettings({ ...settings, mealsPerWeek: +e.target.value })}
          />
        </label>
        <label>
          Cooldown weeks (don't repeat within)
          <input
            type="number" min="0" max="52"
            value=${settings.cooldownWeeks}
            onInput=${(e) => setSettings({ ...settings, cooldownWeeks: +e.target.value })}
          />
        </label>
        <button class="btn btn-primary" onClick=${save}>Save</button>
        ${saved && html`<span class="saved-msg">Saved!</span>`}
      </div>

      <article class="panel settings-amazon">
        <h2>Amazon session</h2>
        <p class="subtitle">Required to order groceries from the Plan page.</p>
        ${amazonStatus && html`
          <div class=${`status-badge status-${amazonStatus.status}`}>
            ${statusLabel[amazonStatus.status]}
          </div>
          ${amazonStatus.savedAt && html`
            <p class="meta">Saved ${amazonStatus.ageDays} day(s) ago (max ${amazonStatus.maxAgeDays})</p>
          `}
        `}
        <button class="btn" onClick=${startAuth}>Authenticate (opens browser)</button>
        <p class="hint">Log in to Amazon, confirm Whole Foods delivery, then close the browser.</p>
        ${authError && html`<div class="alert alert-error">${authError}</div>`}
        ${job && html`
          <pre class="log-output">${(job.log || []).map((l) => l.text).join("")}${job.done ? "\n[done]" : ""}</pre>
        `}
      </article>
    </section>
  `;
}

function App() {
  const [route, setRouteState] = useState("plan");
  const [recipeSlug, setRecipeSlug] = useState(null);
  const [recipeTab, setRecipeTab] = useState("instructions");

  function setRoute(name, slug, tab) {
    setRouteState(name);
    setRecipeSlug(slug || null);
    setRecipeTab(tab || "instructions");
    window.scrollTo(0, 0);
  }

  return html`
    <div class="app">
      <${Nav} route=${route} setRoute=${setRoute} />
      <main>
        ${route === "plan" && html`<${PlanView} setRoute=${setRoute} />`}
        ${route === "recipe" && recipeSlug && html`
          <${RecipeView} slug=${recipeSlug} initialTab=${recipeTab} goBack=${() => setRoute("plan")} />
        `}
        ${route === "history" && html`<${HistoryView} setRoute=${setRoute} />`}
        ${route === "settings" && html`<${SettingsView} />`}
      </main>
    </div>
  `;
}

render(html`<${App} />`, document.getElementById("app"));
