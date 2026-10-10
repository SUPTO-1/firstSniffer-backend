import { Router } from 'express';
import {
  getPublicProductBySlugOrId,
  listPublicProductSlugs,
  listPublicProducts,
} from './public.products.controller';

const router = Router();

// No auth — public storefront.

router.get('/slugs/all', listPublicProductSlugs);
router.get('/', listPublicProducts);
// `/:slugOrId` is last so it doesn't shadow the static paths above.
router.get('/:slugOrId', getPublicProductBySlugOrId);

export default router;