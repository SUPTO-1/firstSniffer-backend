import { Router } from 'express';
import { authRequired } from '../../middleware/auth';
import { adminOnly } from '../../middleware/admin';
import { validate } from '../../middleware/validateRequest';
import * as controller from './inventoryLog.controller';
import { listInventoryLogQuerySchema } from './inventoryLog.validation';

const router = Router();

router.use(authRequired, adminOnly);

router.get(
  '/',
  validate(listInventoryLogQuerySchema, 'query'),
  controller.listInventoryLogs
);

export default router;