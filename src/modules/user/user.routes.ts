import { Router } from 'express';
import { authRequired } from '../../middleware/auth';
import { validate } from '../../middleware/validateRequest';
import * as controller from './user.controller';
import {
  addAddressSchema,
  addressIdParamSchema,
  updateAddressSchema,
  updateProfileSchema,
} from './user.validation';

const router = Router();

// All user routes require authentication.
router.use(authRequired);

router.get('/me', controller.getProfile);

// Storefront: list the signed-in customer's own orders. `customer` is
// forcibly set server-side so callers can never see another user's data.
router.get('/me/orders', controller.listMyOrders);

router.patch(
  '/me',
  validate(updateProfileSchema),
  controller.patchProfile
);

router.post(
  '/me/addresses',
  validate(addAddressSchema),
  controller.postAddress
);

router.patch(
  '/me/addresses/:addressId',
  validate(addressIdParamSchema, 'params'),
  validate(updateAddressSchema),
  controller.patchAddress
);

router.put(
  '/me/addresses/:addressId/default',
  validate(addressIdParamSchema, 'params'),
  controller.putDefaultAddress
);

router.delete(
  '/me/addresses/:addressId',
  validate(addressIdParamSchema, 'params'),
  controller.removeAddress
);

export default router;
