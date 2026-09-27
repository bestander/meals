const KEY = "meal-rotation.planning";

const DEFAULTS = {
  settings: {
    mealsPerWeek: 3,
    cooldownWeeks: 4,
  },
  weeks: [],
};

export function loadPlanning() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!data) return structuredClone(DEFAULTS);
    return {
      settings: { ...DEFAULTS.settings, ...data.settings },
      weeks: data.weeks || [],
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function savePlanning(data) {
  localStorage.setItem(KEY, JSON.stringify(data));
}

export function getWeek(planning, weekDate) {
  return planning.weeks.find((w) => w.week === weekDate) || null;
}

export function upsertWeek(planning, weekEntry) {
  const idx = planning.weeks.findIndex((w) => w.week === weekEntry.week);
  if (idx >= 0) {
    planning.weeks[idx] = { ...planning.weeks[idx], ...weekEntry };
  } else {
    planning.weeks.push(weekEntry);
  }
  planning.weeks.sort((a, b) => b.week.localeCompare(a.week));
  return planning;
}

export function mealLastCooked(planning, mealName) {
  for (const week of planning.weeks) {
    if (week.mealNames?.includes(mealName)) return week.week;
  }
  return null;
}

export function weeksSince(weekDate, lastWeek) {
  if (!lastWeek) return Infinity;
  const a = new Date(`${weekDate}T00:00:00`);
  const b = new Date(`${lastWeek}T00:00:00`);
  return Math.floor((a - b) / (7 * 24 * 60 * 60 * 1000));
}
