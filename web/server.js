import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { loadCatalog, getMealBySlug, writeCurrentWeek } from "./lib/catalog.js";
import { loadPlanning, savePlanning, getWeek, upsertWeek, mealLastCooked, weeksSince } from "./lib/storage.js";
import { suggestMeals, suggestReplacement } from "./lib/planner.js";
import { getSessionStatus, runAuthLogin, runResolve, runFinish, runSearchOne } from "./lib/amazon.js";
import { listCropImages, imagePath, warpImage, saveWarpedImage } from "./lib/crop.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(__dirname, "public");
const IMAGES_DIR = path.join(ROOT, "recipes", "images");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(PUBLIC));

function nextMonday(from = new Date()) {
  const d = new Date(from);
  const day = d.getDay();
  const daysUntil = day === 0 ? 1 : day === 1 ? 7 : 8 - day;
  d.setDate(d.getDate() + daysUntil);
  return d.toISOString().slice(0, 10);
}

function enrichWeek(week, planning, catalog) {
  const meals = (week.mealNames || []).map((name) => {
    const meal = catalog.find((m) => m.name === name);
    const lastWeek = mealLastCooked(
      { weeks: planning.weeks.filter((w) => w.week !== week.week) },
      name
    );
    return {
      name,
      slug: meal?.slug,
      protein: meal?.protein,
      starch: meal?.starch,
      cuisine: meal?.cuisine,
      weeksSinceCooked: weeksSince(week.week, lastWeek),
      images: meal?.images,
    };
  });
  return { ...week, meals };
}

// --- API ---

app.get("/api/settings", (_req, res) => {
  res.json(loadPlanning().settings);
});

app.put("/api/settings", (req, res) => {
  const planning = loadPlanning();
  planning.settings = { ...planning.settings, ...req.body };
  savePlanning(planning);
  res.json(planning.settings);
});

app.get("/api/catalog", (_req, res) => {
  const catalog = loadCatalog();
  res.json(
    catalog.map(({ slug, name, protein, starch, cuisine, staples, images, servings, sourceWeek }) => ({
      slug, name, protein, starch, cuisine, staples, images, servings, sourceWeek,
    }))
  );
});

app.get("/api/recipes/:slug", (req, res) => {
  const meal = getMealBySlug(req.params.slug);
  if (!meal) return res.status(404).json({ error: "Recipe not found" });
  res.json(meal);
});

