import { Router } from 'express';
import { authRequired } from '../../middleware/auth';
import { adminOnly } from '../../middleware/admin';
import { validate } from '../../middleware/validateRequest';
import * as controller from './brand.controller';
import {
  brandIdParamSchema,
  createBrandSchema,
  listBrandQuerySchema,
  updateBrandSchema,
} from './brand.validation';

const router = Router();

router.use(authRequired, adminOnly);

router.get('/', validate(listBrandQuerySchema, 'query'), controller.listBrands);
router.post('/', validate(createBrandSchema), controller.createBrand);
router.get(
  '/:id',
  validate(brandIdParamSchema, 'params'),
  controller.getBrand
);
router.put(
  '/:id',
  validate(brandIdParamSchema, 'params'),
  validate(updateBrandSchema),
  controller.updateBrand
);
router.delete(
  '/:id',
  validate(brandIdParamSchema, 'params'),
  controller.removeBrand
);

export default router;
