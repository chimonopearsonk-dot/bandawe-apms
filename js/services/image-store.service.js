import { AppState } from '../core/state.js';
import { supabase } from '../core/supabase.js';
import { Events, EVT } from '../core/events.js';

/**
 * Image storage — Supabase Storage backed.
 *
 * Bucket: apms-images
 * Paths:
 *   emblem/emblem.<ext>
 *   school/<emis>/<slot>.<ext>
 *
 * URLs are written to the `images` table so we only need one query to load.
 */

const BUCKET = 'apms-images';
const MAX_BYTES = 1024 * 1024; // 1 MB
const ALLOWED_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'];

function extOf(file) {
  const ext = (file.name.split('.').pop() || 'png').toLowerCase();
  return ext === 'jpeg' ? 'jpg' : ext;
}

function publicUrl(path) {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data?.publicUrl || null;
}

function pathFromUrl(url) {
  if (!url) return null;
  const marker = `/${BUCKET}/`;
  const i = url.indexOf(marker);
  return i >= 0 ? url.slice(i + marker.length) : null;
}

async function uploadFile(path, file) {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: true, cacheControl: '31536000' });
  if (error) throw new Error('Upload failed: ' + error.message);
  return publicUrl(path);
}

async function removePath(path) {
  if (!path) return;
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error && !/not found/i.test(error.message)) {
    throw new Error('Delete failed: ' + error.message);
  }
}

async function saveImageRow(scope, ref, slot, url) {
  const row = { scope, ref, slot, url, updated_at: new Date().toISOString() };
  const { error } = await supabase.from('images').upsert(row, { onConflict: 'scope,ref,slot' });
  if (error) throw new Error('Save image row failed: ' + error.message);
}

async function deleteImageRow(scope, ref, slot) {
  await supabase.from('images').delete().eq('scope', scope).eq('ref', ref).eq('slot', slot);
}

/** Convert a public URL to a base64 data URL (used for downloaded report cards). */
export async function urlToDataUrl(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('Read failed'));
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export const ImageStoreService = {

  /* ---------- reads (from AppState) ---------- */
  getEmblem() {
    return AppState.images?.emblem || null;
  },

  getSchoolImages(emis) {
    const s = AppState.images?.schools?.[emis] || {};
    return {
      logo:        s.logo        || null,
      headSign:    s.headSign    || null,
      teacherSign: s.teacherSign || null,
      stamp:       s.stamp       || null,
    };
  },

  /* ---------- emblem ---------- */
  async setEmblemFromFile(file) {
    this._validate(file);
    const url = await uploadFile(`emblem/emblem.${extOf(file)}`, file);
    await saveImageRow('emblem', 'global', 'emblem', url);
    AppState.images.emblem = url;
    Events.emit(EVT.IMAGES_CHANGED, { scope: 'emblem' });
    return url;
  },

  async clearEmblem() {
    const current = AppState.images?.emblem;
    if (current) await removePath(pathFromUrl(current));
    await deleteImageRow('emblem', 'global', 'emblem');
    AppState.images.emblem = null;
    Events.emit(EVT.IMAGES_CHANGED, { scope: 'emblem' });
  },

  /* ---------- school images ---------- */
  async setSchoolImageFromFile(emis, key, file) {
    this._validate(file);
    if (!['logo', 'headSign', 'teacherSign', 'stamp'].includes(key)) {
      throw new Error('Unknown slot: ' + key);
    }
    const path = `school/${emis}/${key}.${extOf(file)}`;
    const url = await uploadFile(path, file);
    await saveImageRow('school', emis, key, url);

    if (!AppState.images.schools) AppState.images.schools = {};
    if (!AppState.images.schools[emis]) AppState.images.schools[emis] = {};
    AppState.images.schools[emis][key] = url;

    Events.emit(EVT.IMAGES_CHANGED, { scope: 'school', emis, key });
    return url;
  },

  async clearSchoolImage(emis, key) {
    const current = AppState.images?.schools?.[emis]?.[key];
    if (current) await removePath(pathFromUrl(current));
    await deleteImageRow('school', emis, key);
    if (AppState.images?.schools?.[emis]) {
      delete AppState.images.schools[emis][key];
    }
    Events.emit(EVT.IMAGES_CHANGED, { scope: 'school', emis, key });
  },

  /* ---------- file validation ---------- */
  _validate(file) {
    if (!file) throw new Error('No file provided.');
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const okExt = ALLOWED_EXTS.includes(ext);
    const okMime = (file.type || '').startsWith('image/');
    if (!okExt && !okMime) throw new Error('Please choose an image file.');
    if (file.size > MAX_BYTES) {
      throw new Error(`Image too large (${Math.round(file.size/1024)} KB). Max ${Math.round(MAX_BYTES/1024)} KB.`);
    }
  },
};