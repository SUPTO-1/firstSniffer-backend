import { Router } from 'express';
import { authRequired } from '../../middleware/auth';
import { adminOnly } from '../../middleware/admin';
import { validate } from '../../middleware/validateRequest';
import * as controller from './product.controller';
import {
  createProductSchema,
  listProductQuerySchema,
  productIdParamSchema,
  updateProductImagesSchema,
  updateProductSchema,
} from './product.validation';

const router = Router();

router.use(authRequired, adminOnly);

router.get('/', validate(listProductQuerySchema, 'query'), controller.listProducts);
router.post('/', validate(createProductSchema), controller.createProduct);
router.get('/:id', validate(productIdParamSchema, 'params'), controller.getProduct);
router.put(
  '/:id',
  validate(productIdParamSchema, 'params'),
  validate(updateProductSchema),
  controller.updateProduct
);
router.delete(
  '/:id',
  validate(productIdParamSchema, 'params'),
  controller.removeProduct
);
router.post(
  '/:id/restore',
  validate(productIdParamSchema, 'params'),
  controller.restoreProduct
);
router.patch(
  '/:id/images',
  validate(productIdParamSchema, 'params'),
  validate(updateProductImagesSchema),
  controller.updateProductImages
);

export default router;
