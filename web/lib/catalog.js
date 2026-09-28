import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { slugify } from "./slugify.js";
import { deriveMetadata } from "./metadata.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const RECIPES_DIR = path.join(ROOT, "recipes");
const IMAGES_DIR = path.join(RECIPES_DIR, "images");

function richness(meal) {
  let score = 0;
  if (meal.instructions?.length) score += meal.instructions.length;
  if (meal.nutrition) score += 5;
  if (meal.ingredients?.length) score += meal.ingredients.length;
  return score;
}

function imageExists(slug, type) {
  return fs.existsSync(path.join(IMAGES_DIR, `${slug}-${type}.jpg`));
}

export function loadCatalog() {
  const files = fs
    .readdirSync(RECIPES_DIR)
    .filter((f) => f.startsWith("week-") && f.endsWith(".json"))
    .sort();

  const bySlug = new Map();

  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(RECIPES_DIR, file), "utf8"));
    for (const meal of data.meals || []) {
      const slug = slugify(meal.name);
      const enriched = {
        ...meal,
        slug,
        sourceWeek: data.week,
        ...deriveMetadata(meal),
        images: {
          ingredients: imageExists(slug, "ingredients"),
          instructions: imageExists(slug, "instructions"),
          dish: imageExists(slug, "dish"),
        },
      };

      const existing = bySlug.get(slug);
      if (!existing || richness(enriched) > richness(existing)) {
        bySlug.set(slug, enriched);
      }
    }
  }

  return [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function getMealBySlug(slug) {
  return loadCatalog().find((m) => m.slug === slug) || null;
}

export function writeCurrentWeek(weekDate, mealNames) {
  const catalog = loadCatalog();
  const byName = new Map(catalog.map((m) => [m.name, m]));
  const meals = mealNames.map((name) => {
    const meal = byName.get(name);
    if (!meal) throw new Error(`Unknown meal: ${name}`);
    const { slug, sourceWeek, protein, starch, cuisine, staples, images, ...rest } = meal;
    return rest;
  });

  const out = { week: weekDate, meals };
  const outPath = path.join(RECIPES_DIR, "current-week.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  return outPath;
}
