import { listObjectsWithPrefix } from "./lib/r2";
async function run() {
  const objs = await listObjectsWithPrefix("room-111110");
  console.log("R2 KEYS:", objs?.map(o => o.Key) || []);
}
run();
