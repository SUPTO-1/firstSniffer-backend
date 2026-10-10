import { Router } from 'express';
import { authRequired } from '../../middleware/auth';
import { adminOnly } from '../../middleware/admin';
import { validate } from '../../middleware/validateRequest';
import * as controller from './customer.controller';
import {
  addCustomerAddressSchema,
  createCustomerSchema,
  customerActiveToggleSchema,
  customerAddressIdParamSchema,
  customerIdParamSchema,
  listCustomerQuerySchema,
  updateCustomerSchema,
} from './customer.validation';

const router = Router();

router.use(authRequired, adminOnly);

router.get(
  '/',
  validate(listCustomerQuerySchema, 'query'),
  controller.listCustomers
);
router.post('/', validate(createCustomerSchema), controller.createCustomer);
router.get(
  '/:id',
  validate(customerIdParamSchema, 'params'),
  controller.getCustomer
);
router.put(
  '/:id',
  validate(customerIdParamSchema, 'params'),
  validate(updateCustomerSchema),
  controller.updateCustomer
);
router.patch(
  '/:id/active',
  validate(customerIdParamSchema, 'params'),
  validate(customerActiveToggleSchema),
  controller.toggleCustomerActive
);
router.post(
  '/:id/addresses',
  validate(customerIdParamSchema, 'params'),
  validate(addCustomerAddressSchema),
  controller.addAddress
);
router.delete(
  '/:id/addresses/:addressId',
  validate(customerAddressIdParamSchema, 'params'),
  controller.removeAddress
);

export default router;
