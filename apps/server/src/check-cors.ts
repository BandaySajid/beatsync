import { S3Client, GetBucketCorsCommand, PutBucketCorsCommand } from "@aws-sdk/client-s3";

async function check() {
  const S3_CONFIG = {
    BUCKET_NAME: process.env.S3_BUCKET_NAME!,
    ENDPOINT: process.env.S3_ENDPOINT!,
    ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID!,
    SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY!,
  };

  const r2Client = new S3Client({
    region: "auto",
    endpoint: S3_CONFIG.ENDPOINT,
    credentials: {
      accessKeyId: S3_CONFIG.ACCESS_KEY_ID,
      secretAccessKey: S3_CONFIG.SECRET_ACCESS_KEY,
    },
  });

  const bucket = S3_CONFIG.BUCKET_NAME;
  try {
    const cors = await r2Client.send(new GetBucketCorsCommand({ Bucket: bucket }));
    console.log("CORS RULES BEFORE:", JSON.stringify(cors.CORSRules, null, 2));
  } catch (e) {
    console.error("Error getting CORS (might not be set):", e);
  }

  try {
    await r2Client.send(
      new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedHeaders: ["*"],
              AllowedMethods: ["GET", "PUT", "POST", "DELETE", "HEAD"],
              AllowedOrigins: ["*"],
              ExposeHeaders: ["ETag"],
              MaxAgeSeconds: 3000,
            },
          ],
        },
      })
    );
    console.log("Updated CORS to allow * !");
  } catch (e) {
    console.error("Error setting CORS:", e);
  }
}
check();
