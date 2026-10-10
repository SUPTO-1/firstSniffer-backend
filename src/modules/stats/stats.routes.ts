import { Router } from 'express';
import { authRequired } from '../../middleware/auth';
import { adminOnly } from '../../middleware/admin';
import { getStats } from './stats.controller';

const router = Router();

router.use(authRequired, adminOnly);

router.get('/', getStats);

export default router;