// Smoke-test the state file: spawn -> read -> resume -> prefs -> remove.
import {
  recordSpawn,
  recordResume,
  recordRemove,
  getAgent,
  loadAll,
  recordListDensity,
  loadUiPrefs,
} from "../dist/state.js";

const slug = "smoke-state-test";

await recordSpawn(slug, "claude");
console.log("after spawn:", await getAgent(slug));

await recordResume(slug, "claude");
const all = await loadAll();
console.log("after resume:", JSON.stringify(all[slug]));

await recordListDensity("compact");
console.log("after density:", JSON.stringify(await loadUiPrefs()));

await recordRemove(slug);
console.log("after remove:", await getAgent(slug));
