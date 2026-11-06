import { Router } from 'express';
import publicProductsRoutes from './public.products.routes';
import publicBrandsRoutes from './public.brands.routes';
import publicCatalogRoutes from './public.catalog.routes';
import publicSettingsRoutes from './public.settings.routes';
import publicOrdersRoutes from './public.orders.routes';
import publicOrderCalculateRoutes from './public.orderCalculate.routes';
import publicReviewsRoutes from './public.reviews.routes';
import publicCombosRoutes from './public.combos.routes';
import publicCouponsRoutes from './public.coupons.routes';

const router = Router();

router.use('/products', publicProductsRoutes);
router.use('/brands', publicBrandsRoutes);
router.use('/settings', publicSettingsRoutes);
router.use('/orders', publicOrdersRoutes);
router.use('/reviews', publicReviewsRoutes);
router.use('/combos', publicCombosRoutes);
router.use('/coupons', publicCouponsRoutes);

/**
 * The order PREVIEW.
 *
 * Mounted at the TOP LEVEL rather than under `/orders` because the order
 * routes mount `router.get('/:orderNumber')` — a catch-all that would
 * swallow `/orders/calculate` and try to parse "calculate" as an order
 * number.
 */
router.use('/order-preview', publicOrderCalculateRoutes);

// Catalog handlers (genres/notes/seasons/occasions/weathers/times) are mounted
// at the top level so the public URLs match the plan: /api/public/genres,
// /api/public/notes, etc. (No `/catalog` prefix.)
router.use('/', publicCatalogRoutes);

export default router;