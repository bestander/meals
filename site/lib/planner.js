import { stapleOverlap } from "./metadata.js";
import { mealLastCooked, weeksSince } from "./storage.js";

function diversityPenalty(meal, selected) {
  let penalty = 0;
  for (const s of selected) {
    if (meal.protein === s.protein && meal.protein !== "other") penalty += 3;
    if (meal.starch === s.starch && meal.starch !== "other") penalty += 2;
    if (meal.cuisine === s.cuisine && meal.cuisine !== "other") penalty += 1;
  }
  return penalty;
}

function groupingBonus(meal, selected) {
  if (selected.length === 0) return 0;
  let bonus = 0;
  for (const s of selected) {
    bonus += stapleOverlap(meal, s) * 0.5;
  }
  return bonus;
}

function scoreMeal(meal, selected, planning, targetWeek) {
  const lastCooked = mealLastCooked(planning, meal.name);
  const weeks = weeksSince(targetWeek, lastCooked);
  const cooldown = planning.settings.cooldownWeeks;

  if (weeks < cooldown) return -Infinity;

  const rotation = weeks === Infinity ? 10 : Math.min(weeks, 12);
  const diversity = diversityPenalty(meal, selected);
  const grouping = groupingBonus(meal, selected);

  return rotation - diversity + grouping;
}

function pickCandidate(candidates, randomize) {
  if (candidates.length === 0) return null;
  if (!randomize) return candidates[0].meal;

  const best = candidates[0].score;
  const pool = candidates.filter((c) => c.score >= best - 3);
  const weights = pool.map((c) => c.score - best + 4);
  let roll = Math.random() * weights.reduce((sum, w) => sum + w, 0);
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return pool[i].meal;
  }
  return pool[pool.length - 1].meal;
}

export function suggestMeals(
  catalog,
  planning,
  targetWeek,
  count,
  excludeNames = [],
  { randomize = false } = {},
) {
  const selected = [];
  const exclude = new Set(excludeNames);
  const available = catalog.filter((m) => !exclude.has(m.name));

  for (let i = 0; i < count; i++) {
    const candidates = available
      .filter((m) => !selected.some((s) => s.name === m.name))
      .map((m) => ({ meal: m, score: scoreMeal(m, selected, planning, targetWeek) }))
      .filter((c) => c.score > -Infinity)
      .sort((a, b) => b.score - a.score);

    const pick = pickCandidate(candidates, randomize);
    if (!pick) break;
    selected.push(pick);
  }

  return selected.map((m) => m.name);
}

export function suggestReplacement(
  catalog,
  planning,
  targetWeek,
  currentNames,
  replaceIndex,
  { randomize = true } = {},
) {
  const exclude = [...currentNames];
  const count = 1;
  const names = suggestMeals(catalog, planning, targetWeek, count, exclude, { randomize });
  if (names.length === 0) return currentNames;

  const result = [...currentNames];
  result[replaceIndex] = names[0];
  return result;
}
