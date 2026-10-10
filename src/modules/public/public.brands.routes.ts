import { Router } from 'express';
import { getPublicBrand, listPublicBrands } from './public.brands.controller';

const router = Router();

// No auth — public storefront.

router.get('/', listPublicBrands);
router.get('/:idOrSlug', getPublicBrand);

export default router;