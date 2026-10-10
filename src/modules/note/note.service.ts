import { Note } from './note.model';
import { ApiError } from '../../utils/ApiError';
import { executePagedQuery, type PagedResult } from '../../utils/queryBuilder';
import { deleteImageKitFile } from '../imagekit/imagekit.service';
import { pickWritable } from '../_shared/pickWritable';
import type { PublicNote, NoteDoc, INote } from './note.interface';
import { NOTE_QUERY_CONFIG } from './note.interface';

export function toPublicNote(doc: NoteDoc | null): PublicNote {
  if (!doc) throw ApiError.notFound('Note not found');
  const raw = doc as unknown as Record<string, unknown> & {
    _id?: unknown;
    createdAt?: Date;
    updatedAt?: Date;
  };
  return {
    id: raw._id ? String(raw._id) : '',
    name: raw.name as string,
    slug: raw.slug as string,
    image: raw.image as string,
    imageFileId: raw.imageFileId as string,
    isActive: raw.isActive !== false,
    createdAt: raw.createdAt?.toISOString?.(),
    updatedAt: raw.updatedAt?.toISOString?.(),
  };
}

export async function createNote(input: Partial<INote>): Promise<PublicNote> {
  const doc = await Note.create(input);
  return toPublicNote(doc);
}

export function listNotes(
  queryStr: Record<string, unknown>
): Promise<PagedResult<INote>> {
  return executePagedQuery<INote>(
    Note as unknown as import('mongoose').Model<INote>,
    queryStr,
    NOTE_QUERY_CONFIG
  );
}

export async function getNoteById(id: string): Promise<PublicNote> {
  const doc = await Note.findById(id);
  return toPublicNote(doc);
}

const WRITABLE_NOTE_KEYS = [
  'name',
  'slug',
  'image',
  'imageFileId',
  'isActive',
] as const;

export async function updateNote(
  id: string,
  input: Partial<INote>
): Promise<PublicNote> {
  const set = pickWritable(
    input as Record<string, unknown>,
    WRITABLE_NOTE_KEYS
  );
  const doc = await Note.findOneAndUpdate(
    { _id: id },
    { $set: set },
    { new: true, runValidators: true, context: 'query' }
  );
  if (!doc) throw ApiError.notFound('Note not found');
  return toPublicNote(doc);
}

export async function deleteNote(id: string): Promise<PublicNote> {
  const doc = await Note.findOneAndDelete({ _id: id });
  if (!doc) throw ApiError.notFound('Note not found');
  const publicDoc = toPublicNote(doc);
  if (doc.imageFileId) void deleteImageKitFile(doc.imageFileId);
  return publicDoc;
}