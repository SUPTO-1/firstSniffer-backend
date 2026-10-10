import { Router } from 'express';
import { authRequired } from '../../middleware/auth';
import { adminOnly } from '../../middleware/admin';
import { validate } from '../../middleware/validateRequest';
import * as controller from './inventory.controller';
import {
  adjustInventorySchema,
  createInventorySchema,
  inventoryIdParamSchema,
  listInventoryQuerySchema,
  recordSaleSchema,
  releaseBufferSchema,
  updateInventorySchema,
} from './inventory.validation';

const router = Router();

router.use(authRequired, adminOnly);

router.get(
  '/',
  validate(listInventoryQuerySchema, 'query'),
  controller.listInventory
);
router.post(
  '/',
  validate(createInventorySchema),
  controller.createInventory
);
router.get(
  '/:id',
  validate(inventoryIdParamSchema, 'params'),
  controller.getInventory
);
router.put(
  '/:id',
  validate(inventoryIdParamSchema, 'params'),
  validate(updateInventorySchema),
  controller.updateInventory
);
router.delete(
  '/:id',
  validate(inventoryIdParamSchema, 'params'),
  controller.deleteInventory
);
router.post(
  '/:id/adjust',
  validate(inventoryIdParamSchema, 'params'),
  validate(adjustInventorySchema),
  controller.adjustInventory
);
router.post(
  '/:id/release-buffer',
  validate(inventoryIdParamSchema, 'params'),
  validate(releaseBufferSchema),
  controller.releaseBuffer
);
router.post(
  '/:id/sale',
  validate(inventoryIdParamSchema, 'params'),
  validate(recordSaleSchema),
  controller.recordSale
);

export default router;