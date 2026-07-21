import { r2Client } from "./lib/r2";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
async function run() {
  const command = new ListObjectsV2Command({ Bucket: process.env.R2_BUCKET_NAME });
  const res = await r2Client.send(command);
  console.log("ALL R2 KEYS:", res.Contents?.map(o => o.Key) || []);
}
run();
