import { Router } from 'express';
import publicProductsRoutes from './public.products.routes';
import publicBrandsRoutes from './public.brands.routes';
import publicCatalogRoutes from './public.catalog.routes';
import publicSettingsRoutes from './public.settings.routes';
import publicOrdersRoutes from './public.orders.routes';

const router = Router();

router.use('/products', publicProductsRoutes);
router.use('/brands', publicBrandsRoutes);
router.use('/settings', publicSettingsRoutes);
router.use('/orders', publicOrdersRoutes);

// Catalog handlers (genres/notes/seasons/occasions/weathers/times) are mounted
// at the top level so the public URLs match the plan: /api/public/genres,
// /api/public/notes, etc. (No `/catalog` prefix.)
router.use('/', publicCatalogRoutes);

export default router;