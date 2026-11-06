import { Router } from 'express';
import { listPublicReviews } from './public.reviews.controller';

const router = Router();

// No auth — public storefront.
router.get('/', listPublicReviews);

export default router;
