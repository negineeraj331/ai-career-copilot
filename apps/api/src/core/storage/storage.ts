import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../../config/env.js';

/**
 * Object storage, S3-compatible.
 *
 * The same adapter runs against MinIO locally and S3 or R2 in production —
 * there is no "works on my machine" storage path, which is the whole reason
 * docker-compose runs MinIO rather than writing to a local directory.
 *
 * Exports are never served through the API. A download link is a pre-signed URL
 * straight to the bucket, so a 2 MB PDF does not occupy a Node process for the
 * length of a slow mobile connection.
 */

let client: S3Client | undefined;

export function storage(): S3Client {
  client ??= new S3Client({
    region: env().STORAGE_REGION,
    ...(env().STORAGE_ENDPOINT ? { endpoint: env().STORAGE_ENDPOINT } : {}),
    // MinIO addresses buckets by path; AWS by virtual host. Getting this wrong
    // produces a DNS failure that reads as a network outage.
    forcePathStyle: env().STORAGE_FORCE_PATH_STYLE,
    ...(env().STORAGE_ACCESS_KEY_ID && env().STORAGE_SECRET_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: env().STORAGE_ACCESS_KEY_ID as string,
            secretAccessKey: env().STORAGE_SECRET_ACCESS_KEY as string,
          },
        }
      : {}),
  });
  return client;
}

export async function putObject(params: {
  key: string;
  body: Buffer | string;
  contentType: string;
  filename?: string;
}): Promise<void> {
  await storage().send(
    new PutObjectCommand({
      Bucket: env().STORAGE_BUCKET_EXPORTS,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
      // Forces a download with a sensible name rather than rendering the file
      // in the browser tab, which is what a user asking for a PDF expects.
      ...(params.filename
        ? { ContentDisposition: `attachment; filename="${params.filename}"` }
        : {}),
    }),
  );
}

/** A short-lived download link. Long enough to click, short enough not to leak. */
export function signedDownloadUrl(key: string, expiresInSeconds = 300): Promise<string> {
  return getSignedUrl(
    storage(),
    new GetObjectCommand({ Bucket: env().STORAGE_BUCKET_EXPORTS, Key: key }),
    { expiresIn: expiresInSeconds },
  );
}

export function closeStorage(): void {
  client?.destroy();
  client = undefined;
}
