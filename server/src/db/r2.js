/**
 * Cloudflare R2 storage helper (S3-compatible API)
 *
 * Required env vars:
 *   R2_ACCOUNT_ID       — Cloudflare account ID
 *   R2_ACCESS_KEY_ID    — R2 API token access key
 *   R2_SECRET_ACCESS_KEY— R2 API token secret key
 *   R2_BUCKET           — bucket name (default: paperphone)
 *   R2_PUBLIC_URL       — public base URL for the bucket, e.g.
 *                         https://pub-xxxx.r2.dev  (R2.dev subdomain)
 *                         or https://files.yourdomain.com  (custom domain)
 */
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const BUCKET = process.env.R2_BUCKET || 'paperphone';

let _client = null;
function getClient() {
  if (!_client) {
    const accountId = process.env.R2_ACCOUNT_ID;
    if (!accountId) throw new Error('R2_ACCOUNT_ID is not set');
    _client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
      },
    });
  }
  return _client;
}

/**
 * Upload a file buffer to R2.
 * @returns {string} Public URL for the uploaded file
 */
async function uploadFile(objectName, buffer, mimetype) {
  const client = getClient();
  await client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: objectName,
    Body: buffer,
    ContentType: mimetype,
    // CacheControl for CDN
    CacheControl: 'public, max-age=31536000, immutable',
  }));

  // If a public URL base is configured, use it directly (fastest)
  if (process.env.R2_PUBLIC_URL) {
    return `${process.env.R2_PUBLIC_URL.replace(/\/$/, '')}/${objectName}`;
  }

  // Otherwise fall back to a signed URL (valid for 7 days)
  return getSignedUrl(client, new GetObjectCommand({ Bucket: BUCKET, Key: objectName }), {
    expiresIn: 60 * 60 * 24 * 7,
  });
}

/**
 * Get a readable stream for an object (used by the /api/files proxy fallback).
 */
async function getObjectStream(objectName) {
  const client = getClient();
  const res = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: objectName }));
  return { stream: res.Body, contentType: res.ContentType, contentLength: res.ContentLength };
}

module.exports = { uploadFile, getObjectStream, BUCKET };
