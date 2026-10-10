import { Router } from 'express';
import { authRequired } from '../../middleware/auth';
import { adminOnly } from '../../middleware/admin';
import { validate } from '../../middleware/validateRequest';
import * as controller from './atomizer.controller';
import {
  atomizerIdParamSchema,
  createAtomizerSchema,
  listAtomizerQuerySchema,
  updateAtomizerSchema,
} from './atomizer.validation';

const router = Router();
router.use(authRequired, adminOnly);
router.get('/', validate(listAtomizerQuerySchema, 'query'), controller.listAtomizers);
router.post('/', validate(createAtomizerSchema), controller.createAtomizer);
router.get('/:id', validate(atomizerIdParamSchema, 'params'), controller.getAtomizer);
router.put('/:id', validate(atomizerIdParamSchema, 'params'), validate(updateAtomizerSchema), controller.updateAtomizer);
router.delete('/:id', validate(atomizerIdParamSchema, 'params'), controller.removeAtomizer);

export default router;