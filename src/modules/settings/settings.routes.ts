import { Router } from 'express';
import { authRequired } from '../../middleware/auth';
import { adminOnly } from '../../middleware/admin';
import { validate } from '../../middleware/validateRequest';
import * as controller from './settings.controller';
import { updateSettingsSchema } from './settings.validation';

const router = Router();

router.use(authRequired, adminOnly);

router.get('/', controller.getSettingsHandler);
router.put('/', validate(updateSettingsSchema), controller.updateSettingsHandler);

export default router;
