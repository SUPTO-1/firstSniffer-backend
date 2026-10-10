import { Router } from 'express';
import { authRequired } from '../../middleware/auth';
import { adminOnly } from '../../middleware/admin';
import { validate } from '../../middleware/validateRequest';
import * as controller from './time.controller';
import {
  createTimeSchema,
  listTimeQuerySchema,
  timeIdParamSchema,
  updateTimeSchema,
} from './time.validation';

const router = Router();
router.use(authRequired, adminOnly);
router.get('/', validate(listTimeQuerySchema, 'query'), controller.listTimes);
router.post('/', validate(createTimeSchema), controller.createTime);
router.get('/:id', validate(timeIdParamSchema, 'params'), controller.getTime);
router.put('/:id', validate(timeIdParamSchema, 'params'), validate(updateTimeSchema), controller.updateTime);
router.delete('/:id', validate(timeIdParamSchema, 'params'), controller.removeTime);

export default router;
