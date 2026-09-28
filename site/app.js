import { suggestMeals, suggestReplacement } from "./lib/planner.js";
import {
  loadPlanning,
  savePlanning,
  getWeek,
  upsertWeek,
  mealLastCooked,
  weeksSince,
} from "./lib/storage.js";

const catalog = await fetch(new URL("./catalog.json", import.meta.url)).then((res) => {
  if (!res.ok) throw new Error("Could not load the recipe catalog.");
  return res.json();
});

const byName = new Map(catalog.map((meal) => [meal.name, meal]));
const bySlug = new Map(catalog.map((meal) => [meal.slug, meal]));

const app = document.getElementById("app");
let route = parseRoute();
let query = "";
let protein = "all";
let cuisine = "all";
let pickerIndex = null;
let recipeTab = route.tab || "instructions";
let lightbox = null;

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && lightbox) {
    lightbox = null;
    render();
  }
});

window.addEventListener("hashchange", () => {
  route = parseRoute();
  recipeTab = route.tab || "instructions";
  pickerIndex = null;
  lightbox = null;
  render();
  window.scrollTo(0, 0);
});

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "recipe" && parts[1]) {
    return {
      name: "recipe",
      slug: decodeURIComponent(parts[1]),
      tab: parts[2] === "ingredients" ? "ingredients" : "instructions",
    };
  }
  if (parts[0] === "plan" || parts[0] === "history") return { name: parts[0] };
  return { name: "recipes" };
}

function go(hash) {
  if (location.hash === hash) {
    route = parseRoute();
    render();
    return;
  }
  location.hash = hash;
}

function nextMonday(from = new Date()) {
  const d = new Date(from);
  const day = d.getDay();
  const daysUntil = day === 0 ? 1 : day === 1 ? 7 : 8 - day;
  d.setDate(d.getDate() + daysUntil);
  return d.toISOString().slice(0, 10);
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "html") node.innerHTML = value;
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function tag(label, variant = "default") {
  return el("span", { class: `tag tag-${variant}` }, label);
}

function cookedLabel(meal, weekDate) {
  const weeks = weeksSince(weekDate, mealLastCooked(loadPlanning(), meal.name));
  if (weeks === Infinity) return tag("never cooked", "new");
  if (weeks <= 0) return tag("this week", "history");
  return tag(`${weeks}w ago`, "history");
}

function purchaseMeal(meal) {
  const out = {
    name: meal.name,
    servings: meal.servings,
    ingredients: meal.ingredients,
    instructions: meal.instructions,
  };
  if (meal.nutrition) out.nutrition = meal.nutrition;
  return out;
}

function comboNotes(meals) {
  if (meals.length < 2) return [];
  const notes = [];
  const proteins = meals.map((m) => m.protein).filter((p) => p !== "other");
  const uniqueProteins = new Set(proteins);
  if (proteins.length && uniqueProteins.size === proteins.length) {
    notes.push("Each meal uses a different protein.");
  } else if (uniqueProteins.size < proteins.length) {
    notes.push("A protein repeats in this set. Swap one if you want more variety.");
  }

  const counts = new Map();
  for (const meal of meals) {
    for (const staple of meal.staples || []) {
      counts.set(staple, (counts.get(staple) || 0) + 1);
    }
  }
  const shared = [...counts.entries()].filter(([, n]) => n > 1).map(([name]) => name);
  if (shared.length) notes.push(`Shared staples: ${shared.join(", ")}.`);
  else notes.push("These meals share few staples, so the grocery list will be longer.");
  return notes;
}

function nav() {
  const links = [
    ["#/recipes", "Recipes", "recipes"],
    ["#/plan", "Plan", "plan"],
    ["#/history", "History", "history"],
  ];
  return el("nav", { class: "nav" }, [
    el("button", { class: "brand", onClick: () => go("#/recipes") }, "Meal Rotation"),
    el("div", { class: "nav-links" }, links.map(([href, label, name]) =>
      el("a", {
        class: route.name === name ? "nav-link active" : "nav-link",
        href,
      }, label),
    )),
  ]);
}

function photoButton(src, alt, className) {
  if (!src) return null;
  return el("button", {
    class: className,
    type: "button",
    onClick: () => { lightbox = { src, alt }; render(); },
  }, el("img", { src, alt, loading: "lazy" }));
}

function lightboxOverlay() {
  if (!lightbox) return null;
  return el("div", {
    class: "lightbox",
    onClick: () => { lightbox = null; render(); },
  }, [
    el("button", { class: "lightbox-close", type: "button", onClick: () => { lightbox = null; render(); } }, "Close"),
    el("img", { src: lightbox.src, alt: lightbox.alt, onClick: (event) => event.stopPropagation() }),
  ]);
}

