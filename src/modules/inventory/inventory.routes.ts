import { Router } from 'express';
import { authRequired } from '../../middleware/auth';
import { adminOnly } from '../../middleware/admin';
import { validate } from '../../middleware/validateRequest';
import * as batchController from './inventoryBatch.controller';
import * as stockController from './inventoryStock.controller';
import {
  adjustInventoryBatchSchema,
  createInventoryBatchSchema,
  inventoryBatchIdParamSchema,
  listInventoryBatchQuerySchema,
  restockInventoryBatchSchema,
  updateInventoryBatchSchema,
} from './inventoryBatch.validation';
import { productStockParamSchema } from './inventoryStock.validation';
import {
  productSettingsParamSchema,
  updateInventorySettingsSchema,
} from './inventoryStock.validation';

const router = Router();

router.use(authRequired, adminOnly);

/* ------------------------------------------------------------------
 *  Product-level stock
 *
 *  This is the PRIMARY inventory surface: one row per product, aggregated
 *  live from that product's batches. The old per-(product, size) listing is
 *  gone — selling sizes are not stock records.
 * ------------------------------------------------------------------ */

router.get(
  '/stock',
  validate(listInventoryBatchQuerySchema, 'query'),
  stockController.listProductStock
);

router.get(
  '/stock/:productId',
  validate(productStockParamSchema, 'params'),
  stockController.getProductStock
);

/* ------------------------------------------------------------------
 *  Product-level inventory settings — safety buffer + low-stock threshold
 * ------------------------------------------------------------------ */

router.get(
  '/settings/:productId',
  validate(productSettingsParamSchema, 'params'),
  stockController.getProductStock
);

router.patch(
  '/settings/:productId',
  validate(productSettingsParamSchema, 'params'),
  validate(updateInventorySettingsSchema),
  stockController.updateProductStock
);

/* ------------------------------------------------------------------
 *  Batches — the physical purchases that back a product's stock
 * ------------------------------------------------------------------ */

router.get(
  '/batches',
  validate(listInventoryBatchQuerySchema, 'query'),
  batchController.listInventoryBatches
);

router.post(
  '/batches',
  validate(createInventoryBatchSchema),
  batchController.createInventoryBatch
);

router.get(
  '/batches/:id',
  validate(inventoryBatchIdParamSchema, 'params'),
  batchController.getInventoryBatch
);

router.put(
  '/batches/:id',
  validate(inventoryBatchIdParamSchema, 'params'),
  validate(updateInventoryBatchSchema),
  batchController.updateInventoryBatch
);

router.post(
  '/batches/:id/adjust',
  validate(inventoryBatchIdParamSchema, 'params'),
  validate(adjustInventoryBatchSchema),
  batchController.adjustInventoryBatch
);

router.post(
  '/batches/:id/restock',
  validate(inventoryBatchIdParamSchema, 'params'),
  validate(restockInventoryBatchSchema),
  batchController.restockInventoryBatch
);

/**
 * Retire a consumed batch. Soft-delete — the movement history and the order
 * allocations that reference it must stay intact.
 */
router.post(
  '/batches/:id/retire',
  validate(inventoryBatchIdParamSchema, 'params'),
  batchController.retireInventoryBatch
);

export default router;
