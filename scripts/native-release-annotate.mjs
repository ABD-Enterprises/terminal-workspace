import fs from "node:fs";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeValue(current, patch) {
  if (patch === undefined) {
    return current;
  }

  if (Array.isArray(patch)) {
    return patch.slice();
  }

  if (isPlainObject(current) && isPlainObject(patch)) {
    const merged = { ...current };
    for (const [key, value] of Object.entries(patch)) {
      merged[key] = mergeValue(current[key], value);
    }
    return merged;
  }

  return patch;
}

const [manifestPath, patchPath] = process.argv.slice(2);

if (!manifestPath || !patchPath) {
  throw new Error("Usage: node native-release-annotate.mjs <manifest-path> <patch-path>");
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const patch = JSON.parse(fs.readFileSync(patchPath, "utf8"));
const merged = mergeValue(manifest, patch);

fs.writeFileSync(manifestPath, `${JSON.stringify(merged, null, 2)}\n`);