function recipeCards(meals) {
  const planningWeek = nextMonday();
  return el("div", { class: "recipe-grid" }, meals.map((meal) =>
    el("article", { class: "card" }, [
      photoButton(meal.images?.dish || meal.images?.ingredients, meal.images?.dish ? meal.name : `${meal.name} ingredients card`, "card-photo"),
      el("h3", {}, meal.name),
      el("div", { class: "tags" }, [
        tag(meal.protein, "protein"),
        tag(meal.starch, "starch"),
        meal.cuisine !== "other" ? tag(meal.cuisine, "cuisine") : null,
        cookedLabel(meal, planningWeek),
      ]),
      el("p", { class: "meta" }, `${meal.servings} servings · ${(meal.ingredients || []).length} ingredients`),
      el("div", { class: "card-actions" }, [
        el("button", { class: "btn btn-ghost", onClick: () => go(`#/recipe/${meal.slug}`) }, "View recipe"),
      ]),
    ]),
  ));
}

function recipesView() {
  const proteins = [...new Set(catalog.map((m) => m.protein))].sort();
  const cuisines = [...new Set(catalog.map((m) => m.cuisine).filter((c) => c !== "other"))].sort();
  const q = query.trim().toLowerCase();
  const filtered = catalog.filter((meal) => {
    if (protein !== "all" && meal.protein !== protein) return false;
    if (cuisine !== "all" && meal.cuisine !== cuisine) return false;
    if (!q) return true;
    const hay = `${meal.name} ${(meal.staples || []).join(" ")} ${meal.protein} ${meal.cuisine}`.toLowerCase();
    return hay.includes(q);
  });

  return el("section", {}, [
    el("header", { class: "view-header" }, [
      el("div", {}, [
        el("h1", {}, "Recipes"),
        el("p", { class: "subtitle" }, `${catalog.length} meals you already like.`),
      ]),
    ]),
    el("div", { class: "filters" }, [
      el("input", {
        id: "recipe-search",
        class: "search-input",
        type: "search",
        placeholder: "Search name or staple…",
        value: query,
        onInput: (e) => { query = e.target.value; render(); },
      }),
      el("select", {
        onChange: (e) => { protein = e.target.value; render(); },
      }, [
        el("option", { value: "all", selected: protein === "all" ? "selected" : null }, "All proteins"),
        ...proteins.map((value) => el("option", { value, selected: protein === value ? "selected" : null }, value)),
      ]),
      el("select", {
        onChange: (e) => { cuisine = e.target.value; render(); },
      }, [
        el("option", { value: "all", selected: cuisine === "all" ? "selected" : null }, "All cuisines"),
        ...cuisines.map((value) => el("option", { value, selected: cuisine === value ? "selected" : null }, value)),
      ]),
    ]),
    filtered.length
      ? recipeCards(filtered)
      : el("p", { class: "empty" }, "No recipes match that filter."),
  ]);
}

function recipeView() {
  const meal = bySlug.get(route.slug);
  if (!meal) return el("p", { class: "empty" }, "That recipe is not in the catalog.");

  const tabBtn = (id, label) => el("button", {
    class: recipeTab === id ? "tab active" : "tab",
    onClick: () => { recipeTab = id; render(); },
  }, label);

  const cardSrc = meal.images?.[recipeTab];
  const body = recipeTab === "ingredients"
    ? el("div", { class: "recipe-content" }, [
        photoButton(cardSrc, `${meal.name} ingredients card`, "recipe-photo"),
        el("ul", { class: "ingredient-list" }, (meal.ingredients || []).map((item) =>
          el("li", {}, `${item.quantity} ${item.unit} ${item.name}`),
        )),
      ])
    : el("div", { class: "recipe-content" }, [
        photoButton(cardSrc, `${meal.name} instructions card`, "recipe-photo"),
        el("ol", { class: "steps" }, (meal.instructions || []).map((step) =>
          el("li", { class: "step" }, [
            el("h3", {}, `Step ${step.step}: ${step.title}`),
            el("p", {}, step.text),
          ]),
        )),
      ]);

  return el("section", {}, [
    el("button", { class: "btn btn-ghost back-btn", onClick: () => go("#/recipes") }, "← Recipes"),
    el("h1", {}, meal.name),
    el("div", { class: "tags" }, [
      tag(meal.protein, "protein"),
      tag(meal.starch, "starch"),
      meal.cuisine !== "other" ? tag(meal.cuisine, "cuisine") : null,
      tag(`${meal.servings} servings`),
      cookedLabel(meal, nextMonday()),
    ]),
    meal.images?.dish
      ? photoButton(meal.images.dish, meal.name, "recipe-photo")
      : null,
    meal.photoCredit ? el("p", { class: "photo-credit" }, meal.photoCredit) : null,
    el("div", { class: "tabs" }, [
      tabBtn("instructions", "Instructions"),
      tabBtn("ingredients", "Ingredients"),
    ]),
    body,
  ]);
}