app.get("/api/images/:slug/:type", (req, res) => {
  const { slug, type } = req.params;
  if (!["ingredients", "instructions", "dish"].includes(type)) {
    return res.status(400).json({ error: "Invalid image type" });
  }
  const filePath = path.join(IMAGES_DIR, `${slug}-${type}.jpg`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Image not found" });
  res.sendFile(filePath);
});

app.get("/api/weeks", (_req, res) => {
  const planning = loadPlanning();
  const catalog = loadCatalog();
  res.json({
    settings: planning.settings,
    weeks: planning.weeks.map((w) => enrichWeek(w, planning, catalog)),
    upcoming: nextMonday(),
  });
});

app.get("/api/weeks/:date", (req, res) => {
  const planning = loadPlanning();
  const catalog = loadCatalog();
  const week = getWeek(planning, req.params.date);
  if (!week) return res.status(404).json({ error: "Week not found" });
  res.json(enrichWeek(week, planning, catalog));
});

app.post("/api/weeks/:date/suggest", (req, res) => {
  const planning = loadPlanning();
  const catalog = loadCatalog();
  const count = req.body.count || planning.settings.mealsPerWeek;
  const randomize = Boolean(req.body.randomize);
  const names = suggestMeals(catalog, planning, req.params.date, count, [], { randomize });
  res.json({ mealNames: names });
});

app.post("/api/weeks/:date/suggest-replace", (req, res) => {
  const planning = loadPlanning();
  const catalog = loadCatalog();
  const { mealNames, replaceIndex } = req.body;
  const names = suggestReplacement(catalog, planning, req.params.date, mealNames, replaceIndex);
  res.json({ mealNames: names });
});

app.put("/api/weeks/:date", (req, res) => {
  const planning = loadPlanning();
  const { mealNames, status } = req.body;
  const entry = {
    week: req.params.date,
    mealNames,
    status: status || "planned",
    updatedAt: new Date().toISOString(),
  };
  const existing = getWeek(planning, req.params.date);
  if (!existing) entry.createdAt = entry.updatedAt;
  upsertWeek(planning, entry);

  if (mealNames?.length) {
    writeCurrentWeek(req.params.date, mealNames);
  }

  savePlanning(planning);
  const catalog = loadCatalog();
  res.json(enrichWeek(getWeek(planning, req.params.date), planning, catalog));
});

app.get("/api/amazon/status", (_req, res) => {
  res.json(getSessionStatus());
});

const activeJobs = new Map();

function splitResolved(resolved) {
  const autoItems = [];
  const reviewItems = [];
  const unavailableItems = [];
  for (const item of resolved || []) {
    if (item.status === "auto") autoItems.push(item);
    else if (item.status === "review") reviewItems.push(item);
    else if (item.status === "unavailable") unavailableItems.push(item);
  }
  return { autoItems, reviewItems, unavailableItems };
}

async function runPurchaseJob(jobId, week, mealNames, checkout) {
  const job = activeJobs.get(jobId);
  job.phase = "resolving";
  job.progress = { phase: "starting", current: 0, total: 0 };

  try {
    const { result } = await runResolve((event) => {
      if (event.type === "progress") {
        job.progress = event;
      }
      if (event.type === "log") {
        job.log.push({ stream: event.stream, text: event.text, at: new Date().toISOString() });
      }
    });

    job.meals = result.meals;
    job.resolved = result.resolved;
    const { autoItems, reviewItems, unavailableItems } = splitResolved(result.resolved);
    job.autoItems = autoItems;
    job.reviewItems = reviewItems;
    job.unavailableItems = unavailableItems;
    job.phase = "approval";
    job.message = "Review matched items and confirm your order.";
  } catch (err) {
    job.phase = "error";
    job.error = err.message;
    job.done = true;
  }
}

async function finishPurchaseJob(jobId, approval, checkout, week, mealNames) {
  const job = activeJobs.get(jobId);
  job.phase = "cart";
  job.message = "Building cart…";

  try {
    const { code, result } = await runFinish(
      {
        resolved: job.resolved,
        skippedAuto: approval.skippedAuto || [],
        reviewPicks: approval.reviewPicks || {},
      },
      checkout,
      (event) => {
        if (event.type === "progress") {
          job.progress = event;
          job.message = event.message || job.message;
        }
        if (event.type === "log") {
          job.log.push({ stream: event.stream, text: event.text, at: new Date().toISOString() });
        }
      },
    );

    job.phase = "done";
    job.done = true;
    job.result = { code, cart: result };

    if (code === 0) {
      const p = loadPlanning();
      const existing = getWeek(p, week);
      upsertWeek(p, {
        week,
        mealNames,
        status: "ordered",
        orderedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdAt: existing?.createdAt || new Date().toISOString(),
      });
      savePlanning(p);
    }
  } catch (err) {
    job.phase = "error";
    job.error = err.message;
    job.done = true;
  }
}

app.post("/api/amazon/auth", async (_req, res) => {
  const jobId = `auth-${Date.now()}`;
  const log = [];
  activeJobs.set(jobId, { type: "auth", log, done: false });

  res.json({ jobId, message: "Browser will open for Amazon login. Close it when done." });

  runAuthLogin((stream, text) => {
    log.push({ stream, text, at: new Date().toISOString() });
  }).then((result) => {
    activeJobs.set(jobId, { type: "auth", log, done: true, result });
  });
});

app.post("/api/purchase/run", async (req, res) => {
  const planning = loadPlanning();
  let week = req.body?.week;
  let mealNames = req.body?.mealNames;

  if (!week || !mealNames?.length) {
    const current = planning.weeks
      .filter((w) => w.mealNames?.length)
      .sort((a, b) => (b.updatedAt || b.week).localeCompare(a.updatedAt || a.week))[0];
    if (!current?.mealNames?.length) {
      return res.status(400).json({ error: "No meals selected for this week." });
    }
    week = current.week;
    mealNames = current.mealNames;
  }

  writeCurrentWeek(week, mealNames);

  const jobId = `purchase-${Date.now()}`;
  const checkout = req.body?.checkout === true;
  const job = {
    type: "purchase",
    phase: "resolving",
    log: [],
    done: false,
    week,
    mealNames,
    checkout,
    progress: null,
    resolved: null,
    autoItems: [],
    reviewItems: [],
    unavailableItems: [],
    meals: [],
    message: "Resolving ingredients…",
  };
  activeJobs.set(jobId, job);

  res.json({
    jobId,
    week,
    meals: mealNames,
    message: "Resolving ingredients…",
  });

  runPurchaseJob(jobId, week, mealNames, checkout);
});

app.post("/api/purchase/jobs/:id/approve", async (req, res) => {
  const job = activeJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (job.phase !== "approval") {
    return res.status(400).json({ error: "Job is not awaiting approval" });
  }

  if (req.body.action === "cancel") {
    job.phase = "done";
    job.done = true;
    job.cancelled = true;
    job.message = "Order cancelled.";
    return res.json(job);
  }

  const reviewItems = job.reviewItems || [];
  const reviewPicks = req.body.reviewPicks || {};
  const missing = reviewItems.filter((item) => reviewPicks[String(item.index)] === undefined);
  if (missing.length) {
    return res.status(400).json({
      error: `Pick or skip all review items (${missing.length} remaining).`,
    });
  }

  res.json({ ...job, phase: "cart", message: "Building cart…" });
  finishPurchaseJob(
    req.params.id,
    {
      skippedAuto: req.body.skippedAuto || [],
      reviewPicks,
    },
    job.checkout,
    job.week,
    job.mealNames,
  );
});

app.post("/api/purchase/jobs/:id/retry", async (req, res) => {
  const job = activeJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (job.phase !== "approval") {
    return res.status(400).json({ error: "Can only retry search during approval" });
  }

  const { index } = req.body;
  const item = job.resolved?.find((r) => r.index === index);
  if (!item) return res.status(404).json({ error: "Ingredient not found" });

  try {
    const { result } = await runSearchOne(item.name);
    item.candidates = result.candidates || [];
    const review = job.reviewItems.find((r) => r.index === index);
    if (review) review.candidates = item.candidates;
    res.json({ candidates: item.candidates, item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/jobs/:id", (req, res) => {
  const job = activeJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

app.get("/api/crop/images", (_req, res) => {
  res.json(listCropImages());
});

app.get("/api/crop/source", (req, res) => {
  const name = req.query.name;
  if (!name) return res.status(400).json({ error: "name query param required" });
  try {
    res.sendFile(imagePath(name));
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.post("/api/crop/preview", (req, res) => {
  const { name, corners } = req.body;
  if (!name || !Array.isArray(corners) || corners.length !== 4) {
    return res.status(400).json({ error: "name and four corners required" });
  }
  const tmp = path.join(os.tmpdir(), `crop-preview-${Date.now()}.jpg`);
  try {
    warpImage(imagePath(name), tmp, corners);
    res.sendFile(tmp, () => fs.unlink(tmp, () => {}));
  } catch (e) {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/crop/save", (req, res) => {
  const { name, corners } = req.body;
  if (!name || !Array.isArray(corners) || corners.length !== 4) {
    return res.status(400).json({ error: "name and four corners required" });
  }
  try {
    saveWarpedImage(name, corners);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "API route not found" });
  }
  res.sendFile(path.join(PUBLIC, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Meal Rotation UI: http://localhost:${PORT}`);
});
