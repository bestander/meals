const PROTEIN_RULES = [
  { tag: "chicken", patterns: [/chicken/i, /turkey/i] },
  { tag: "beef", patterns: [/beef/i, /steak/i] },
  { tag: "pork", patterns: [/pork/i, /bacon/i] },
  { tag: "fish", patterns: [/cod/i, /salmon/i, /fish/i, /shrimp/i] },
  { tag: "vegetarian", patterns: [/paneer/i, /chickpea/i, /lentil/i, /tofu/i, /veggie/i, /vegetable/i] },
  { tag: "egg", patterns: [/egg/i, /quiche/i] },
];

const STARCH_RULES = [
  { tag: "potato", patterns: [/potato/i, /parsnip/i] },
  { tag: "rice", patterns: [/rice/i, /couscous/i] },
  { tag: "pasta", patterns: [/pasta/i, /penne/i, /noodle/i] },
  { tag: "bread", patterns: [/baguette/i, /bread/i, /naan/i, /biscuit/i, /tortilla/i, /tostada/i] },
];

const CUISINE_RULES = [
  { tag: "thai", patterns: [/thai/i] },
  { tag: "indian", patterns: [/indian/i, /paneer/i, /naan/i, /tagine/i] },
  { tag: "mexican", patterns: [/mexican/i, /burrito/i, /chipotle/i, /tostada/i, /tortilla/i] },
  { tag: "french", patterns: [/french/i, /onion soup/i, /quiche/i] },
  { tag: "mediterranean", patterns: [/mediterranean/i, /couscous/i, /tagine/i, /chermoula/i] },
];

const STAPLES = [
  "onion", "garlic", "lemon", "lime", "butter", "olive oil",
  "soy sauce", "thyme", "parsley", "cilantro", "ginger",
  "bell pepper", "zucchini", "carrot",
];

function matchTag(text, rules) {
  for (const { tag, patterns } of rules) {
    if (patterns.some((p) => p.test(text))) return tag;
  }
  return "other";
}

function ingredientText(meal) {
  return (meal.ingredients || []).map((i) => i.name).join(" ");
}

export function deriveMetadata(meal) {
  const combined = `${meal.name} ${ingredientText(meal)}`;
  const protein = matchTag(combined, PROTEIN_RULES);
  const starch = matchTag(combined, STARCH_RULES);
  const cuisine = matchTag(meal.name, CUISINE_RULES);

  const staples = STAPLES.filter((s) =>
    (meal.ingredients || []).some((i) => i.name.toLowerCase().includes(s))
  );

  return { protein, starch, cuisine, staples };
}

export function stapleOverlap(a, b) {
  const setB = new Set(b.staples || []);
  return (a.staples || []).filter((s) => setB.has(s)).length;
}
