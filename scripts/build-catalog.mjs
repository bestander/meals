import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadCatalog } from "../web/lib/catalog.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalogDir = path.join(root, "recipes", "catalog");
const siteDir = path.join(root, "site");
const siteLib = path.join(siteDir, "lib");

function imageUrl(slug, type) {
  const file = path.join(root, "recipes", "images", `${slug}-${type}.jpg`);
  if (!fs.existsSync(file)) return null;
  return `../recipes/images/${slug}-${type}.jpg`;
}

const catalog = loadCatalog().map(({ images, ...meal }) => ({
  ...meal,
  images: {
    ingredients: imageUrl(meal.slug, "ingredients"),
    instructions: imageUrl(meal.slug, "instructions"),
    dish: imageUrl(meal.slug, "dish"),
  },
}));

fs.mkdirSync(catalogDir, { recursive: true });
fs.mkdirSync(siteLib, { recursive: true });

for (const file of fs.readdirSync(catalogDir)) {
  if (file.endsWith(".json")) fs.unlinkSync(path.join(catalogDir, file));
}

for (const meal of catalog) {
  fs.writeFileSync(
    path.join(catalogDir, `${meal.slug}.json`),
    `${JSON.stringify(meal, null, 2)}\n`,
  );
}

const index = {
  recipes: catalog.map(({ slug, name, servings, protein, starch, cuisine, staples, sourceWeek, images }) => ({
    slug,
    name,
    servings,
    protein,
    starch,
    cuisine,
    staples,
    sourceWeek,
    images,
    file: `${slug}.json`,
  })),
};
fs.writeFileSync(path.join(catalogDir, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
fs.writeFileSync(path.join(siteDir, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);

for (const name of ["planner.js", "metadata.js"]) {
  fs.copyFileSync(path.join(root, "web", "lib", name), path.join(siteLib, name));
}

console.log(`Wrote ${catalog.length} recipes to recipes/catalog and site/catalog.json`);
