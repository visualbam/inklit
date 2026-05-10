// Smoke-test the state file: spawn → read → resume → read → remove → read.
import { recordSpawn, recordResume, recordRemove, getAgent, loadAll } from "../dist/state.js";

const slug = "smoke-state-test";

await recordSpawn(slug, "claude");
console.log("after spawn:", await getAgent(slug));

await recordResume(slug, "claude");
const all = await loadAll();
console.log("after resume:", JSON.stringify(all[slug]));

await recordRemove(slug);
console.log("after remove:", await getAgent(slug));
