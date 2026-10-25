import { randomUUID } from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { supabase, unwrap } from './supabase';

export const BUCKET = 'b2b-docs';
export const MAX_ATTACHMENTS = 8;
export const MAX_DOC_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_EDGE = 1600;

const DOC_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

/** A file chosen on the device but not uploaded yet. */
export interface LocalFile {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
  isImage: boolean;
}

export interface UploadedAttachment {
  id: string;
  fileName: string;
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Downscale and re-encode as JPEG so phone photos (often 4–8 MB) upload as a few hundred KB. */
async function compress(asset: ImagePicker.ImagePickerAsset): Promise<LocalFile> {
  const longEdge = Math.max(asset.width, asset.height);
  const ctx = ImageManipulator.manipulate(asset.uri);
  if (longEdge > MAX_IMAGE_EDGE) {
    ctx.resize(asset.width >= asset.height ? { width: MAX_IMAGE_EDGE } : { height: MAX_IMAGE_EDGE });
  }
  const image = await ctx.renderAsync();
  const out = await image.saveAsync({ compress: 0.7, format: SaveFormat.JPEG });
  const size = (await (await fetch(out.uri)).blob()).size;
  if (size > MAX_IMAGE_BYTES) throw new Error(`Photo is still ${mb(size)} after compression (max ${mb(MAX_IMAGE_BYTES)}).`);
  return { uri: out.uri, name: `photo-${Date.now()}.jpg`, mimeType: 'image/jpeg', size, isImage: true };
}

/** Pick up to `limit` photos from the library (or one from the camera), compressed. */
export async function pickImages(limit: number, source: 'library' | 'camera' = 'library'): Promise<LocalFile[]> {
  if (limit <= 0) return [];
  const permission =
    source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error(`Allow ${source === 'camera' ? 'camera' : 'photo'} access in Settings to add pictures.`);

  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, exif: false };
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync({ ...options, allowsMultipleSelection: true, selectionLimit: limit });
  if (result.canceled) return [];
  const files: LocalFile[] = [];
  for (const asset of result.assets.slice(0, limit)) files.push(await compress(asset));
  return files;
}

/** Pick one PDF / Office document / image file, up to 10 MB. */
export async function pickDocument(): Promise<LocalFile | null> {
  const picked = await DocumentPicker.getDocumentAsync({ type: DOC_TYPES, copyToCacheDirectory: true, multiple: false });
  if (picked.canceled) return null;
  const asset = picked.assets[0];
  if (!asset) return null;
  const mimeType = asset.mimeType ?? 'application/octet-stream';
  if (!DOC_TYPES.includes(mimeType)) throw new Error('Use a PDF, Word, Excel or image file.');
  const size = asset.size ?? 0;
  if (size > MAX_DOC_BYTES) throw new Error(`${asset.name} is ${mb(size)}; the limit is ${mb(MAX_DOC_BYTES)}.`);
  return { uri: asset.uri, name: asset.name, mimeType, size, isImage: mimeType.startsWith('image/') };
}

/** Upload to `<companyId>/<uuid>.<ext>` (the storage policy requires the company folder) and record it. */
export async function uploadFile(
  file: LocalFile,
  opts: { companyId: string; userId: string; listingId?: string; sortOrder?: number },
): Promise<UploadedAttachment> {
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : 'bin';
  const path = `${opts.companyId}/${randomUUID()}.${ext}`;
  const body = await (await fetch(file.uri)).arrayBuffer();
  if (body.byteLength > MAX_DOC_BYTES) throw new Error(`${file.name} is larger than ${mb(MAX_DOC_BYTES)}.`);

  const { error } = await supabase.storage.from(BUCKET).upload(path, body, { contentType: file.mimeType, upsert: false });
  if (error) throw new Error(error.message);

  const row = unwrap(
    await supabase
      .from('attachments')
      .insert({
        company_id: opts.companyId,
        listing_id: opts.listingId ?? null,
        storage_path: path,
        mime_type: file.mimeType,
        file_name: file.name,
        size_bytes: body.byteLength,
        uploaded_by: opts.userId,
        sort_order: opts.sortOrder ?? 0,
      })
      .select('id, file_name')
      .single(),
  );
  return { id: row.id, fileName: row.file_name };
}

/** Pick a document and upload it in one step (invoices, proof of delivery). */
export async function pickAndUpload(opts: { companyId: string; userId: string; listingId?: string }): Promise<UploadedAttachment | null> {
  const file = await pickDocument();
  return file ? uploadFile(file, opts) : null;
}

/** Short-lived signed URL for viewing a private attachment. */
export async function attachmentUrl(attachmentId: string): Promise<string> {
  const att = unwrap(await supabase.from('attachments').select('storage_path').eq('id', attachmentId).single());
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(att.storage_path, 600);
  if (error || !data) throw new Error(error?.message ?? 'Could not sign URL');
  return data.signedUrl;
}

export const formatBytes = mb;
