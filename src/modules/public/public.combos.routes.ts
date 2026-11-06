import { Router } from 'express';
import { listPublicCombos } from './public.combos.controller';

const router = Router();

// No auth — public storefront.
router.get('/', listPublicCombos);

export default router;
