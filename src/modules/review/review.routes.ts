import { Router } from 'express';
import { authRequired } from '../../middleware/auth';
import { adminOnly } from '../../middleware/admin';
import { validate } from '../../middleware/validateRequest';
import * as controller from './review.controller';
import {
  createReviewSchema,
  listReviewQuerySchema,
  reviewIdParamSchema,
  updateReviewSchema,
} from './review.validation';

const router = Router();
router.use(authRequired, adminOnly);

router.get('/', validate(listReviewQuerySchema, 'query'), controller.listReviews);
router.post('/', validate(createReviewSchema), controller.createReview);
router.get('/:id', validate(reviewIdParamSchema, 'params'), controller.getReview);
router.put(
  '/:id',
  validate(reviewIdParamSchema, 'params'),
  validate(updateReviewSchema),
  controller.updateReview
);
router.delete('/:id', validate(reviewIdParamSchema, 'params'), controller.removeReview);
router.patch('/:id/approve', validate(reviewIdParamSchema, 'params'), controller.approveReview);
router.patch('/:id/reject', validate(reviewIdParamSchema, 'params'), controller.rejectReview);

export default router;