let planWeek = nextMonday();
let draftNames = null;

function planningExceptCurrentWeek() {
  const planning = loadPlanning();
  return {
    ...planning,
    weeks: planning.weeks.filter((week) => week.week !== planWeek),
  };
}

function planView() {
  const planning = loadPlanning();
  if (!draftNames) {
    const existing = getWeek(planning, planWeek);
    draftNames = existing?.mealNames ? [...existing.mealNames] : [];
  }
  const meals = draftNames.map((name) => byName.get(name)).filter(Boolean);
  const notes = comboNotes(meals);

  function persist(status = "planned") {
    const next = loadPlanning();
    upsertWeek(next, {
      week: planWeek,
      mealNames: [...draftNames],
      status,
      updatedAt: new Date().toISOString(),
    });
    savePlanning(next);
  }

  function suggest() {
    const planning = planningExceptCurrentWeek();
    draftNames = suggestMeals(
      catalog,
      planning,
      planWeek,
      planning.settings.mealsPerWeek,
      [],
      { randomize: true },
    );
    persist();
    render();
  }

  function download() {
    const payload = {
      week: planWeek,
      meals: meals.map(purchaseMeal),
    };
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: `week-${planWeek}.json` });
    a.click();
    URL.revokeObjectURL(url);
    persist();
  }

  const settings = planning.settings;

  return el("section", {}, [
    el("header", { class: "view-header" }, [
      el("div", {}, [
        el("h1", {}, "This week"),
        el("p", { class: "subtitle" }, "Suggest a set keeps meals that share groceries, and avoids a second meal with the same protein, starch, or cuisine."),
      ]),
      el("label", { class: "field" }, [
        "Week of",
        el("input", {
          type: "date",
          value: planWeek,
          onChange: (e) => {
            planWeek = e.target.value || planWeek;
            draftNames = null;
            render();
          },
        }),
      ]),
    ]),
    el("div", { class: "filters" }, [
      el("label", { class: "field" }, [
        "Meals",
        el("input", {
          type: "number",
          min: "1",
          max: "7",
          value: String(settings.mealsPerWeek),
          onChange: (e) => {
            const next = loadPlanning();
            next.settings.mealsPerWeek = Math.min(7, Math.max(1, Number(e.target.value) || 3));
            savePlanning(next);
            render();
          },
        }),
      ]),
      el("label", { class: "field" }, [
        "Skip if cooked within (weeks)",
        el("input", {
          type: "number",
          min: "0",
          max: "52",
          value: String(settings.cooldownWeeks),
          onChange: (e) => {
            const next = loadPlanning();
            next.settings.cooldownWeeks = Math.min(52, Math.max(0, Number(e.target.value) || 0));
            savePlanning(next);
            render();
          },
        }),
      ]),
    ]),
    el("div", { class: "toolbar" }, [
      el("button", { class: "btn", onClick: suggest }, "Suggest a set"),
      el("button", { class: "btn btn-primary", disabled: meals.length === 0, onClick: download }, "Download week JSON"),
    ]),
    notes.length
      ? el("article", { class: "panel" }, [
          el("h2", {}, "Why this combination"),
          ...notes.map((note) => el("p", {}, note)),
          el("p", { class: "hint" }, [
            "Hand the file to purchasing with ",
            el("code", {}, "python -m purchasing run --recipe week-" + planWeek + ".json"),
            ", or give that same file to an agent.",
          ]),
        ])
      : el("p", { class: "hint" }, "Suggest a set, or it will fill in from meals you have not cooked recently."),
    el("div", { class: "meal-grid" }, [
      ...meals.map((meal, index) => el("article", { class: "card" }, [
        photoButton(meal.images?.dish || meal.images?.ingredients, meal.images?.dish ? meal.name : `${meal.name} ingredients card`, "card-photo"),
        el("h3", {}, meal.name),
        el("div", { class: "tags" }, [
          tag(meal.protein, "protein"),
          tag(meal.starch, "starch"),
          meal.cuisine !== "other" ? tag(meal.cuisine, "cuisine") : null,
          cookedLabel(meal, planWeek),
        ]),
        overlapLine(meal, meals),
        el("div", { class: "card-actions" }, [
          el("button", { class: "btn btn-ghost", onClick: () => go(`#/recipe/${meal.slug}`) }, "View"),
          el("button", { class: "btn btn-ghost", onClick: () => swap(index) }, "Swap"),
          el("button", { class: "btn btn-ghost", onClick: () => { pickerIndex = index; render(); } }, "Choose"),
        ]),
      ])),
      meals.length < settings.mealsPerWeek
        ? el("article", { class: "card" }, [
            el("p", {}, `${settings.mealsPerWeek - meals.length} more meal${settings.mealsPerWeek - meals.length === 1 ? "" : "s"} to go.`),
            el("button", { class: "btn", onClick: suggest }, "Fill the week"),
          ])
        : null,
    ]),
    pickerIndex != null ? picker(pickerIndex) : null,
  ]);
}

