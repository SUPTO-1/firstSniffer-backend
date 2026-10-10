import ImageKit from 'imagekit';
import { imagekitConfig } from '../../config/imagekit';

// Singleton ImageKit SDK instance shared by the auth endpoint and the
// file-delete helper. Created once at module load.
const ik = new ImageKit({
  publicKey: imagekitConfig.publicKey,
  privateKey: imagekitConfig.privateKey,
  urlEndpoint: imagekitConfig.urlEndpoint,
});

export interface ImageKitAuthTriplet {
  token: string;
  expire: number;
  signature: string;
  publicKey: string;
}

/**
 * Mint a fresh auth triplet on every call.
 *
 * Why no cache: ImageKit treats the `token` field as a single-use upload
 * credential. Reusing the same token for two uploads within the TTL window
 * is rejected as a replay attempt, surfacing as a confusing
 * "Image is required" / "token has been used before" failure on the second
 * image. The signing cost is one HMAC over a small payload — trivial
 * relative to the upload itself — so we always pay it.
 *
 * (Earlier we cached the triplet for 25min; that was the bug.)
 */
export function getImageKitAuth(): ImageKitAuthTriplet {
  const params = ik.getAuthenticationParameters();
  return {
    token: params.token,
    expire: params.expire,
    signature: params.signature,
    publicKey: imagekitConfig.publicKey,
  };
}

/** Best-effort file deletion — never throws so callers can fire-and-forget. */
export async function deleteImageKitFile(fileId: string): Promise<void> {
  try {
    await ik.deleteFile(fileId);
  } catch {
    // intentional: storage cleanup must not fail user-facing operations
  }
}