import { Router } from 'express';
import authRoutes from '../modules/auth/auth.routes';
import userRoutes from '../modules/user/user.routes';
import checkoutRoutes from '../modules/checkout/checkout.routes';
import imagekitRoutes from '../modules/imagekit/imagekit.routes';
import brandRoutes from '../modules/brand/brand.routes';
import genreRoutes from '../modules/genre/genre.routes';
import noteRoutes from '../modules/note/note.routes';
import seasonRoutes from '../modules/season/season.routes';
import occasionRoutes from '../modules/occasion/occasion.routes';
import weatherRoutes from '../modules/weather/weather.routes';
import timeRoutes from '../modules/timeofday/time.routes';
import atomizerRoutes from '../modules/atomizer/atomizer.routes';
import productRoutes from '../modules/product/product.routes';
import settingsRoutes from '../modules/settings/settings.routes';
import inventoryRoutes from '../modules/inventory/inventory.routes';
import inventoryLogRoutes from '../modules/inventoryLog/inventoryLog.routes';
import statsRoutes from '../modules/stats/stats.routes';
import paymentMethodRoutes from '../modules/paymentMethod/paymentMethod.routes';
import customerRoutes from '../modules/customer/customer.routes';
import orderRoutes from '../modules/order/order.routes';
import comboRoutes from '../modules/combo/combo.routes';
import couponRoutes from '../modules/coupon/coupon.routes';
import reviewRoutes from '../modules/review/review.routes';
import publicRoutes from '../modules/public';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({
    success: true,
    message: 'OK',
    data: {
      status: 'up',
      service: 'firstsniffer-backend',
      time: new Date().toISOString(),
    },
  });
});

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/checkout', checkoutRoutes);
router.use('/imagekit', imagekitRoutes);
router.use('/brands', brandRoutes);
router.use('/genres', genreRoutes);
router.use('/notes', noteRoutes);
router.use('/seasons', seasonRoutes);
router.use('/occasions', occasionRoutes);
router.use('/weathers', weatherRoutes);
router.use('/times', timeRoutes);
router.use('/atomizers', atomizerRoutes);
router.use('/products', productRoutes);
router.use('/settings', settingsRoutes);
router.use('/inventory', inventoryRoutes);
router.use('/inventory-logs', inventoryLogRoutes);
router.use('/stats', statsRoutes);
router.use('/payment-methods', paymentMethodRoutes);
router.use('/customers', customerRoutes);
router.use('/orders', orderRoutes);
router.use('/combos', comboRoutes);
router.use('/coupons', couponRoutes);
router.use('/reviews', reviewRoutes);
router.use('/public', publicRoutes);

export default router;