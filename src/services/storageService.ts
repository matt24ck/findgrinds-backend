import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const ALLOWED_CONTENT_TYPES: Record<string, string[]> = {
  profiles: ['image/jpeg', 'image/png', 'image/webp'],
  documents: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  resources: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'video/mp4'],
};

const MAX_FILE_SIZES: Record<string, number> = {
  profiles: 5 * 1024 * 1024,       // 5MB
  documents: 10 * 1024 * 1024,     // 10MB
  resources: 100 * 1024 * 1024,    // 100MB
};

function getS3Client(): S3Client {
  return new S3Client({
    endpoint: process.env.AWS_ENDPOINT_URL,
    region: process.env.AWS_DEFAULT_REGION || 'auto',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    },
    forcePathStyle: true,
  });
}

function getBucketName(): string {
  return process.env.AWS_S3_BUCKET_NAME || '';
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase();
}

export type StorageFolder = 'profiles' | 'documents' | 'resources';

export function validateUpload(folder: StorageFolder, contentType: string, fileSize?: number): string | null {
  const allowed = ALLOWED_CONTENT_TYPES[folder];
  if (!allowed || !allowed.includes(contentType)) {
    return `Invalid file type for ${folder}. Allowed: ${allowed?.join(', ')}`;
  }
  if (fileSize) {
    const maxSize = MAX_FILE_SIZES[folder];
    if (fileSize > maxSize) {
      return `File too large. Maximum size for ${folder}: ${maxSize / (1024 * 1024)}MB`;
    }
  }
  return null;
}

export async function getUploadUrl(
  folder: StorageFolder,
  fileName: string,
  contentType: string,
  userId: string
): Promise<{ uploadUrl: string; key: string }> {
  const client = getS3Client();
  const sanitized = sanitizeFileName(fileName);
  const key = `${folder}/${userId}/${Date.now()}-${sanitized}`;

  const command = new PutObjectCommand({
    Bucket: getBucketName(),
    Key: key,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(client, command, { expiresIn: 600 }); // 10 minutes

  return { uploadUrl, key };
}

export async function getDownloadUrl(key: string, expiresIn = 86400): Promise<string> {
  const client = getS3Client();

  const command = new GetObjectCommand({
    Bucket: getBucketName(),
    Key: key,
  });

  return getSignedUrl(client, command, { expiresIn });
}

export async function deleteObject(key: string): Promise<void> {
  const client = getS3Client();

  const command = new DeleteObjectCommand({
    Bucket: getBucketName(),
    Key: key,
  });

  await client.send(command);
}

export async function resolveUrl(value: string | null | undefined, expiresIn = 86400): Promise<string | null> {
  if (!value) return null;
  if (value.startsWith('http')) return value; // backward compat: legacy full URLs
  return getDownloadUrl(value, expiresIn);
}