function overlapLine(meal, meals) {
  const others = meals.filter((other) => other.name !== meal.name);
  const shared = new Set();
  for (const other of others) {
    for (const staple of meal.staples || []) {
      if ((other.staples || []).includes(staple)) shared.add(staple);
    }
  }
  if (!shared.size) return el("p", { class: "meta" }, "No shared staples with the other meals.");
  return el("p", { class: "meta" }, `Shares ${[...shared].join(", ")}.`);
}

function swap(index) {
  draftNames = suggestReplacement(catalog, planningExceptCurrentWeek(), planWeek, draftNames, index);
  const next = loadPlanning();
  upsertWeek(next, {
    week: planWeek,
    mealNames: [...draftNames],
    status: "planned",
    updatedAt: new Date().toISOString(),
  });
  savePlanning(next);
  render();
}

function picker(index) {
  let filter = "";
  const box = el("div", { class: "modal" });
  const overlay = el("div", { class: "modal-overlay", onClick: (e) => {
    if (e.target === overlay) { pickerIndex = null; render(); }
  } }, box);

  function draw() {
    const q = filter.trim().toLowerCase();
    const exclude = new Set(draftNames);
    const items = catalog.filter((meal) => {
      if (exclude.has(meal.name) && meal.name !== draftNames[index]) return false;
      if (!q) return true;
      return meal.name.toLowerCase().includes(q) || meal.protein.includes(q) || meal.cuisine.includes(q);
    });
    box.replaceChildren(
      el("header", { class: "modal-header" }, [
        el("h2", {}, "Choose a recipe"),
        el("button", { class: "btn btn-ghost", onClick: () => { pickerIndex = null; render(); } }, "Close"),
      ]),
      el("input", {
        class: "search-input",
        placeholder: "Search by name, protein, cuisine…",
        value: filter,
        onInput: (e) => { filter = e.target.value; draw(); },
      }),
      el("ul", { class: "catalog-list" }, items.map((meal) =>
        el("li", {}, el("button", {
          class: "catalog-item",
          onClick: () => {
            draftNames = [...draftNames];
            draftNames[index] = meal.name;
            const next = loadPlanning();
            upsertWeek(next, {
              week: planWeek,
              mealNames: [...draftNames],
              status: "planned",
              updatedAt: new Date().toISOString(),
            });
            savePlanning(next);
            pickerIndex = null;
            render();
          },
        }, [
          el("span", {}, meal.name),
          el("span", { class: "tags" }, [
            tag(meal.protein, "protein"),
            tag(meal.starch, "starch"),
          ]),
        ])),
      )),
    );
    box.querySelector("input")?.focus();
  }

  draw();
  return overlay;
}

function historyView() {
  const planning = loadPlanning();
  if (!planning.weeks.length) {
    return el("section", {}, [
      el("h1", {}, "History"),
      el("p", { class: "empty" }, "Saved weeks show up here and feed the cooldown."),
    ]);
  }

  return el("section", {}, [
    el("h1", {}, "History"),
    el("p", { class: "subtitle" }, "These weeks are what the planner uses to avoid repeats."),
    el("div", { class: "history-list" }, planning.weeks.map((week) =>
      el("article", { class: "card history-week" }, [
        el("h2", {}, `Week of ${week.week}`),
        el("ul", {}, (week.mealNames || []).map((name) => {
          const meal = byName.get(name);
          return el("li", {}, meal
            ? el("button", { class: "btn btn-ghost", onClick: () => go(`#/recipe/${meal.slug}`) }, name)
            : name);
        })),
      ]),
    )),
  ]);
}

function render() {
  const focusedId = document.activeElement?.id;
  const caret = document.activeElement?.selectionStart;
  const view = route.name === "plan"
    ? planView()
    : route.name === "history"
      ? historyView()
      : route.name === "recipe"
        ? recipeView()
        : recipesView();
  const overlay = lightboxOverlay();
  app.replaceChildren(nav(), el("main", {}, view), ...(overlay ? [overlay] : []));
  if (focusedId) {
    const next = document.getElementById(focusedId);
    if (next) {
      next.focus();
      if (caret != null && next.setSelectionRange) next.setSelectionRange(caret, caret);
    }
  }
}

render();
