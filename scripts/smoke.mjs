import { listProject, slugify } from "../dist/wt.js";

const { mainVersion, tasks } = await listProject({ cwd: process.argv[2] });
console.log(JSON.stringify({ mainVersion, count: tasks.length, tasks }, null, 2));
console.log("slug:", slugify("Add login modal!! v2"));
