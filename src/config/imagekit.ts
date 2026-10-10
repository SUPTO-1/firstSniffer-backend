import dotenv from 'dotenv';
import path from 'path';

// ImageKit credentials — already present in backend/.env (see IMAGEKIT_PUBLIC_KEY, IMAGEKIT_PRIVATE_KEY, IMAGEKIT_URL_ENDPOINT).
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function readString(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

export const imagekitConfig = {
  publicKey: readString('IMAGEKIT_PUBLIC_KEY'),
  privateKey: readString('IMAGEKIT_PRIVATE_KEY'),
  urlEndpoint: readString('IMAGEKIT_URL_ENDPOINT'),
};
