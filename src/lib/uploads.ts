import { randomUUID } from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { supabase, unwrap } from './supabase';

export const BUCKET = 'b2b-docs';
const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 25 * 1024 * 1024;

export interface UploadedAttachment {
  id: string;
  fileName: string;
}

/**
 * Picks a document and uploads it to `<companyId>/<uuid>.<ext>` (the storage policy
 * requires the company folder), then records it in `attachments`. Returns null if cancelled.
 */
export async function pickAndUpload(opts: {
  companyId: string;
  userId: string;
  listingId?: string;
}): Promise<UploadedAttachment | null> {
  const picked = await DocumentPicker.getDocumentAsync({ type: ALLOWED, copyToCacheDirectory: true, multiple: false });
  if (picked.canceled) return null;
  const asset = picked.assets[0];
  if (!asset) return null;
  if (asset.size && asset.size > MAX_BYTES) throw new Error('File is larger than 25 MB');

  const mime = asset.mimeType ?? 'application/octet-stream';
  if (!ALLOWED.includes(mime)) throw new Error('Only PDF or image files are allowed');
  const ext = asset.name.includes('.') ? asset.name.split('.').pop()!.toLowerCase() : 'bin';
  const path = `${opts.companyId}/${randomUUID()}.${ext}`;

  const body = await (await fetch(asset.uri)).arrayBuffer();
  const { error } = await supabase.storage.from(BUCKET).upload(path, body, { contentType: mime, upsert: false });
  if (error) throw new Error(error.message);

  const row = unwrap(
    await supabase
      .from('attachments')
      .insert({
        company_id: opts.companyId,
        listing_id: opts.listingId ?? null,
        storage_path: path,
        mime_type: mime,
        file_name: asset.name,
        size_bytes: body.byteLength,
        uploaded_by: opts.userId,
      })
      .select('id, file_name')
      .single(),
  );
  return { id: row.id, fileName: row.file_name };
}

/** Short-lived signed URL for viewing a private attachment. */
export async function attachmentUrl(attachmentId: string): Promise<string> {
  const att = unwrap(await supabase.from('attachments').select('storage_path').eq('id', attachmentId).single());
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(att.storage_path, 600);
  if (error || !data) throw new Error(error?.message ?? 'Could not sign URL');
  return data.signedUrl;
}
