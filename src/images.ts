import { createStore, get } from "idb-keyval";
import { requireSupabase } from "./supabase";

const imageStore = createStore("thought-board-images", "images");
const BUCKET = "thoughtboard-images";
export const ATTACHMENT_PATTERN = /^attachment:[0-9a-f-]{36}$/i;
export const CLOUD_IMAGE_PATTERN =
  /^cloud-image:[0-9a-f-]{36}\/[0-9a-f-]{36}$/i;

function validateImage(blob: Blob) {
  if (
    !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(blob.type)
  )
    throw new Error("Choose a PNG, JPEG, WebP, or GIF image.");
  if (blob.size > 5 * 1024 * 1024)
    throw new Error("Choose an image smaller than 5 MB.");
}

async function uploadBlob(
  blob: Blob,
  userId: string,
  imageId: string,
  allowExisting = false,
): Promise<string> {
  validateImage(blob);
  const path = `${userId}/${imageId}`;
  const storage = requireSupabase().storage.from(BUCKET);
  const { error } = await storage.upload(path, blob, {
    contentType: blob.type,
    upsert: false,
  });
  if (error) {
    if (
      !allowExisting ||
      !(
        String(error.statusCode) === "409" ||
        /already exists/i.test(error.message)
      )
    )
      throw new Error(error.message);
    // A retry can reuse a prior successful immutable upload, but must be readable.
    const check = await storage.download(path);
    if (check.error) throw new Error(check.error.message);
  }
  return `cloud-image:${path}`;
}

export async function saveImage(file: File): Promise<string> {
  const { data, error } = await requireSupabase().auth.getSession();
  if (error) throw new Error(error.message);
  if (!data.session)
    throw new Error("Sign in again before uploading an image.");
  return uploadBlob(file, data.session.user.id, crypto.randomUUID());
}

export async function loadImage(source: string): Promise<Blob | undefined> {
  if (ATTACHMENT_PATTERN.test(source))
    return get<Blob>(source.slice("attachment:".length), imageStore);
  if (!CLOUD_IMAGE_PATTERN.test(source))
    throw new Error("Invalid image reference.");
  const { data, error } = await requireSupabase()
    .storage.from(BUCKET)
    .download(source.slice("cloud-image:".length));
  if (error) throw new Error(error.message);
  return data;
}

export async function migrateLocalImages(
  content: string,
  userId: string,
): Promise<string> {
  const sources = [
    ...new Set(content.match(/attachment:[0-9a-f-]{36}/gi) ?? []),
  ];
  let migrated = content;
  for (const source of sources) {
    const blob = await loadImage(source);
    if (!blob)
      throw new Error(
        "A referenced local image is missing. This note was not imported; your local copy is unchanged.",
      );
    const remote = await uploadBlob(
      blob,
      userId,
      source.slice("attachment:".length),
      true,
    );
    migrated = migrated.split(source).join(remote);
  }
  return migrated;
}
