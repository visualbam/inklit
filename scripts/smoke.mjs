import { listTasks, slugify } from "../dist/wt.js";

const tasks = await listTasks({ cwd: process.argv[2] });
console.log(JSON.stringify({ count: tasks.length, tasks }, null, 2));
console.log("slug:", slugify("Add login modal!! v2"));
