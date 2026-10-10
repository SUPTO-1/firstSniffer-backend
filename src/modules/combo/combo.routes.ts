import { Router } from 'express';
import { authRequired } from '../../middleware/auth';
import { adminOnly } from '../../middleware/admin';
import { validate } from '../../middleware/validateRequest';
import * as controller from './combo.controller';
import {
  comboActiveToggleSchema,
  comboIdParamSchema,
  createComboSchema,
  listComboQuerySchema,
  updateComboSchema,
} from './combo.validation';

const router = Router();
router.use(authRequired, adminOnly);

router.get('/', validate(listComboQuerySchema, 'query'), controller.listCombos);
router.post('/', validate(createComboSchema), controller.createCombo);
router.get('/:id', validate(comboIdParamSchema, 'params'), controller.getCombo);
router.put(
  '/:id',
  validate(comboIdParamSchema, 'params'),
  validate(updateComboSchema),
  controller.updateCombo
);
router.delete(
  '/:id',
  validate(comboIdParamSchema, 'params'),
  controller.removeCombo
);
router.patch(
  '/:id/active',
  validate(comboIdParamSchema, 'params'),
  validate(comboActiveToggleSchema),
  controller.toggleActive
);

export default router;