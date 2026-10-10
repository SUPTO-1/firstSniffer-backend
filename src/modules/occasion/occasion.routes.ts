import { Router } from 'express';
import { authRequired } from '../../middleware/auth';
import { adminOnly } from '../../middleware/admin';
import { validate } from '../../middleware/validateRequest';
import * as controller from './occasion.controller';
import {
  createOccasionSchema,
  listOccasionQuerySchema,
  occasionIdParamSchema,
  updateOccasionSchema,
} from './occasion.validation';

const router = Router();
router.use(authRequired, adminOnly);
router.get('/', validate(listOccasionQuerySchema, 'query'), controller.listOccasions);
router.post('/', validate(createOccasionSchema), controller.createOccasion);
router.get('/:id', validate(occasionIdParamSchema, 'params'), controller.getOccasion);
router.put('/:id', validate(occasionIdParamSchema, 'params'), validate(updateOccasionSchema), controller.updateOccasion);
router.delete('/:id', validate(occasionIdParamSchema, 'params'), controller.removeOccasion);

export default router;
