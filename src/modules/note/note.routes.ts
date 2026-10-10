import { Router } from 'express';
import { authRequired } from '../../middleware/auth';
import { adminOnly } from '../../middleware/admin';
import { validate } from '../../middleware/validateRequest';
import * as controller from './note.controller';
import {
  createNoteSchema,
  listNoteQuerySchema,
  noteIdParamSchema,
  updateNoteSchema,
} from './note.validation';

const router = Router();
router.use(authRequired, adminOnly);

router.get('/', validate(listNoteQuerySchema, 'query'), controller.listNotes);
router.post('/', validate(createNoteSchema), controller.createNote);
router.get('/:id', validate(noteIdParamSchema, 'params'), controller.getNote);
router.put('/:id', validate(noteIdParamSchema, 'params'), validate(updateNoteSchema), controller.updateNote);
router.delete('/:id', validate(noteIdParamSchema, 'params'), controller.removeNote);

export default router;
