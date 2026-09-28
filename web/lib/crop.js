import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const IMAGES_DIR = path.join(ROOT, "recipes", "images");
const WARP_SCRIPT = path.join(ROOT, "recipes", "warp_corners.py");
const PYTHON = path.join(ROOT, ".venv", "bin", "python");

export function listCropImages() {
  return fs
    .readdirSync(IMAGES_DIR)
    .filter((f) => f.endsWith(".jpg") && !f.startsWith("_") && !f.endsWith("-dish.jpg"))
    .sort()
    .map((name) => ({ name }));
}

export function imagePath(name) {
  if (!/^[a-z0-9-]+\.jpg$/.test(name)) {
    throw new Error("Invalid filename");
  }
  const filePath = path.join(IMAGES_DIR, name);
  if (!fs.existsSync(filePath)) throw new Error("Image not found");
  return filePath;
}

export function warpImage(source, output, corners) {
  const result = spawnSync(PYTHON, [WARP_SCRIPT], {
    input: JSON.stringify({ input: source, output, corners }),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || "Warp failed");
  }
}

export function saveWarpedImage(name, corners) {
  const dest = imagePath(name);
  const tmp = path.join(IMAGES_DIR, `_tmp_${name}`);
  try {
    warpImage(dest, tmp, corners);
    fs.renameSync(tmp, dest);
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}
